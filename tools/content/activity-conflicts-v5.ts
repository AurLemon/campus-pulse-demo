/** Bounded Synthetic drafts and explicitly reviewed publication. Read-only by default. */
import Database from 'better-sqlite3'
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { COMMUNITY_VOICE_POLICY } from '../../packages/domain/community-voice-policy.ts'
import { runWritingBatch, readTaskBudget } from './budget.ts'
import {
	ensureContentCache,
	writeContentCacheFile as writeCache,
	packContentCache,
} from './bundle.ts'
import { validateAgentText } from '../../packages/domain/agent-access.ts'
import type { Snapshot } from '@campus/contracts'
import { validateSnapshot } from './validate.ts'

interface Row {
	id: string
	source: string
	[key: string]: unknown
}
interface Post extends Row {
	authorId: string
	createdAt: string
	title: string
	body: string
}
interface Comment extends Row {
	authorId: string
	postId: string
	parentId: string | null
	createdAt: string
	body: string
}
interface Activity extends Row {
	organizerId: string
	title: string
	body: string
}
interface Persona {
	id: string
	[key: string]: unknown
}
interface Slot {
	id: string
	authorId: string
	postId: string
	parentId: string | null
	createdAt: string
	source: 'Synthetic'
	replyToCommentId: string | null
	replyToAuthorId: string
}
interface Hot {
	post: Post
	comments: Comment[]
	additions: Slot[]
	guardSha256: string
	interactionPlan?: { level: string; trigger: string }
}
interface ActivityPlan {
	activity: Activity
	linkedThreadsSha256: string
	guardSha256: string
}
interface Plan {
	version: number
	namespace: string
	policyVersion: string
	activities: ActivityPlan[]
	blockedActivities: string[]
	hot: Hot[]
	digest: string
}
const namespace = 'activity-conflicts-v5'
const arg = (key: string) =>
	process.argv.find((v) => v.startsWith(key + '='))?.slice(key.length + 1)
const bundleRoot = arg('--bundle-root')
	? resolve(arg('--bundle-root')!)
	: undefined
const bundleOptions = bundleRoot ? { rootDirectory: bundleRoot } : {}
const directory = resolve(bundleRoot ?? '.', '.data', namespace)
const databasePath = resolve(
	arg('--database') ??
		resolve(process.env.CAMPUS_DATA_DIR ?? '.data', 'pulse.db'),
)
const writeContentCacheFile = (path: string, bytes: string | Buffer) =>
	writeCache(path, bytes, bundleOptions)
const mode = arg('--run')
if (mode && !['activities', 'hot'].includes(mode))
	throw Error('INVALID_RUN_MODE')
const publication = arg('--publish')
if (publication && !['activities', 'hot'].includes(publication))
	throw Error('INVALID_PUBLICATION')
if (mode && publication) throw Error('CANNOT_GENERATE_AND_PUBLISH_TOGETHER')
if (process.argv.includes('--apply') && !publication)
	throw Error('PUBLICATION_REQUIRED')
const canonical = (value: unknown): string =>
	Array.isArray(value)
		? '[' + value.map(canonical).join(',') + ']'
		: value && typeof value === 'object'
			? '{' +
				Object.entries(value)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
					.join(',') +
				'}'
			: JSON.stringify(value)
const hash = (value: unknown) =>
	createHash('sha256').update(canonical(value)).digest('hex')
const database = new Database(databasePath, {
	readonly: true,
	fileMustExist: true,
})
const query = <T>(sql: string, ...params: string[]) =>
	database.prepare(sql).all(...params) as T[]
const safePost = (p: Post) =>
	p.source === 'Synthetic' &&
	/^p(?:[1-9]\d{0,2}|1000)$/.test(p.id) &&
	query<Comment>('SELECT * FROM Comment WHERE postId=?', p.id).every(
		(c) =>
			c.source === 'Synthetic' &&
			/^c(?:[1-9]\d{0,2}|[12]\d{3}|3000)$/.test(c.id) &&
			!c.deletedAt,
	)
const threads = (activityId: string) =>
	query<Post>(
		'SELECT * FROM Post WHERE activityId=? ORDER BY id',
		activityId,
	).map((post) => ({
		post,
		comments: query<Comment>(
			'SELECT * FROM Comment WHERE postId=? ORDER BY id',
			post.id,
		),
	}))
const contextIdentity = (related: ReturnType<typeof threads>) =>
	related.map((t) => ({
		post: { ...t.post, title: undefined, body: undefined },
		comments: t.comments.map((c) => ({ ...c, body: undefined })),
	}))
