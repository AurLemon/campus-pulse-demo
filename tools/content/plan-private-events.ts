/** Bounded DS planning of Synthetic private events after real image review. No business writes. */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { COMMUNITY_VOICE_POLICY } from '../../packages/domain/community-voice-policy.ts'
import { runWritingBatch } from './budget.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
interface SourceRow {
	id: string
	authorId: string
	createdAt: string
	[key: string]: unknown
}
interface Comment extends SourceRow {
	parentId: string | null
	postId: string
}
interface Source {
	post: SourceRow
	comments: Comment[]
	guardSha256: string
}
interface Scene {
	id: string
	postId: string
	authorId: string
	subject: string
	domain: string
	mood?: string
	eventBeat?: unknown
}
interface Fact {
	id: string
	sha256: string
	mediaPath: string
}
interface Review {
	id: string
	sha256: string
	status: string
	verifiedFacts: string[]
	notes: string[]
}
interface Persona {
	id: string
	voice: string
	ordinaryLifeFacts?: string[]
	profileAsOf?: string
	writingHabits?: unknown
	knowledgeEdges?: unknown
}
interface BeatComment {
	id: string
	speakerId: string
	parentId: string | null
	onlyConcern: string
}
interface Beat {
	id: string
	postId: string
	authorId: string
	eventAsOf: string
	authorSituation: string
	authorIntent: string
	knownEventFacts: string[]
	whatNeedNotBeDescribed: string
	comments: BeatComment[]
}
const arg = (key: string) =>
	process.argv.find((v) => v.startsWith(key + '='))?.slice(key.length + 1)
const planPath = arg('--plan'),
	factPath = arg('--facts'),
	namespace = arg('--namespace')
const offset = Number(arg('--offset') ?? 0),
	limit = Number(arg('--limit') ?? 10)
if (
	!planPath ||
	!factPath ||
	!namespace ||
	!/^[a-z0-9-]{1,80}$/.test(namespace) ||
	!Number.isSafeInteger(offset) ||
	offset < 0 ||
	!Number.isSafeInteger(limit) ||
	limit < 1 ||
	limit > 10
)
	throw Error('INVALID_EVENT_BATCH')
const json = async <T>(path: string) =>
	JSON.parse(await readFile(resolve(path), 'utf8')) as T
const canonical = (v: unknown): string =>
	Array.isArray(v)
		? '[' + v.map(canonical).join(',') + ']'
		: v && typeof v === 'object'
			? '{' +
				Object.entries(v)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
					.join(',') +
				'}'
			: JSON.stringify(v)
const hash = (v: unknown) =>
	createHash('sha256').update(canonical(v)).digest('hex')
const cache = await ensureContentCache(),
	directory = join(cache, namespace)
const plan = await json<{ scenes: Scene[] }>(planPath),
	facts = await json<Fact[]>(factPath)
const active = await json<{ activeGeneratedScenes: { id: string }[] }>(
	'.data/community-images-v3/active-scope.json',
)
const activeIds = new Set(active.activeGeneratedScenes.map((s) => s.id))
const selected = plan.scenes
	.filter((s) => activeIds.has(s.id))
	.slice(offset, offset + limit)
if (!selected.length) throw Error('NO_ACTIVE_SCENES')
const sources = new Map(
	(
		await json<{ source: Source[] }>(
			'.data/community-images-v3/source-backup.json',
		)
	).source.map((s) => [s.post.id, s]),
)
const people = new Map(
	(await json<Persona[]>(join(cache, 'pulse-natural-v3/personas.json'))).map(
		(p) => [p.id, p],
	),
)
const db = new Database(
	process.env.DATABASE_URL?.replace(/^file:/, '') ?? resolve('.data/pulse.db'),
	{ readonly: true, fileMustExist: true },
)
const pairs = db
	.prepare(
		"SELECT requesterId,recipientId,createdAt FROM Friendship WHERE status='ACCEPTED'",
	)
	.all() as { requesterId: string; recipientId: string; createdAt: string }[]
