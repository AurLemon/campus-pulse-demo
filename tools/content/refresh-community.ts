import { assignSnapshotPosters } from './poster.ts'
import {
	resolveSnapshotFile,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { readFile, mkdir, readdir } from 'node:fs/promises'
import { runWritingBatch, readLedger, reconcileWritingJobs } from './budget.ts'
import type { Snapshot } from '@campus/contracts'
import { join } from 'node:path'
import {
	ensureContentCache,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'
import { validateSnapshot } from './validate.ts'

interface Persona {
	id: string
	name: string
	bio: string
	voice: string
	circle: string
}
interface WrittenComment {
	id: string
	body: string
}
interface WrittenPost {
	id: string
	title: string
	body: string
	purpose: 'RECRUITMENT' | 'REVIEW' | 'GUIDE' | 'DISCUSSION'
	comments: WrittenComment[]
}
interface WrittenActivity {
	id: string
	title: string
	body: string
}
if (process.argv.includes('--dry-run')) {
	console.log(
		JSON.stringify({
			mode: 'dry-run',
			action: 'refresh-community',
			posts:
				process.argv.find((value) => value.startsWith('--posts='))?.slice(8) ??
				'1000',
			sampleOnly:
				process.argv.includes('--sample') ||
				process.argv.some((value) => value.startsWith('--offset=')),
			cacheOpened: false,
		}),
	)
	process.exit(0)
}
const contentCache = await ensureContentCache()
const directory = join(contentCache, 'pulse-v2')
await mkdir(`${directory}/posts`, { recursive: true })
await mkdir(`${directory}/invalid`, { recursive: true })
const snapshot = JSON.parse(
	await readFile(await resolveSnapshotFile('full.json'), 'utf8'),
) as Snapshot
// The current approved content target is 1000 posts. Keep the original baseline untouched.
const postCountArgument = process.argv.find((value) =>
	value.startsWith('--posts='),
)
const targetPostCount = postCountArgument
	? Number(postCountArgument.slice(8))
	: 1000
if (
	!Number.isInteger(targetPostCount) ||
	targetPostCount < 1 ||
	targetPostCount > snapshot.posts.length
)
	throw new Error('INVALID_POST_TARGET')
snapshot.posts = snapshot.posts.filter((p) => {
	const id = Number(p.id.slice(1))
	return Number.isInteger(id) && id >= 1 && id <= targetPostCount
})
const keptPostIds = new Set(snapshot.posts.map((p) => p.id))
snapshot.comments = snapshot.comments.filter((c) => keptPostIds.has(c.postId))
snapshot.states = snapshot.states.filter(
	(row) => !row.postId || keptPostIds.has(row.postId),
)
snapshot.behaviors = snapshot.behaviors.filter(
	(row) => !row.postId || keptPostIds.has(row.postId),
)
snapshot.sessions = snapshot.sessions.filter(
	(row) => !row.postId || keptPostIds.has(row.postId),
)

const originalPosts = new Map(snapshot.posts.map((p) => [p.id, p]))
const activities = new Map(snapshot.activities.map((a) => [a.id, a]))
const commentMap = new Map(
	snapshot.posts.map((p) => [
		p.id,
		snapshot.comments.filter((c) => c.postId === p.id),
	]),
)
const rules = `你在为“在场”校园社区写虚构人物的原创内容，只返回严格JSON，不写解释。
不是运营号，不全员热情，不每个人都写完整经历、动机、过程、结论。普通人在小红书/贴吧聊天，有短问题，有顺嘴补充，有认真长评。有人空格换行，有人正常标点，按作者voice保持差异。
淘汰“我试了两次/卡住/室友说”重复模板。不全员“蹲/救命/家人们/哈哈哈”。不故意错别字，不全员无标点，不写“首先其次最后”的教案。不统一以“我学到的是/总之/总结一下”升华，事情没解决可以停。
允许质疑、纠正、善意小吐槽、犹豫、不参加，不攻击人格。不杜撰学校认证、规定、具体地址、钱、证书或学分。不要编具体日期、星期或时刻，UI显示活动时间。
禁用：赋能、宝子们、干货满满、收获满满、期待与你相遇、别错过、快来加入、氛围感拉满。不出现合成/演示/课设/数据集/生成指令。不得用中点分隔符。`
function parsePayload(raw: string): unknown {
	const cleaned = raw
		.trim()
		.replace(/^```(?:json)?\s*/, '')
		.replace(/\s*```$/, '')
	if (/Request exceeded \d+s limit|Upstream request failed/.test(cleaned))
		throw new Error('UPSTREAM_INTERRUPTED_CONTENT')
	let quoted = false,
		escaped = false,
		normalized = ''
	for (const ch of cleaned) {
		if (quoted && ch.charCodeAt(0) < 32) {
			normalized += JSON.stringify(ch).slice(1, -1)
			escaped = false
			continue
		}
		normalized += ch
		if (escaped) {
			escaped = false
			continue
		}
		if (ch.charCodeAt(0) === 92 && quoted) {
			escaped = true
			continue
		}
		if (ch === '"') quoted = !quoted
	}
	return JSON.parse(normalized) as unknown
}
function validatePost(value: unknown): WrittenPost {
	if (!value || typeof value !== 'object')
		throw new Error('INVALID_POST_OBJECT')
	const post = value as WrittenPost,
		original = originalPosts.get(post.id)
	if (
		!original ||
		typeof post.title !== 'string' ||
		!post.title.trim() ||
		typeof post.body !== 'string' ||
		!post.body.trim() ||
		!Array.isArray(post.comments)
	)
		throw new Error('INVALID_POST')
	if (!['RECRUITMENT', 'REVIEW', 'GUIDE', 'DISCUSSION'].includes(post.purpose))
		throw new Error(`INVALID_PURPOSE:${post.id}`)
	const expected = commentMap.get(post.id) ?? []
	if (
		post.comments.length !== expected.length ||
		new Set(post.comments.map((c) => c.id)).size !== expected.length ||
		expected.some(
			(c) =>
				!post.comments.some(
					(w) => w?.id === c.id && typeof w.body === 'string' && w.body.trim(),
				),
		)
	)
		throw new Error(`COMMENT_IDS_MISMATCH:${post.id}`)
	const text = JSON.stringify(post)
	if (/Request exceeded \d+s limit|Upstream request failed|[·]/.test(text))
		throw new Error(`INVALID_CONTENT:${post.id}`)
	// Specific dates in generated prose become incorrect when a snapshot is re-anchored.
	if (
		/\d{1,2}月\d{1,2}|\d{1,2}[号日]|\d{1,2}[:：]\d{2}|[一二三四五六七八九十]{1,3}号/.test(
			post.title + ' ' + post.body,
		)
	)
		throw new Error(`ABSOLUTE_DATE_IN_CONTENT:${post.id}`)
	const activity = original.activityId
		? activities.get(original.activityId)
		: undefined
	if (
		post.purpose === 'REVIEW' &&
		activity &&
		original.createdAt <= activity.endsAt
	)
		throw new Error(`FUTURE_ACTIVITY_REVIEW:${post.id}`)
	return post
}
const personas: Persona[] = []
for (let offset = 0; offset < snapshot.users.length; offset += 20) {
	const users = snapshot.users.slice(offset, offset + 20)
	const data = JSON.parse(
		await readFile(
			join(contentCache, 'pulse-v1', `people-${offset}.json`),
			'utf8',
		),
	) as { personas: Persona[] }
	if (
		data.personas.length !== users.length ||
		users.some(
			(u) =>
				!data.personas.some(
					(p) => p.id === u.id && typeof p.name === 'string' && p.name.trim(),
				),
		)
	)
		throw new Error('PERSONA_IDS_INVALID')
	personas.push(...data.personas)
}
const people = new Map(personas.map((p) => [p.id, p]))
for (const user of snapshot.users) {
	const p = people.get(user.id)!
	user.name = p.name
	user.bio = p.bio
}
await writeContentCacheFile(
	`${directory}/personas.json`,
	JSON.stringify(personas, null, '\t'),
)
for (let offset = 0; offset < snapshot.activities.length; offset += 12) {
	const expected = snapshot.activities.slice(offset, offset + 12),
		data = JSON.parse(
			await readFile(`${directory}/activities-${offset}.json`, 'utf8'),
		) as { activities: WrittenActivity[] }
	if (
		!Array.isArray(data.activities) ||
		data.activities.length !== expected.length ||
		expected.some(
			(a) =>
				!data.activities.some(
					(w) => w.id === a.id && w.title?.trim() && w.body?.trim(),
				),
		)
	)
		throw new Error(`ACTIVITY_IDS_MISMATCH:${offset}`)
	for (const a of expected) {
		const w = data.activities.find((item) => item.id === a.id)!
		a.title = w.title
		a.body = w.body
	}
}
// A stopped dispatcher may leave provider processes finishing their result files. Wait for those
// bounded requests and reconcile them, rather than pay for the same input twice.
for (let pass = 0; pass < 65; pass++) {
	await reconcileWritingJobs()
	const running = (await readLedger()).entries.filter(
		(e) => e.status === 'running',
	)
	if (!running.length) break
	if (pass === 64) throw new Error('UNRECONCILED_RUNNING_JOBS')
	if (pass % 6 === 0)
		console.log(
			JSON.stringify({ phase: 'recover-pending', running: running.length }),
		)
	await new Promise((r) => setTimeout(r, 5000))
}
const written = new Map<string, WrittenPost>()
let newlyWritten = 0
async function store(post: WrittenPost, newContent = false) {
	if (written.has(post.id)) return
	written.set(post.id, post)
	await writeContentCacheFile(
		`${directory}/posts/${post.id}.json`,
		JSON.stringify(post, null, '\t'),
	)
	if (newContent) newlyWritten++
}
for (const file of (await readdir(directory))
	.filter((name) => /^threads-\d+(?:-(?:1|3|6))?\.json$/.test(name))
	.sort((a, b) => a.localeCompare(b))) {
	try {
		const value = JSON.parse(
			await readFile(`${directory}/${file}`, 'utf8'),
		) as { posts: unknown[] }
		if (!Array.isArray(value.posts)) throw new Error('INVALID_BATCH')
		for (const item of value.posts) {
			try {
				await store(validatePost(item))
			} catch (error) {
				console.log(
					JSON.stringify({
						phase: 'invalid-cached-post',
						file,
						error: String(error),
					}),
				)
			}
		}
	} catch (error) {
		console.log(
			JSON.stringify({ phase: 'invalid-cache', file, error: String(error) }),
		)
	}
}
for (const file of (await readdir(`${directory}/posts`)).filter((name) =>
	/^p\d+\.json$/.test(name),
)) {
	try {
		await store(
			validatePost(
				JSON.parse(await readFile(`${directory}/posts/${file}`, 'utf8')),
			),
		)
	} catch (error) {
		console.log(
			JSON.stringify({
				phase: 'invalid-post-cache',
				file,
				error: String(error),
			}),
		)
	}
}
// Recover complete provider output which was not yet checkpointed by an interrupted dispatcher.
for (const entry of (await readLedger()).entries.filter(
	(e) => e.status === 'complete' && e.id.startsWith('pulse-v2-threads-'),
)) {
	try {
		const result = JSON.parse(
			await readFile(`${entry.job}/result.json`, 'utf8'),
		) as { text: string }
		const value = parsePayload(result.text) as { posts?: unknown[] }
		if (Array.isArray(value.posts))
			for (const item of value.posts) {
				try {
					const post = validatePost(item)
					if (!written.has(post.id)) await store(post)
				} catch {
					/* Invalid individual posts stay unadopted; their raw result is preserved. */
				}
			}
	} catch {
		/* Provider success is not proof of valid JSON. */
	}
}
console.log(
	JSON.stringify({
		phase: 'cache',
		covered: written.size,
		people: personas.length,
		activities: snapshot.activities.length,
	}),
)
const offsetArgument = process.argv.find((value) =>
		value.startsWith('--offset='),
	),
	onlyOffset = offsetArgument ? Number(offsetArgument.slice(9)) : undefined
if (
	onlyOffset !== undefined &&
	(!Number.isInteger(onlyOffset) ||
		onlyOffset < 0 ||
		onlyOffset % 6 !== 0 ||
		onlyOffset >= targetPostCount)
)
	throw new Error('INVALID_BATCH_OFFSET')
const sampleOnly = process.argv.includes('--sample') || onlyOffset !== undefined
const offsets =
	onlyOffset !== undefined
		? [onlyOffset]
		: sampleOnly
			? [0, 120, 240]
			: Array.from(
					{ length: Math.ceil(snapshot.posts.length / 6) },
					(_, i) => i * 6,
				)
const failures: Array<{ ids: string[]; error: string }> = []
let checkpointQueue: Promise<void> = Promise.resolve()
function checkpoint(
	phase: 'generating' | 'packaging' | 'complete' = 'generating',
) {
	const content = JSON.stringify(
		{
			version: `pulse-v2-${targetPostCount}`,
			phase,
			covered: written.size,
			total: snapshot.posts.length,
			newlyWritten,
			failures,
			at: new Date().toISOString(),
		},
		null,
		'\t',
	)
	checkpointQueue = checkpointQueue.then(() =>
		writeContentCacheFile(join(directory, 'progress.json'), content),
	)
	return checkpointQueue
}

function contextFor(id: string) {
	const p = originalPosts.get(id)!,
		activity = p.activityId ? activities.get(p.activityId) : undefined
	return {
		id: p.id,
		isAnnouncement: Number(p.id.slice(1)) <= snapshot.activities.length,
		legacyTopic: p.title,
		tags: p.tags,
		kind: p.kind,
		author: people.get(p.authorId),
		activity: activity
			? {
					id: activity.id,
					title: activity.title,
					body: activity.body,
					tags: activity.tags,
					location: activity.location,
					campus: activity.campus,
					canReview: p.createdAt > activity.endsAt,
				}
			: null,
		comments: (commentMap.get(p.id) ?? []).map((c) => ({
			id: c.id,
			parentId: c.parentId,
			author: people.get(c.authorId),
		})),
	}
}
async function produce(ids: string[], depth = 0): Promise<void> {
	if (dispatchStopped) return
	const pending = ids.filter((id) => !written.has(id))
	if (!pending.length) return
	const tries = pending.length > 3 ? 1 : pending.length > 1 ? 2 : 3
	let lastError = 'CONTENT_NOT_GENERATED'
	for (let attempt = 0; attempt < tries; attempt++) {
		if (dispatchStopped) return
		const input = pending.filter((id) => !written.has(id)).map(contextFor)
		if (!input.length) return
		try {
			const prompt = `直接写${input.length}篇帖子及每篇全部评论。legacyTopic只是主题线索，别照抄旧经历。人物圈层按author。isAnnouncement为true写该activity招募，其他写准备/疑问/体验；只有canReview为true才可回顾该活动。无关联帖围绕校园活动参与或兴趣圈。普通正文8–160字，自然长短混合；ARTICLE正文300–600字，允许留疑问，不统一升华。标题4–25字。评论1–45字，回应其parentId对应内容，别替主办人乱承诺。完整保留输入的每个帖子id和评论id，不增加或删除，不改变作者关系。绝对不写具体日期、星期、几点。purpose只用英文 RECRUITMENT/REVIEW/GUIDE/DISCUSSION。输出严格JSON {posts:[{id,title,body,purpose,comments:[{id,body}]}]}。输入：${JSON.stringify(input)}`
			const raw = await runWritingBatch(
				`pulse-v2-threads-${pending.map((id) => id.slice(1)).join('_')}-${Date.now()}-${attempt}`,
				`${rules}\n${prompt}`,
				{
					api: attempt === 0 ? 'openai-responses' : 'openai-completions',
					maxTokens: 16384,
					timeoutMs: 300000,
				},
			)
			const result = parsePayload(raw) as { posts?: unknown[] }
			if (!Array.isArray(result.posts)) throw new Error('INVALID_POST_ARRAY')
			for (const item of result.posts) {
				try {
					const post = validatePost(item)
					if (input.some((expected) => expected.id === post.id))
						await store(post, true)
				} catch (error) {
					lastError = String(error)
				}
			}
			await checkpoint()
			console.log(
				JSON.stringify({
					phase: 'threads',
					requested: input.map((p) => p.id),
					covered: written.size,
					total: snapshot.posts.length,
				}),
			)
			if (pending.every((id) => written.has(id))) return
		} catch (error) {
			lastError = String(error)
			if (/BUDGET_LIMIT|BUDGET_STOPPED|PI_PRICING_UNKNOWN/.test(lastError))
				throw error
			console.log(
				JSON.stringify({
					phase: 'retry',
					ids: pending,
					attempt,
					depth,
					error: lastError.slice(0, 200),
				}),
			)
		}
	}
	const remaining = pending.filter((id) => !written.has(id))
	if (!remaining.length) return
	if (remaining.length > 1) {
		const size = remaining.length > 3 ? 3 : 1
		for (let offset = 0; offset < remaining.length; offset += size)
			await produce(remaining.slice(offset, offset + size), depth + 1)
		return
	}
	failures.push({ ids: remaining, error: lastError })
	await checkpoint()
}
await checkpoint()
let cursor = 0
let dispatchStopped = false
const concurrency = Math.min(
	6,
	Math.max(1, Number(process.env.CAMPUS_CONTENT_CONCURRENCY) || 4),
)
const workerResults = await Promise.allSettled(
	Array.from({ length: Math.min(concurrency, offsets.length) }, async () => {
		try {
			while (!dispatchStopped && cursor < offsets.length) {
				const offset = offsets[cursor++]!
				const ids = snapshot.posts.slice(offset, offset + 6).map((p) => p.id)
				await produce(ids)
				const done = ids.flatMap((id) =>
					written.get(id) ? [written.get(id)!] : [],
				)
				if (done.length === ids.length) {
					const path = `${directory}/threads-${offset}-6.json`
					try {
						await writeContentCacheFile(
							`${directory}/invalid/threads-${offset}-6-${Date.now()}.json`,
							await readFile(path),
						)
					} catch (e) {
						if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
					}
					await writeContentCacheFile(
						path,
						JSON.stringify({ posts: done }, null, '\t'),
					)
				}
			}
		} catch (error) {
			dispatchStopped = true
			throw error
		}
	}),
)
// Let every already-started provider request and checkpoint settle before reporting a fatal worker failure.
await checkpointQueue
const failedWorker = workerResults.find(
	(result) => result.status === 'rejected',
)
if (failedWorker?.status === 'rejected') throw failedWorker.reason
if (
	failures.length ||
	(!sampleOnly && written.size !== snapshot.posts.length)
) {
	await checkpoint()
	throw new Error(
		`INCOMPLETE_CONTENT:${written.size}/${snapshot.posts.length};failed=${failures.flatMap((f) => f.ids).join(',')}`,
	)
}
for (const post of snapshot.posts) {
	const w = written.get(post.id)
	if (!w) continue
	post.title = w.title
	post.body = w.body
	post.purpose = w.purpose
	for (const comment of commentMap.get(post.id) ?? [])
		comment.body = w.comments.find((c) => c.id === comment.id)!.body
}
const campuses: Record<string, string> = {
	铜盘: '铜盘校区',
	旗山: '旗山校区',
	鼓山: '鼓山校区',
}
for (const entry of [...snapshot.users, ...snapshot.activities])
	entry.campus = campuses[entry.campus] ?? entry.campus
snapshot.version = `campus-synthetic-pulse-v2-${targetPostCount}`
const anchor = new Date(),
	delta = anchor.getTime() - Date.parse(snapshot.now),
	shift = (v: string) => new Date(Date.parse(v) + delta).toISOString()
for (const list of [
	snapshot.users,
	snapshot.activities,
	snapshot.posts,
	snapshot.comments,
	snapshot.friendships,
	snapshot.follows,
	snapshot.states,
	snapshot.behaviors,
])
	for (const item of list) item.createdAt = shift(item.createdAt)
for (const a of snapshot.activities) {
	a.startsAt = shift(a.startsAt)
	a.endsAt = shift(a.endsAt)
	a.deadline = shift(a.deadline)
}
for (const s of snapshot.sessions) {
	s.startedAt = shift(s.startedAt)
	s.updatedAt = shift(s.updatedAt)
}
snapshot.now = anchor.toISOString()
Object.assign(snapshot, assignSnapshotPosters(snapshot))
const snapshotErrors = validateSnapshot(snapshot)
if (snapshotErrors.length)
	throw new Error(
		`INVALID_SNAPSHOT:${JSON.stringify(snapshotErrors.slice(0, 30))}`,
	)
await writeSnapshotFile(
	`pulse-${sampleOnly ? 'sample' : 'full'}.json`,
	JSON.stringify(snapshot, null, '\t'),
)
await checkpoint('packaging')
const snapshotBundle = await publishSnapshots()
const contentBundle = await packContentCache()
if (!contentBundle.cacheStateUpdated)
	throw new Error(
		'CONTENT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing the cache',
	)
await checkpoint('complete')
console.log(
	JSON.stringify({
		complete: true,
		contentBundle,
		snapshotBundle,
		sampleOnly,
		rewrittenPosts: written.size,
		newlyWritten,
		anchor: snapshot.now,
	}),
)