await mkdir(directory, { recursive: true })
const cache = await ensureContentCache(bundleOptions)
const personas = JSON.parse(
	await readFile(join(cache, 'pulse-natural-v3/personas.json'), 'utf8'),
) as Persona[]
let plan: Plan
try {
	plan = JSON.parse(
		await readFile(join(directory, 'plan.json'), 'utf8'),
	) as Plan
} catch (e) {
	if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
	const hotIds = [
		'p293',
		'p296',
		'p263',
		'p303',
		'p312',
		'p335',
		'p342',
		'p357',
		'p359',
		'p360',
		'p365',
		'p366',
		'p374',
		'p198',
	]
	const counts = [36, 36, 26, 24, 28, 26, 24, 24, 30, 26, 20, 26, 22, 20]
	const protectedIds = new Set(
		(
			JSON.parse(
				await readFile(
					'.data/community-images-v3/remaining-v5-final-scope-inventory.json',
					'utf8',
				),
			) as { protectedByLiveContext: string[] }
		).protectedByLiveContext,
	)
	const activities: ActivityPlan[] = [],
		blockedActivities: string[] = []
	for (const activity of query<Activity>(
		'SELECT * FROM Activity ORDER BY id',
	)) {
		const related = threads(activity.id)
		if (
			activity.source !== 'Synthetic' ||
			related.some((t) => protectedIds.has(t.post.id) || !safePost(t.post))
		) {
			blockedActivities.push(activity.id)
			continue
		}
		activities.push({
			activity,
			guardSha256: hash(activity),
			linkedThreadsSha256: hash(contextIdentity(related)),
		})
	}
	const hot = hotIds.map((id, n): Hot => {
		const post = query<Post>('SELECT * FROM Post WHERE id=?', id)[0]!
		if (
			!post ||
			!safePost(post) ||
			protectedIds.has(id) ||
			post.activityId ||
			post.mediaIds !== '[]' ||
			post.kind !== 'TEXT'
		)
			throw Error('UNSAFE_HOT:' + id)
		const comments = query<Comment>(
			'SELECT * FROM Comment WHERE postId=? ORDER BY createdAt,id',
			id,
		)
		const start =
			Math.max(
				Date.parse(post.createdAt),
				...comments.map((c) => Date.parse(c.createdAt)),
			) + 60_000
		const actors = [
			...new Set([
				post.authorId,
				...comments.map((c) => c.authorId),
				...Array.from(
					{ length: 5 },
					(_, i) => 'u' + (71 + ((n * 9 + i * 17) % 130)),
				),
			]),
		].filter((id) => {
			const actor = query<Row>(
				'SELECT id,source,createdAt FROM User WHERE id=?',
				id,
			)[0]
			return (
				actor?.source === 'Synthetic' &&
				typeof actor.createdAt === 'string' &&
				Date.parse(actor.createdAt) <= start
			)
		})
		for (const actor of actors)
			if (
				query<Row>('SELECT id,source FROM User WHERE id=?', actor)[0]
					?.source !== 'Synthetic'
			)
				throw Error('UNSAFE_ACTOR')
		const additions: Slot[] = []
		for (let i = 0; i < counts[n]!; i++) {
			const root = i < 4 ? null : additions[(i - 4) % 4]!
			const authorId =
				actors[
					i < 4
						? (i + 1) % actors.length
						: (i * 3 + Math.floor(i / 4)) % actors.length
				]!
			additions.push({
				id: 'cv5hot-' + id + '-' + String(i + 1).padStart(3, '0'),
				authorId,
				postId: id,
				parentId: root?.id ?? null,
				createdAt: new Date(start + i * (83 + (n % 7)) * 1000).toISOString(),
				source: 'Synthetic',
				replyToCommentId: root?.id ?? null,
				replyToAuthorId: root?.authorId ?? post.authorId,
			})
		}
		if (additions.at(-1)!.createdAt > '2026-11-04T18:22:02.496Z')
			throw Error('FUTURE_COMMENT')
		return { post, comments, additions, guardSha256: hash({ post, comments }) }
	})
	const body = {
		version: 1,
		namespace,
		policyVersion: COMMUNITY_VOICE_POLICY.version,
		activities,
		blockedActivities,
		hot,
	}
	plan = { ...body, digest: hash(body) }
	await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2))
	await writeContentCacheFile(
		join(cache, namespace, 'plan.json'),
		JSON.stringify(plan, null, 2),
	)
}
if (process.argv.includes('--refresh-context-guards')) {
	const prior = structuredClone(plan)
	for (const a of plan.activities) {
		const related = threads(a.activity.id)
		if (related.some((t) => !safePost(t.post)))
			throw Error('LIVE_CONTEXT_CANNOT_REBASE:' + a.activity.id)
		a.linkedThreadsSha256 = hash(contextIdentity(related))
	}
	const { digest: _digest, ...body } = plan
	plan.digest = hash(body)
	await writeFile(
		join(directory, 'plan-before-context-guard.json'),
		JSON.stringify(prior, null, 2),
	)
	await writeContentCacheFile(
		join(cache, namespace, 'plan-before-context-guard.json'),
		JSON.stringify(prior, null, 2),
	)
	await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2))
	await writeContentCacheFile(
		join(cache, namespace, 'plan.json'),
		JSON.stringify(plan, null, 2),
	)
}
if (process.argv.includes('--replan-hot-replies')) {
	const prior = structuredClone(plan)
	const conflicts: Record<string, string> = {
		p359: '原帖“水平差太多先别合奏”被一个人理解成把新手赶走，楼主不认这个意思，另一人只截“先别合奏”咬着说，几个人围绕那句话语气变冲，有人插一句或看热闹。不要把原作者改成主张全面禁止新手，也不要替双方讲清适用范围',
		p360: '原帖给实习建议口气很满，有人觉得站着说话不腰疼，有人没看完就说又一个懂王，原作者不肯吃这顶帽子。围绕具体原句和态度互怼，允许话说重和嘴硬，不落成整齐的求职答疑',
		p374: '有人觉得这种批注问题自己翻两页就知道，提问者觉得问一句也要被训，另有人插嘴说他是来查作业的。轻度阴阳可升级一次，不要硬把普通提问写成楼主故意伸手',
	}
	for (const [n, h] of plan.hot.entries()) {
		if (n < 2) continue
		h.interactionPlan = {
			level: conflicts[h.post.id] ? 'L2/L3' : 'L0/L1',
			trigger:
				conflicts[h.post.id] ??
				'保持原话题，各自只关心一点，允许普通聊天、个人经验、跑题或一两句不耐烦，不强行升级争吵',
		}
		const actors = [
			...new Set([
				h.post.authorId,
				...h.comments.map((c) => c.authorId),
				...h.additions.map((c) => c.authorId),
			]),
		]
		for (const [i, s] of h.additions.entries()) {
			const newRoot =
				i === 0 ||
				i === Math.floor(h.additions.length * 0.47) ||
				i === Math.floor(h.additions.length * 0.81)
			const target = newRoot ? null : h.additions[i - 1]!
			const root = target ? (target.parentId ?? target.id) : null
			const pool = actors.filter((id) => id !== target?.authorId)
			s.authorId = pool[(i + n) % pool.length]!
			if (i % 5 === 2 && h.post.authorId !== target?.authorId)
				s.authorId = h.post.authorId
			s.parentId = root
			s.replyToCommentId = target?.id ?? null
			s.replyToAuthorId = target?.authorId ?? h.post.authorId
		}
	}
	const { digest: _digest, ...body } = plan
	plan.digest = hash(body)
	await writeFile(
		join(directory, 'plan-before-reply-replan.json'),
		JSON.stringify(prior, null, 2),
	)
	await writeContentCacheFile(
		join(cache, namespace, 'plan-before-reply-replan.json'),
		JSON.stringify(prior, null, 2),
	)
	await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2))
	await writeContentCacheFile(
		join(cache, namespace, 'plan.json'),
		JSON.stringify(plan, null, 2),
	)
}
if (process.argv.includes('--repair-plan-time')) {
	const prior = structuredClone(plan)
	let repaired = 0
	for (const hot of plan.hot) {
		const pool = query<Row>(
			'SELECT id,source,createdAt FROM User WHERE source=? ORDER BY id',
			'Synthetic',
		).filter(
			(u) =>
				typeof u.createdAt === 'string' &&
				u.createdAt <= hot.additions[0]!.createdAt,
		)
		for (const [i, slot] of hot.additions.entries()) {
			const user = query<Row>(
				'SELECT id,createdAt FROM User WHERE id=?',
				slot.authorId,
			)[0]!
			if (
				typeof user.createdAt !== 'string' ||
				user.createdAt > slot.createdAt
			) {
				slot.authorId = pool[(i * 13) % pool.length]!.id
				repaired++
			}
		}
		for (const slot of hot.additions)
			if (slot.parentId)
				slot.replyToAuthorId = hot.additions.find(
					(c) => c.id === slot.parentId,
				)!.authorId
	}
	if (repaired) {
		const { digest: _digest, ...body } = plan
		plan.digest = hash(body)
		await writeFile(
			join(directory, 'plan-before-time-repair.json'),
			JSON.stringify(prior, null, 2),
		)
		await writeContentCacheFile(
			join(cache, namespace, 'plan-before-time-repair.json'),
			JSON.stringify(prior, null, 2),
		)
		await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2))
		await writeContentCacheFile(
			join(cache, namespace, 'plan.json'),
			JSON.stringify(plan, null, 2),
		)
	}
	console.log(JSON.stringify({ repairedTimeSlots: repaired }))
}
{
	for (const hot of plan.hot)
		for (const slot of hot.additions) {
			const actor = query<Row>(
				'SELECT id,source,createdAt FROM User WHERE id=?',
				slot.authorId,
			)[0]
			const parent = slot.parentId
				? hot.additions.find((c) => c.id === slot.parentId)
				: null
			if (
				actor?.source !== 'Synthetic' ||
				typeof actor.createdAt !== 'string' ||
				actor.createdAt > slot.createdAt ||
				slot.createdAt > '2026-11-04T18:22:02.496Z' ||
				slot.createdAt < hot.post.createdAt ||
				(parent && (parent.parentId || parent.createdAt > slot.createdAt))
			)
				throw Error('COHORT_TIME_OR_PARENT_INVALID:' + slot.id)
		}
}
database.close()
const { digest, ...planBody } = plan
if (digest !== hash(planBody)) throw Error('PLAN_DIGEST_CHANGED')
const person = (id: string) => personas.find((p) => p.id === id)
const parse = (text: string): unknown =>
	JSON.parse(
		text
			.trim()
			.replace(/^```(?:json)?\s*/, '')
			.replace(/\s*```$/, ''),
	)