const inputs = []
for (const scene of selected) {
	const source = sources.get(scene.postId)!,
		fact = facts.find((f) => f.id === scene.id)
	if (!source || !fact) throw Error('SOURCE_OR_FACT_MISSING:' + scene.id)
	const review = await json<Review>(
		'.data/community-images-v3/reviews/' + scene.id + '.json',
	)
	if (
		review.status !== 'approved' ||
		review.sha256 !== fact.sha256 ||
		!review.verifiedFacts.length
	)
		throw Error('UNREVIEWED_IMAGE:' + scene.id)
	if (
		createHash('sha256')
			.update(await readFile(fact.mediaPath))
			.digest('hex') !== fact.sha256
	)
		throw Error('IMAGE_CHANGED:' + scene.id)
	const post = db.prepare('SELECT * FROM Post WHERE id=?').get(scene.postId),
		comments = db
			.prepare('SELECT * FROM Comment WHERE postId=? ORDER BY createdAt,id')
			.all(scene.postId)
	if (
		canonical({ post, comments }) !==
		canonical({ post: source.post, comments: source.comments })
	)
		throw Error('SOURCE_DRIFT:' + scene.postId)
	const ids = [
		...new Set([
			source.post.authorId,
			...source.comments.map((c) => c.authorId),
		]),
	]
	function actor(id: string) {
		const p = people.get(id)
		if (!p) throw Error('PERSONA_MISSING:' + id)
		return {
			id,
			voice: p.voice.slice(0, 140),
			writingHabits: p.writingHabits,
			knowledgeEdges: p.knowledgeEdges,
			ordinaryLifeFacts:
				p.profileAsOf &&
				Date.parse(p.profileAsOf) > Date.parse(source.post.createdAt)
					? []
					: p.ordinaryLifeFacts?.slice(0, 2),
		}
	}
	inputs.push({
		id: scene.id,
		postId: scene.postId,
		authorId: source.post.authorId,
		eventAsOf: source.post.createdAt,
		visualBounds: { verifiedFacts: review.verifiedFacts, notes: review.notes },
		plannedDirection: {
			subject: scene.subject,
			domain: scene.domain,
			mood: scene.mood,
		},
		author: actor(source.post.authorId),
		comments: source.comments.map((c) => ({
			id: c.id,
			speakerId: c.authorId,
			parentId: c.parentId,
			speakerRole: c.authorId === source.post.authorId ? '楼主本人' : '评论者',
			replyToAuthorId: source.comments.find((p) => p.id === c.parentId)
				?.authorId,
			persona: actor(c.authorId),
		})),
		relationships: pairs
			.filter(
				(p) =>
					ids.includes(p.requesterId) &&
					ids.includes(p.recipientId) &&
					p.createdAt <= source.post.createdAt,
			)
			.map((p) => ({
				left: p.requesterId,
				right: p.recipientId,
				relation: 'friend',
			})),
	})
}
db.close()
const prompt = JSON.stringify({
	task: '为已审图片设计每个人当时的一件Synthetic私人微事件，只做内部事件状态提纲，不写公开标题/正文/评论台词。authorSituation只留一句具体私人经过。authorIntent必须是面向社区发这帖的一次表达目的（如记一下、显摆一点、问一个条件、吐槽自己、找后续或让人围观），不是接下来怎么处理物件、是否起身收工具；不能写不跟别人讲、不想发布等与发帖相冲突的意图。knownEventFacts只写你明确设定的私人事件状态、已发生动作或已有打算，不允许把verifiedFacts颜色材质方位和物体清单复制一遍，因为视觉约束已另外给出。每条要有具体触发、当事人此刻想干什么或单纯在意什么，不是物体百科。图片verifiedFacts限定可见细节，不用每件都进入事件。允许小开心、完成一点事、无意义记录、真正借东西、自己弄错或只顾自己，不要都设备坏了/找不到东西/先放着，也不要所有评论都是提问。plannedDirection仅选题，不可用它推翻实际图审notes；特别不清用途的小物件不要通过虚构事件强行认定型号、故障、病害或明确用途。私人事件可原创但只涉及这个人物眼前普通小事，不编学校公告、商家责任价格、活动名额、真实同伴私事或给图中物件强配私人身份。不得复制任何参考文中的原句，也不要套找充电头、漏打印封面、忘按灯开关这几个已用小样。comments全部固定id/speakerId/parentId，只给参与目标或所知差异的onlyConcern，不限定唯一台词；允许不关心、半句、误认、只谈自己、猜错而没人纠正，不按比例硬塞错误。楼主回复只回应对应parent，不扮路人向自己提问。零评论保持零评论。eventAsOf原样保留，不能引用晚于这个时点的人物近况。只输出JSON {entries:[{id,postId,authorId,eventAsOf,authorSituation,authorIntent,knownEventFacts:string[],whatNeedNotBeDescribed,comments:[{id,speakerId,parentId,onlyConcern}]}]}，不加其他字段、不公开元数据。',
	conversationPolicy: COMMUNITY_VOICE_POLICY,
	threads: inputs,
	immutableOutputStructure: inputs.map((t) => ({
		id: t.id,
		postId: t.postId,
		authorId: t.authorId,
		eventAsOf: t.eventAsOf,
		comments: t.comments.map((c) => ({
			id: c.id,
			speakerId: c.speakerId,
			parentId: c.parentId,
		})),
	})),
})
const inputDigest = hash(inputs),
	file = join(directory, 'event-beats-' + inputDigest + '.json')
await mkdir(directory, { recursive: true })
if (!process.argv.includes('--generate')) {
	console.log(
		JSON.stringify({
			phase: 'event-preflight',
			threads: inputs.length,
			promptBytes: Buffer.byteLength(prompt),
			inputDigest,
			paidRequests: 0,
		}),
	)
	process.exit(0)
}
let parsed: { entries: Beat[] }
const rawFile = join(directory, 'raw-' + inputDigest + '.json')
try {
	parsed = await json<{ entries: Beat[] }>(file)
} catch (e) {
	if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
	let raw: string
	try {
		const cachedRaw = JSON.parse(await readFile(rawFile, 'utf8')) as {
			text?: string
		}
		raw = cachedRaw.text ?? JSON.stringify(cachedRaw)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		raw = await runWritingBatch(namespace + '-' + inputDigest, prompt, {
			api: 'openai-responses',
			maxTokens: 14000,
			timeoutMs: 180000,
		})
		await writeContentCacheFile(
			rawFile,
			JSON.stringify({ text: raw }) + '\n',
			{},
		)
	}
	parsed = JSON.parse(
		raw
			.trim()
			.replace(/^```(?:json)?\s*/, '')
			.replace(/\s*```$/, ''),
	) as { entries: Beat[] }
}
if (
	!Array.isArray(parsed.entries) ||
	parsed.entries.length !== inputs.length ||
	new Set(parsed.entries.map((e) => e.postId)).size !== inputs.length
)
	throw Error('EVENT_BATCH_STRUCTURE')
for (const item of inputs) {
	const beat = parsed.entries.find((e) => e.postId === item.postId)
	// The model occasionally supplies a redundant event label e-p123. Map only
	// this exact alias after matching the immutable post key; actor/parent IDs remain strict.
	if (beat?.id === 'e-' + item.postId) beat.id = item.id
	// No public comment can be added: discard planner-only concerns when the
	// immutable source has no participants at all. Preserve raw output above.
	if (beat && item.comments.length === 0) beat.comments = []
	// Event timestamps are source metadata, never model-created world state.
	if (beat && beat.authorId === item.authorId) beat.eventAsOf = item.eventAsOf
	if (
		!beat ||
		beat.id !== item.id ||
		beat.authorId !== item.authorId ||
		beat.eventAsOf !== item.eventAsOf ||
		typeof beat.authorSituation !== 'string' ||
		!beat.authorSituation.trim() ||
		typeof beat.authorIntent !== 'string' ||
		!beat.authorIntent.trim() ||
		!beat.knownEventFacts?.length ||
		beat.comments?.length !== item.comments.length ||
		new Set(beat.comments.map((c) => c.id)).size !== item.comments.length ||
		beat.comments.some(
			(c) =>
				!item.comments.some(
					(old) =>
						old.id === c.id &&
						old.speakerId === c.speakerId &&
						old.parentId === c.parentId,
				) ||
				typeof c.onlyConcern !== 'string' ||
				!c.onlyConcern.trim(),
		)
	)
		throw Error('EVENT_ACTOR_OR_PARENT_STRUCTURE:' + item.postId)
}
await writeContentCacheFile(
	file,
	JSON.stringify(
		{
			version: 1,
			inputDigest,
			policyVersion: COMMUNITY_VOICE_POLICY.version,
			promptBytes: Buffer.byteLength(prompt),
			entries: parsed.entries,
		},
		null,
		2,
	) + '\n',
)
const packed = await packContentCache()
if (!packed.cacheStateUpdated) throw Error('EVENT_CONTENT_ARCHIVE_PENDING')
console.log(
	JSON.stringify({
		phase: 'event-generated',
		threads: inputs.length,
		path: file,
		inputDigest,
		promptBytes: Buffer.byteLength(prompt),
		databaseWritten: false,
	}),
)