const text = (value: unknown, max: number) => {
	if (typeof value !== 'string' || !value.trim() || value.length > max)
		throw Error('INVALID_DRAFT_TEXT')
	return validateAgentText(
		value
			.replace(/。/g, '\n')
			.replace(/\.+(?=\s|$)/g, '')
			.trim(),
		max,
	)
}
async function checkpoint(name: string, value: unknown) {
	const bytes = JSON.stringify(value, null, 2)
	await writeFile(join(directory, name), bytes)
	await writeContentCacheFile(join(cache, namespace, name), bytes)
}
const limit = Number(arg('--limit') ?? (mode === 'hot' ? 2 : 5))
const offset = Number(arg('--offset') ?? 0)
if (!Number.isSafeInteger(offset) || offset < 0) throw Error('INVALID_OFFSET')
if (mode === 'activities' && limit > 10) throw Error('ACTIVITY_BATCH_MAX_10')
if (
	!Number.isSafeInteger(limit) ||
	limit < 1 ||
	limit > (mode === 'hot' ? 14 : 120)
)
	throw Error('INVALID_LIMIT')
if (mode) {
	const budget = await readTaskBudget()
	if (budget.unlimited) throw Error('DS_UNLIMITED_UNEXPECTED')
	console.log(
		JSON.stringify({
			mode,
			remainingUsd: budget.remainingUsd,
			policy: COMMUNITY_VOICE_POLICY.version,
		}),
	)
}
if (mode === 'activities') {
	const pilotIds = ['a6', 'a8', 'a9', 'a10', 'a13']
	const selected = [...plan.activities]
		.sort(
			(a, b) =>
				(pilotIds.indexOf(a.activity.id) < 0
					? 999
					: pilotIds.indexOf(a.activity.id)) -
				(pilotIds.indexOf(b.activity.id) < 0
					? 999
					: pilotIds.indexOf(b.activity.id)),
		)
		.slice(offset, offset + limit)
	const prompt = JSON.stringify({
		task: '校正既有活动标题和正文的说话口气，不换主题，不改变参与条件。按原组织者身份写可读的活动介绍，不是私人朋友圈碎碎念，也不要机构公文和客服腔，不强塞粗口、梗或煽情。只输出JSON {activities:[{id,title,body}]}，恰好全部输入ID',
		policy: COMMUNITY_VOICE_POLICY,
		constraints: [
			'只改title/body，原正文中确定的物品、流程、参与条件、时间地点数字与要求必须保留，不增加证书学分费用或校规',
			'startsAt/endsAt/deadline/capacity/status/location等字段只作事实约束，不据当前状态把原邀请改为“已结束”回顾，不改活动时态和原始用途',
			'不使用中文句号或英文句末句号，不展示内部设定或生成来源',
		],
		activities: selected.map((a) => ({
			...a.activity,
			organizerPersona: person(a.activity.organizerId),
		})),
	})
	const raw = await runWritingBatch(
		namespace + '-activities-' + hash(prompt).slice(0, 24),
		prompt,
		{ maxTokens: 12000 },
	)
	await checkpoint('activities-raw-' + hash(prompt).slice(0, 12) + '.json', {
		raw,
		promptDigest: hash(prompt),
	})
	const result = parse(raw) as {
		activities: Array<{ id: string; title: string; body: string }>
	}
	if (
		!Array.isArray(result.activities) ||
		result.activities.length !== selected.length ||
		new Set(result.activities.map((a) => a.id)).size !== selected.length
	)
		throw Error('ACTIVITY_IDS')
	const drafts = selected.map((a) => {
		const d = result.activities.find((v) => v.id === a.activity.id)
		if (!d) throw Error('MISSING_ACTIVITY')
		return {
			id: d.id,
			title: text(d.title, 120),
			body: text(d.body, 20000),
			sourceGuard: a.guardSha256,
		}
	})
	await checkpoint(
		'activities-draft-' +
			(offset ? offset + '-' : '') +
			selected.length +
			'.json',
		{
			planDigest: plan.digest,
			policyVersion: COMMUNITY_VOICE_POLICY.version,
			activities: drafts,
		},
	)
}
if (mode === 'hot') {
	const selected = arg('--post-id')
		? plan.hot.filter((h) => h.post.id === arg('--post-id'))
		: plan.hot.slice(0, limit)
	if (!selected.length) throw Error('HOT_SELECTION_EMPTY')
	for (const h of selected) {
		const checkpointPath = join(directory, 'hot-' + h.post.id + '-draft.json')
		try {
			const existing = JSON.parse(await readFile(checkpointPath, 'utf8')) as {
				guardSha256: string
				comments: Comment[]
			}
			if (
				existing.guardSha256 !== h.guardSha256 ||
				existing.comments.length !== h.comments.length + h.additions.length
			)
				throw Error('EXISTING_HOT_DRAFT_CONFLICT')
			console.log('EXISTING_HOT_DRAFT:' + h.post.id)
			continue
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
		}
		const request = {
			task: '为这一个已有帖子校正原评论口气，并追加一串自然较长讨论。原post保持不变，只输出JSON {postId,comments:[{id,body}]}，comments恰好覆盖原评论和所有新增槽位ID。不是每个人都吵架，不要把讨论写成公平完整辩论赛。先有各自关心点、某句误会或冒犯，再看是否争起来，有认真回应、旁观、半句、争执、偏题，允许嘴硬和戛然而止，不强制结局。',
			policy: COMMUNITY_VOICE_POLICY,
			interactionPlan: h.interactionPlan,
			contract: [
				'绝不改任何ID/作者/时间/parentId，只生成每个固定槽位body',
				'原评论保留原本讨论对象和已给出的具体事实，仅校正语气，不否定帖子已确定背景',
				'parentId是数据库一层根评论，replyToCommentId和replyToAuthorId才是这句话具体接的前一条与说话人，两者可能不同。若不是直接接根评论，使用短引用或自然提及对方昵称让目标能还原，不每条机械@，不能串说话人，楼主不问自己原帖所问之事',
				'各条必须按给定时间顺序可理解，档案profileAsOf晚于帖子时不能倒灌之后的个人事件，无真实friend上下文不编熟人旧事',
				'私人经历可虚构成模拟世界新状态，禁止编学校官方规则/收费/活动权威结论，不编图文附件',
				'不把原文、情绪和每个参与者都写成同一套礼貌客服，不必每个槽位都提供信息，不按比例硬塞脏话，不使用中文句号/英文句末句号',
			],
			post: h.post,
			existingComments: h.comments,
			additions: h.additions,
			actors: [
				...new Set([
					h.post.authorId,
					...h.comments.map((c) => c.authorId),
					...h.additions.map((c) => c.authorId),
				]),
			].map(person),
		}
		const prompt = JSON.stringify(request),
			key = hash(prompt).slice(0, 24)
		const raw = await runWritingBatch(
			namespace + '-hot-' + h.post.id + '-' + key,
			prompt,
			{ maxTokens: 18000 },
		)
		await checkpoint('hot-' + h.post.id + '-raw-' + key + '.json', {
			raw,
			promptDigest: hash(prompt),
		})
		const result = parse(raw) as {
			postId: string
			comments: Array<{ id: string; body: string }>
		}
		const expected = [...h.comments, ...h.additions]
		if (
			result.postId !== h.post.id ||
			!Array.isArray(result.comments) ||
			result.comments.length !== expected.length ||
			new Set(result.comments.map((c) => c.id)).size !== expected.length ||
			expected.some((c) => !result.comments.some((d) => d.id === c.id))
		)
			throw Error('HOT_COMMENT_COVERAGE')
		await checkpoint('hot-' + h.post.id + '-draft.json', {
			planDigest: plan.digest,
			guardSha256: h.guardSha256,
			policyVersion: COMMUNITY_VOICE_POLICY.version,
			postId: h.post.id,
			comments: expected.map((c) => ({
				...c,
				body: text(result.comments.find((d) => d.id === c.id)!.body, 2000),
			})),
		})
	}
}
if (publication) {
	interface ActivityDraft {
		id: string
		title: string
		body: string
		sourceGuard: string
	}
	interface HotDraft {
		postId: string
		guardSha256: string
		comments: Comment[]
	}
	interface Approval {
		status: string
		scope: string
		planDigest: string
		draftDigests: Record<string, string>
	}
	const activityDrafts: ActivityDraft[] = [],
		hotDrafts: HotDraft[] = [],
		draftDigests: Record<string, string> = {}
	if (publication === 'activities') {
		const path = arg('--draft-file')
		if (!path) throw Error('ACTIVITY_DRAFT_FILE_REQUIRED')
		const draft = JSON.parse(await readFile(resolve(path), 'utf8')) as {
			activities: ActivityDraft[]
		}
		if (
			!Array.isArray(draft.activities) ||
			!draft.activities.length ||
			new Set(draft.activities.map((a) => a.id)).size !==
				draft.activities.length
		)
			throw Error('ACTIVITY_DRAFT_IDS')
		draftDigests[resolve(path)] = hash(draft)
		for (const d of draft.activities) {
			const original = plan.activities.find((a) => a.activity.id === d.id)
			if (!original || d.sourceGuard !== original.guardSha256)
				throw Error('ACTIVITY_SOURCE_MISMATCH')
			activityDrafts.push({
				...d,
				title: text(d.title, 120),
				body: text(d.body, 20000),
			})
		}
	} else {
		for (const h of plan.hot.slice(0, limit)) {
			const file = join(directory, 'hot-' + h.post.id + '-draft.json')
			const d = JSON.parse(await readFile(file, 'utf8')) as HotDraft
			if (d.postId !== h.post.id || d.guardSha256 !== h.guardSha256)
				throw Error('HOT_SOURCE_MISMATCH')
			const expected = [...h.comments, ...h.additions]
			if (
				d.comments.length !== expected.length ||
				new Set(d.comments.map((c) => c.id)).size !== expected.length
			)
				throw Error('HOT_IDS')
			for (const c of expected) {
				const written = d.comments.find((v) => v.id === c.id)
				if (
					!written ||
					hash({ ...written, body: undefined }) !==
						hash({ ...c, body: undefined })
				)
					throw Error('HOT_METADATA_CHANGED:' + c.id)
				written.body = text(written.body, 2000)
			}
			draftDigests[file] = hash(d)
			hotDrafts.push(d)
		}
	}
	const payloadDigest = hash({
		publication,
		planDigest: plan.digest,
		draftDigests,
	})
	const receiptId = namespace + ':' + publication + ':' + payloadDigest
	const apply = process.argv.includes('--apply')
	if (apply) {
		const path = arg('--approval')
		if (!path) throw Error('EXPLICIT_REVIEW_APPROVAL_REQUIRED')
		const a = JSON.parse(await readFile(resolve(path), 'utf8')) as Approval
		if (
			a.status !== 'approved' ||
			!['production', 'isolated-rehearsal'].includes(a.scope) ||
			a.planDigest !== plan.digest ||
			hash(a.draftDigests) !== hash(draftDigests)
		)
			throw Error('APPROVAL_MISMATCH')
		if (
			a.scope === 'isolated-rehearsal' &&
			(!bundleRoot ||
				(await realpath(databasePath)) ===
					(await realpath(resolve('.data/pulse.db'))) ||
				(await realpath(bundleRoot)) === (await realpath(resolve('.'))))
		)
			throw Error('ISOLATION_REQUIRED')
	}
	const preparedSnapshots = new Map<
		string,
		{ beforeDigest: string; snapshot: Snapshot }
	>()
	const snapshotDirectory = apply
		? await ensureContentCache({ ...bundleOptions, kind: 'snapshots' })
		: null
	if (apply) {
		// Preserve the original cohort time and only append declared extension IDs, never live rows.
		for (const file of ['natural-v3.json', 'natural-v3-media.json']) {
			const beforeBytes = await readFile(join(snapshotDirectory!, file), 'utf8')
			const snapshot = JSON.parse(beforeBytes) as Snapshot
			if (snapshot.now !== '2026-11-04T18:22:02.496Z')
				throw Error('SNAPSHOT_TIME_CHANGED_BEFORE_DB_COMMIT')
			for (const a of activityDrafts) {
				const current = snapshot.activities.find((v) => v.id === a.id)
				if (!current || current.source !== 'Synthetic')
					throw Error('SNAPSHOT_ACTIVITY_MISSING_BEFORE_DB_COMMIT')
				current.title = a.title
				current.body = a.body
			}
			for (const d of hotDrafts) {
				const h = plan.hot.find((v) => v.post.id === d.postId)!
				for (const c of d.comments) {
					const old = snapshot.comments.find((v) => v.id === c.id)
					if (old) old.body = c.body
					else if (h.additions.some((v) => v.id === c.id))
						snapshot.comments.push({
							id: c.id,
							postId: c.postId,
							authorId: c.authorId,
							parentId: c.parentId,
							body: c.body,
							createdAt: c.createdAt,
							source: 'Synthetic',
							mediaIds: [],
						})
					else throw Error('SNAPSHOT_ORIGINAL_COMMENT_MISSING_BEFORE_DB_COMMIT')
				}
			}
			const errors = validateSnapshot(snapshot)
			if (errors.length)
				throw Error(
					'SNAPSHOT_VALIDATION_BEFORE_DB_COMMIT:' +
						errors.slice(0, 15).join(','),
				)
			preparedSnapshots.set(file, { beforeDigest: hash(beforeBytes), snapshot })
		}
	}
	const writer = new Database(databasePath, {
		readonly: !apply,
		fileMustExist: true,
	})
	const read = <T>(sql: string, ...params: string[]) =>
		writer.prepare(sql).all(...params) as T[]
	const prior = read<Row>(
		'SELECT * FROM ContentImportReceipt WHERE id=?',
		receiptId,
	)[0]
	const verify = () => {
		if (publication === 'hot') {
			const expectedPictured = Number(arg('--expected-pictured') ?? 300)
			if (
				!Number.isSafeInteger(expectedPictured) ||
				expectedPictured < 1 ||
				expectedPictured > 1000
			)
				throw Error('INVALID_EXPECTED_PICTURED')
			const pictured = read<{ count: number }>(
				"SELECT count(*) AS count FROM Post WHERE source='Synthetic' AND mediaIds <> '[]'",
			)[0]!.count
			if (pictured !== expectedPictured)
				throw Error(
					'IMAGE_PUBLICATION_NOT_COMPLETE:' + pictured + '/' + expectedPictured,
				)
		}
		for (const d of activityDrafts) {
			const a = plan.activities.find((v) => v.activity.id === d.id)!
			if (
				hash(read<Activity>('SELECT * FROM Activity WHERE id=?', d.id)[0]) !==
				a.guardSha256
			)
				throw Error('ACTIVITY_CHANGED:' + d.id)
			const related = read<Post>(
				'SELECT * FROM Post WHERE activityId=? ORDER BY id',
				d.id,
			).map((post) => ({
				post,
				comments: read<Comment>(
					'SELECT * FROM Comment WHERE postId=? ORDER BY id',
					post.id,
				),
			}))
			if (hash(contextIdentity(related)) !== a.linkedThreadsSha256)
				throw Error('ACTIVITY_CONTEXT_CHANGED:' + d.id)
		}
		for (const d of hotDrafts) {
			const h = plan.hot.find((v) => v.post.id === d.postId)!
			const source = {
				post: read<Post>('SELECT * FROM Post WHERE id=?', d.postId)[0],
				comments: read<Comment>(
					'SELECT * FROM Comment WHERE postId=? ORDER BY createdAt,id',
					d.postId,
				),
			}
			if (hash(source) !== h.guardSha256)
				throw Error('HOT_REAL_LIVE_OR_SOURCE_CHANGED:' + d.postId)
			for (const slot of h.additions) {
				const actor = read<Row>(
					'SELECT id,source,createdAt FROM User WHERE id=?',
					slot.authorId,
				)[0]
				if (
					actor?.source !== 'Synthetic' ||
					typeof actor.createdAt !== 'string' ||
					actor.createdAt > slot.createdAt ||
					slot.createdAt > '2026-11-04T18:22:02.496Z' ||
					read<Row>('SELECT id FROM Comment WHERE id=?', slot.id).length
				)
					throw Error('HOT_ACTOR_TIME_OR_ID_CHANGED:' + slot.id)
			}
		}
	}
	try {
		if (prior) {
			if (prior.digest !== payloadDigest) throw Error('RECEIPT_CONFLICT')
			// Replay must not overwrite a subsequent user edit while repairing archives.
			for (const d of activityDrafts) {
				const a = plan.activities.find((v) => v.activity.id === d.id)!
				if (
					hash(read<Activity>('SELECT * FROM Activity WHERE id=?', d.id)[0]) !==
					hash({ ...a.activity, title: d.title, body: d.body })
				)
					throw Error('APPLIED_ACTIVITY_DRIFT')
			}
			for (const d of hotDrafts) {
				const h = plan.hot.find((v) => v.post.id === d.postId)!
				if (
					hash(read<Post>('SELECT * FROM Post WHERE id=?', d.postId)[0]) !==
					hash(h.post)
				)
					throw Error('APPLIED_POST_DRIFT')
				const actual = read<Comment>(
					'SELECT * FROM Comment WHERE postId=?',
					d.postId,
				)
				if (actual.length !== d.comments.length)
					throw Error('APPLIED_HOT_LIVE_DRIFT')
				for (const c of d.comments) {
					const row = actual.find((v) => v.id === c.id)
					const before = h.comments.find((v) => v.id === c.id)
					const expected = before
						? { ...before, body: c.body }
						: {
								id: c.id,
								postId: c.postId,
								authorId: c.authorId,
								parentId: c.parentId,
								body: c.body,
								createdAt: c.createdAt,
								source: 'Synthetic',
								mediaIds: '[]',
								deletedAt: null,
							}
					if (hash(row) !== hash(expected))
						throw Error('APPLIED_COMMENT_DRIFT:' + c.id)
				}
			}
		} else if (apply) {
			writer
				.transaction(() => {
					verify()
					for (const a of activityDrafts)
						writer
							.prepare('UPDATE Activity SET title=?,body=? WHERE id=?')
							.run(a.title, a.body, a.id)
					for (const d of hotDrafts) {
						const h = plan.hot.find((v) => v.post.id === d.postId)!
						for (const c of d.comments) {
							if (h.comments.some((v) => v.id === c.id))
								writer
									.prepare('UPDATE Comment SET body=? WHERE id=?')
									.run(c.body, c.id)
							else
								writer
									.prepare(
										"INSERT INTO Comment(id,postId,authorId,parentId,body,createdAt,source,mediaIds) VALUES(?,?,?,?,?,?,?,'[]')",
									)
									.run(
										c.id,
										c.postId,
										c.authorId,
										c.parentId,
										c.body,
										c.createdAt,
										'Synthetic',
									)
						}
					}
					writer
						.prepare(
							'INSERT INTO ContentImportReceipt(id,version,digest,createdAt,counts) VALUES(?,?,?,?,?)',
						)
						.run(
							receiptId,
							namespace,
							payloadDigest,
							new Date().toISOString(),
							JSON.stringify({
								activities: activityDrafts.length,
								threads: hotDrafts.length,
								newComments: hotDrafts.reduce(
									(n, d) =>
										n +
										plan.hot.find((h) => h.post.id === d.postId)!.additions
											.length,
									0,
								),
							}),
						)
				})
				.immediate()
		} else verify()
	} finally {
		writer.close()
	}
	const receipt = {
		id: receiptId,
		digest: payloadDigest,
		publication,
		draftDigests,
		planDigest: plan.digest,
		committed: apply,
		alreadyCommitted: !!prior,
		at: new Date().toISOString(),
	}
	await checkpoint(
		'publication-' +
			publication +
			'-' +
			(apply ? 'receipt' : 'preflight') +
			'.json',
		receipt,
	)
	if (apply) {
		for (const [file, prepared] of preparedSnapshots) {
			if (
				hash(await readFile(join(snapshotDirectory!, file), 'utf8')) !==
				prepared.beforeDigest
			)
				throw Error('SNAPSHOT_CACHE_CHANGED_AFTER_DB_COMMIT')
			await writeCache(
				join(snapshotDirectory!, file),
				JSON.stringify(prepared.snapshot, null, 2),
				{ ...bundleOptions, kind: 'snapshots' },
			)
		}
		const extension = {
			version: 1,
			baseCohort: {
				users: 200,
				activities: 120,
				posts: 1000,
				comments: 3000,
				now: '2026-11-04T18:22:02.496Z',
			},
			receiptId,
			newCommentIds: hotDrafts.flatMap((d) =>
				plan.hot
					.find((h) => h.post.id === d.postId)!
					.additions.map((c) => c.id),
			),
			modifiedOriginalCommentIds: hotDrafts.flatMap((d) =>
				plan.hot.find((h) => h.post.id === d.postId)!.comments.map((c) => c.id),
			),
			liveRowsIncluded: false,
		}
		if (publication === 'hot')
			await checkpoint('cohort-extension-manifest.json', extension)
		const snapshots = await packContentCache({
			...bundleOptions,
			kind: 'snapshots',
		})
		if (!snapshots.cacheStateUpdated)
			throw Error('SNAPSHOT_ARCHIVE_COMMITTED_STATE_PENDING')
		const content = await packContentCache(bundleOptions)
		if (!content.cacheStateUpdated)
			throw Error('CONTENT_ARCHIVE_COMMITTED_STATE_PENDING')
	}
	console.log(JSON.stringify(receipt))
}
console.log(
	JSON.stringify({
		activities: plan.activities.length,
		blockedActivities: plan.blockedActivities,
		hot: plan.hot.length,
		newComments: plan.hot.reduce((n, h) => n + h.additions.length, 0),
		mainDatabaseWrites:
			publication && process.argv.includes('--apply')
				? 'see publication receipt'
				: 0,
	}),
)
