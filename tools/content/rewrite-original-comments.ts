/** Original Synthetic comment copy only. Read-only by default; no new posts/comments. */
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Post, Comment, Activity } from '../../generated/prisma/client.ts'
import type { Snapshot } from '@campus/contracts'
import { db } from '../../packages/domain/prisma.ts'
import { loadSnapshot } from '../../packages/domain/snapshot.ts'
import {
	buildCommunityThreadRequest,
	normalizeCommunityThreadDraft,
} from '../../packages/domain/community-thread-prompt.ts'
import { validateAgentText } from '../../packages/domain/agent-access.ts'
import { runWritingBatch } from './budget.ts'
import {
	buildCommunityCopyReviewRequest,
	assertCommunityCopyReview,
} from '../../packages/domain/community-copy-review.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
interface Thread {
	post: Post
	comments: Comment[]
	activity: Activity | null
	digest: string
}
interface Plan {
	version: 1
	generationMode?: 'native'
	namespace: string
	threads: Thread[]
	digest: string
}
interface Draft {
	contextDigest?: string
	postId: string
	comments: { id: string; body: string }[]
}
interface Approval {
	scope?: 'production' | 'isolated-rehearsal'
	status: string
	namespace: string
	planDigest: string
	draftDigests: Record<string, string>
}
interface Persona {
	id: string
	name?: string
	profileAsOf?: string
	knowledgeEdges?: { familiarWith?: string[] }
	writingHabits?: unknown
}
const arg = (k: string) =>
	process.argv.find((v) => v.startsWith(k + '='))?.slice(k.length + 1)
const namespace = arg('--namespace'),
	planPath = arg('--plan'),
	approvalPath = arg('--approval'),
	apply = process.argv.includes('--apply'),
	generate = process.argv.includes('--generate')
if (
	!namespace ||
	!/^[a-z0-9-]{1,90}$/.test(namespace) ||
	!planPath ||
	(apply && generate)
)
	throw Error('INVALID_ARGS')
const options = arg('--bundle-root')
	? { rootDirectory: resolve(arg('--bundle-root')!) }
	: {}
const cache = await ensureContentCache(options),
	directory = join(cache, namespace),
	snapshotCache = await ensureContentCache({ ...options, kind: 'snapshots' })
const json = async <T>(p: string) =>
	JSON.parse(await readFile(resolve(p), 'utf8')) as T
function canonical(v: unknown): string {
	return Array.isArray(v)
		? '[' + v.map(canonical).join(',') + ']'
		: v && typeof v === 'object'
			? '{' +
				Object.entries(v)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
					.join(',') +
				'}'
			: JSON.stringify(v)
}
const hash = (v: unknown) =>
	createHash('sha256').update(canonical(v)).digest('hex')
const preset = await json<Snapshot>(
	join(snapshotCache, 'natural-v3-media.json'),
)
const postIds = new Set(preset.posts.map((p) => p.id)),
	commentIds = new Set(preset.comments.map((c) => c.id))
const inventory = await json<{
	rows: {
		id: string
		hasRealOrLiveExtra: boolean
		presetCommentCount: number
	}[]
}>('.data/community-images-v3/remaining-v5-final-scope-inventory.json')
const web = await json<{ postIds: string[] }>(
		'.data/community-images-v3/web70-selection.json',
	),
	hot = await json<{ hot: { post: { id: string } }[] }>(
		'.data/activity-conflicts-v5/plan.json',
	)
const exclusions = new Set([
	...web.postIds,
	...hot.hot.map((h) => h.post.id),
	'p164',
	'p168',
	'p174',
	'p291',
])
const safeOriginalIds = new Set(
	inventory.rows
		.filter(
			(r) =>
				!r.hasRealOrLiveExtra &&
				r.presetCommentCount > 0 &&
				!exclusions.has(r.id),
		)
		.map((r) => r.id),
)
const users = await db.user.findMany({ select: { id: true, source: true } }),
	syntheticUsers = new Set(
		users.filter((u) => u.source === 'Synthetic').map((u) => u.id),
	)
const activityWorld = (a: Activity | null) => {
	if (!a) return null
	const { title: _title, body: _body, ...world } = a
	return world
}
async function checkThread(t: Thread, applied?: Draft) {
	if (
		!safeOriginalIds.has(t.post.id) ||
		!postIds.has(t.post.id) ||
		t.post.source !== 'Synthetic' ||
		!syntheticUsers.has(t.post.authorId) ||
		!t.comments.length
	)
		throw Error('UNSAFE_THREAD:' + t.post.id)
	const p = await db.post.findUnique({ where: { id: t.post.id } }),
		comments = await db.comment.findMany({
			where: { postId: t.post.id },
			orderBy: { id: 'asc' },
		})
	if (hash(p) !== hash(t.post) || comments.length !== t.comments.length)
		throw Error('THREAD_CHANGED_ABORT:' + t.post.id)
	for (const c of t.comments) {
		const expected = applied
				? { ...c, body: applied.comments.find((d) => d.id === c.id)!.body }
				: c,
			current = comments.find((d) => d.id === c.id)
		if (
			c.source !== 'Synthetic' ||
			!commentIds.has(c.id) ||
			!syntheticUsers.has(c.authorId) ||
			c.deletedAt ||
			JSON.parse(c.mediaIds).length ||
			hash(current) !== hash(expected)
		)
			throw Error('COMMENT_CHANGED_ABORT:' + c.id)
	}
	if (
		t.activity &&
		hash(
			activityWorld(
				await db.activity.findUnique({ where: { id: t.activity.id } }),
			),
		) !== hash(activityWorld(t.activity))
	)
		throw Error('ACTIVITY_WORLD_CHANGED:' + t.post.id)
}
if (process.argv.includes('--prepare')) {
	const offset = Number(arg('--offset') ?? 0),
		limit = Number(arg('--limit') ?? 8)
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 40
	)
		throw Error('INVALID_BATCH_BOUNDS')
	const requested = arg('--ids')?.split(',')
	const selected = (
		requested ??
		[...safeOriginalIds].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
	).slice(offset, offset + limit)
	const threads: Thread[] = []
	for (const id of selected) {
		const post = await db.post.findUniqueOrThrow({ where: { id } }),
			comments = await db.comment.findMany({
				where: { postId: id },
				orderBy: { id: 'asc' },
			}),
			activity = post.activityId
				? await db.activity.findUnique({ where: { id: post.activityId } })
				: null,
			input = { post, comments, activity }
		const t = { ...input, digest: hash(input) }
		await checkThread(t)
		threads.push(t)
	}
	const body = { version: 1 as const, namespace, threads },
		p = { ...body, digest: hash(body) }
	await mkdir(resolve(planPath, '..'), { recursive: true })
	await writeFile(resolve(planPath), JSON.stringify(p, null, 2) + '\n', {
		flag: 'wx',
	})
	console.log(
		JSON.stringify({
			phase: 'prepared',
			threads: threads.length,
			comments: threads.reduce((n, t) => n + t.comments.length, 0),
			digest: p.digest,
			databaseWritten: false,
		}),
	)
	await db.$disconnect()
	process.exit(0)
}
const plan = await json<Plan>(planPath),
	{ digest: planDigest, ...body } = plan
if (
	hash(body) !== planDigest ||
	plan.namespace !== namespace ||
	plan.version !== 1 ||
	!plan.threads.length ||
	new Set(plan.threads.map((t) => t.post.id)).size !== plan.threads.length ||
	plan.threads.some(
		(t) =>
			t.digest !==
			hash({ post: t.post, comments: t.comments, activity: t.activity }),
	)
)
	throw Error('PLAN_BODY_CHANGED')
await mkdir(directory, { recursive: true })
function validate(t: Thread, v: unknown): Draft {
	if (!v || typeof v !== 'object' || Array.isArray(v))
		throw Error('DRAFT_OBJECT_REQUIRED')
	const r = v as Record<string, unknown>
	if (
		Object.keys(r).some(
			(k) => !['postId', 'comments', 'contextDigest'].includes(k),
		) ||
		(r.contextDigest !== undefined &&
			(typeof r.contextDigest !== 'string' ||
				!/^[a-f0-9]{64}$/.test(r.contextDigest))) ||
		r.postId !== t.post.id ||
		!Array.isArray(r.comments) ||
		r.comments.length !== t.comments.length
	)
		throw Error('DRAFT_STRUCTURE')
	const comments = r.comments.map((v: unknown) => {
		if (!v || typeof v !== 'object' || Array.isArray(v))
			throw Error('COMMENT_OBJECT')
		const c = v as Record<string, unknown>
		if (
			Object.keys(c).some((k) => !['id', 'body'].includes(k)) ||
			typeof c.id !== 'string' ||
			typeof c.body !== 'string' ||
			!c.body.trim()
		)
			throw Error('COMMENT_SHAPE')
		return {
			id: c.id,
			body: validateAgentText(c.body.trim(), 2000),
		}
	})
	if (
		new Set(comments.map((c) => c.id)).size !== t.comments.length ||
		t.comments.some((c) => !comments.some((d) => d.id === c.id))
	)
		throw Error('COMMENT_ID_MISMATCH')
	return {
		postId: t.post.id,
		comments,
		...(r.contextDigest ? { contextDigest: r.contextDigest as string } : {}),
	}
}
const drafts = new Map<string, Draft>()
const nativeDraftPath = arg('--native-draft')
if (nativeDraftPath) {
	if (
		generate ||
		apply ||
		plan.generationMode !== 'native' ||
		!namespace.includes('-native-')
	)
		throw Error('NATIVE_REQUIRES_DISTINCT_NATIVE_PLAN_NAMESPACE')
	const raw = await json<unknown>(nativeDraftPath)
	const rows = Array.isArray(raw)
		? raw
		: (raw as { threads?: unknown[] })?.threads
	if (!Array.isArray(rows) || rows.length !== plan.threads.length)
		throw Error('NATIVE_BATCH_STRUCTURE')
	const normalized: Draft[] = []
	for (const t of plan.threads) {
		await checkThread(t)
		const row = rows.find(
			(v) => (v as { postId?: string })?.postId === t.post.id,
		)
		const draft = validate(t, row)
		const target = join(directory, 'thread-' + t.digest + '.json')
		try {
			const old = await json<Draft>(target)
			if (hash(old) !== hash(draft))
				throw Error('NATIVE_CACHE_OVERWRITE_BLOCKED')
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
		normalized.push(draft)
	}
	if (
		new Set(rows.map((v) => (v as { postId: string }).postId)).size !==
		rows.length
	)
		throw Error('NATIVE_DUPLICATE_POST')
	const provenance = {
		mode: 'native',
		model: 'gpt-6.1-sol',
		reasoningEffort: 'medium',
		apiRequest: false,
		actualFee: 'unknown-native-runtime-not-accounted-in-DS-ledger',
		planDigest,
		sourceDraftSha256: hash(raw),
		at: new Date().toISOString(),
	}
	for (const t of plan.threads)
		await writeContentCacheFile(
			join(directory, 'thread-' + t.digest + '.json'),
			JSON.stringify(
				normalized.find((d) => d.postId === t.post.id),
				null,
				2,
			) + '\n',
			options,
		)
	await writeContentCacheFile(
		join(directory, 'draft.json'),
		JSON.stringify(normalized, null, 2) + '\n',
		options,
	)
	await writeContentCacheFile(
		join(directory, 'native-provenance.json'),
		JSON.stringify(provenance, null, 2) + '\n',
		options,
	)
	const packed = await packContentCache(options)
	if (!packed.cacheStateUpdated) throw Error('NATIVE_ARCHIVE_PENDING')
	console.log(
		JSON.stringify({
			phase: 'native-ingested',
			threads: normalized.length,
			comments: normalized.reduce((n, d) => n + d.comments.length, 0),
			databaseWritten: false,
			apiRequest: false,
		}),
	)
	await db.$disconnect()
	process.exit(0)
}
if (generate) {
	const people = new Map(
			(
				await json<Persona[]>(join(cache, 'pulse-natural-v3/personas.json'))
			).map((p) => [p.id, p]),
		),
		friendships = await db.friendship.findMany({
			where: { status: 'ACCEPTED' },
		})
	async function generateOne(t: Thread) {
		await checkThread(t)
		const actors = new Set([
			t.post.authorId,
			...t.comments.map((comment) => comment.authorId),
		])
		const personas = [...actors].map((id) => ({
			id,
			name: people.get(id)?.name,
			knowledgeEdges: people.get(id)?.knowledgeEdges,
		}))
		const threadInput = {
			post: t.post,
			comments: t.comments,
			activity: t.activity,
			participants: personas,
			relationshipPairs: friendships
				.filter(
					(friendship) =>
						actors.has(friendship.requesterId) &&
						actors.has(friendship.recipientId) &&
						friendship.createdAt <= t.post.createdAt,
				)
				.map((friendship) => ({
					left: friendship.requesterId,
					right: friendship.recipientId,
				})),
		}
		const writingRequest = buildCommunityThreadRequest(threadInput)
		const reviewSource = {
			scene: JSON.parse(writingRequest.prompt),
			structure: t.comments.map(({ id, authorId, parentId }) => ({
				id,
				authorId,
				parentId,
			})),
			participants: personas,
		}
		const contextDigest = hash({
			writingRequest,
			reviewRequest: buildCommunityCopyReviewRequest(reviewSource, null),
		})
		const path = join(directory, 'thread-' + t.digest + '.json')
		try {
			const cached = validate(t, await json(path))
			if (cached.contextDigest !== contextDigest)
				throw Error('GENERATION_CONTEXT_CHANGED_USE_NEW_NAMESPACE:' + t.post.id)
			drafts.set(t.post.id, cached)
			return
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
		const rejectionPath = join(
			directory,
			'rejected-' + t.digest + '-' + contextDigest + '.json',
		)
		try {
			await readFile(rejectionPath)
			throw Error(
				'DRAFT_PREVIOUSLY_REJECTED_USE_NEW_CONTEXT_OR_NAMESPACE:' + t.post.id,
			)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
		const rawPath = join(
			directory,
			'raw-' + t.digest + '-' + contextDigest + '.json',
		)
		let result: string
		try {
			result = (await json<{ text: string }>(rawPath)).text
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
			result = await runWritingBatch(
				namespace + '-' + t.digest + '-' + contextDigest.slice(0, 24),
				writingRequest.prompt,
				{
					api: 'openai-responses',
					systemPrompt: writingRequest.systemPrompt,
					maxTokens: 10000,
					timeoutMs: 180000,
				},
			)
			await writeContentCacheFile(
				rawPath,
				JSON.stringify({ text: result }) + '\n',
				options,
			)
		}
		try {
			const value: unknown = JSON.parse(
				result.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''),
			)
			const draft = {
				...validate(t, normalizeCommunityThreadDraft(threadInput, value)),
				contextDigest,
			}
			const reviewRequest = buildCommunityCopyReviewRequest(reviewSource, draft)
			const reviewOutput = await runWritingBatch(
				namespace + '-review-' + t.digest + '-' + contextDigest.slice(0, 24),
				reviewRequest.prompt,
				{
					api: 'openai-responses',
					systemPrompt: reviewRequest.systemPrompt,
					maxTokens: 4096,
					timeoutMs: 180000,
				},
			)
			assertCommunityCopyReview(
				JSON.parse(reviewOutput.replace(/^```(?:json)?\s*|\s*```$/g, '')),
				draft.comments.map((comment) => comment.body).join('\n'),
			)
			await writeContentCacheFile(
				path,
				JSON.stringify(draft, null, 2) + '\n',
				options,
			)
			drafts.set(t.post.id, draft)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (
				error instanceof SyntaxError ||
				message.startsWith('INVALID_MODEL_RESULT:') ||
				/^(DRAFT_|COMMENT_|AGENT_)/.test(message)
			)
				await writeContentCacheFile(
					rejectionPath,
					JSON.stringify({ contextDigest, error: message }) + '\n',
					options,
				)
			throw error
		}
		console.log(
			JSON.stringify({
				phase: 'draft-ready',
				postId: t.post.id,
				comments: t.comments.length,
			}),
		)
	}

	let next = 0
	let stopped = false
	const workers = await Promise.allSettled(
		Array.from({ length: Math.min(3, plan.threads.length) }, async () => {
			while (!stopped && next < plan.threads.length) {
				const t = plan.threads[next++]!
				try {
					await generateOne(t)
				} catch (error) {
					stopped = true
					throw error
				}
			}
		}),
	)
	const failedWorker = workers.find((r) => r.status === 'rejected')
	if (failedWorker?.status === 'rejected') throw failedWorker.reason
	await writeContentCacheFile(
		join(directory, 'draft.json'),
		JSON.stringify(
			plan.threads.map((t) => drafts.get(t.post.id)),
			null,
			2,
		) + '\n',
		options,
	)
	await packContentCache(options)
	console.log(
		JSON.stringify({
			phase: 'generated',
			threads: drafts.size,
			databaseWritten: false,
		}),
	)
	await db.$disconnect()
	process.exit(0)
}
for (const t of plan.threads)
	drafts.set(
		t.post.id,
		validate(t, await json(join(directory, 'thread-' + t.digest + '.json'))),
	)
const payloadDigest = hash({
	planDigest,
	drafts: plan.threads.map((t) => drafts.get(t.post.id)),
})
const approval = approvalPath ? await json<Approval>(approvalPath) : undefined
if (
	apply &&
	(!approval ||
		approval.status !== 'approved' ||
		!['production', 'isolated-rehearsal'].includes(approval.scope ?? '') ||
		approval.namespace !== namespace ||
		approval.planDigest !== planDigest ||
		plan.threads.some(
			(t) => approval.draftDigests[t.post.id] !== hash(drafts.get(t.post.id)),
		))
)
	throw Error('APPROVAL_REQUIRED')
if (
	apply &&
	approval?.scope === 'isolated-rehearsal' &&
	(!arg('--bundle-root') ||
		!process.env.DATABASE_URL?.startsWith('file:') ||
		(await realpath(process.env.DATABASE_URL.slice(5))) ===
			(await realpath(resolve('.data/pulse.db'))))
)
	throw Error('ISOLATION_REQUIRED')
const receiptId = 'community-original-comments-v5:' + namespace
// Whole-thread guards and body-only writes share a SQLite transaction; no live comment is removed.
const result = await db.$transaction(
	async (tx) => {
		const prior = await tx.contentImportReceipt.findUnique({
			where: { id: receiptId },
		})
		if (prior && prior.digest !== payloadDigest) throw Error('RECEIPT_CONFLICT')
		for (const t of plan.threads) {
			const post = await tx.post.findUnique({ where: { id: t.post.id } }),
				comments = await tx.comment.findMany({
					where: { postId: t.post.id },
					orderBy: { id: 'asc' },
				}),
				draft = drafts.get(t.post.id)!
			if (
				!safeOriginalIds.has(t.post.id) ||
				hash(post) !== hash(t.post) ||
				comments.length !== t.comments.length
			)
				throw Error('THREAD_CHANGED_ABORT:' + t.post.id)
			for (const c of t.comments) {
				const expected = prior
					? { ...c, body: draft.comments.find((d) => d.id === c.id)!.body }
					: c
				if (
					c.source !== 'Synthetic' ||
					!syntheticUsers.has(c.authorId) ||
					!commentIds.has(c.id) ||
					c.deletedAt ||
					JSON.parse(c.mediaIds).length ||
					hash(comments.find((v) => v.id === c.id)) !== hash(expected)
				)
					throw Error('COMMENT_CHANGED_ABORT:' + c.id)
			}
			const ids = [t.post.authorId, ...t.comments.map((c) => c.authorId)],
				actors = await tx.user.findMany({
					where: { id: { in: ids } },
					select: { id: true, source: true },
				})
			if (
				actors.some((u) => u.source !== 'Synthetic') ||
				!actors.some((u) => u.id === t.post.authorId) ||
				post?.source !== 'Synthetic'
			)
				throw Error('ACTOR_SOURCE_DRIFT')
			if (
				t.activity &&
				hash(
					activityWorld(
						await tx.activity.findUnique({ where: { id: t.activity.id } }),
					),
				) !== hash(activityWorld(t.activity))
			)
				throw Error('ACTIVITY_WORLD_CHANGED')
		}
		if (!apply)
			return {
				alreadyApplied: Boolean(prior),
				threads: plan.threads.length,
				comments: plan.threads.reduce((n, t) => n + t.comments.length, 0),
				databaseWritten: false,
			}
		if (!prior) {
			for (const d of drafts.values())
				for (const c of d.comments)
					await tx.comment.update({
						where: { id: c.id },
						data: { body: c.body },
					})
			await tx.contentImportReceipt.create({
				data: {
					id: receiptId,
					version: 'community-original-comments-v5',
					digest: payloadDigest,
					createdAt: new Date().toISOString(),
					counts: JSON.stringify({
						threads: plan.threads.length,
						comments: plan.threads.reduce((n, t) => n + t.comments.length, 0),
					}),
				},
			})
		}
		return {
			alreadyApplied: Boolean(prior),
			threads: plan.threads.length,
			comments: plan.threads.reduce((n, t) => n + t.comments.length, 0),
			databaseWritten: !prior,
		}
	},
	{ timeout: 120000 },
)
if (apply) {
	await writeContentCacheFile(
		join(directory, 'publish-receipt.json'),
		JSON.stringify(
			{
				receiptId,
				payloadDigest,
				...result,
				databaseCommitted: true,
				archivesPublished: false,
			},
			null,
			2,
		) + '\n',
		options,
	)
	const live = await loadSnapshot(undefined, { crossDomain: false })
	function refresh<T extends { id: string; source: string }>(
		old: T[],
		now: T[],
	) {
		const index = new Map(now.map((v) => [v.id, v]))
		return old.map((v) => {
			const row = index.get(v.id)
			if (!row || row.source !== 'Synthetic') throw Error('COHORT_SOURCE_DRIFT')
			return row
		})
	}
	preset.users = refresh(preset.users, live.users)
	preset.posts = refresh(preset.posts, live.posts)
	preset.comments = refresh(preset.comments, live.comments)
	preset.activities = refresh(preset.activities, live.activities)
	await writeContentCacheFile(
		join(snapshotCache, 'natural-v3-media.json'),
		JSON.stringify(preset, null, 2) + '\n',
		{ ...options, kind: 'snapshots' },
	)
	const snaps = await packContentCache({ ...options, kind: 'snapshots' })
	if (!snaps.cacheStateUpdated) throw Error('SNAPSHOT_ARCHIVE_PENDING')
	await writeContentCacheFile(
		join(directory, 'publish-receipt.json'),
		JSON.stringify(
			{
				receiptId,
				payloadDigest,
				...result,
				databaseCommitted: true,
				archivesPublished: true,
			},
			null,
			2,
		) + '\n',
		options,
	)
	const pack = await packContentCache(options)
	if (!pack.cacheStateUpdated) throw Error('CONTENT_ARCHIVE_PENDING')
}
console.log(
	JSON.stringify({
		phase: apply ? 'published' : 'preflight',
		receiptId,
		payloadDigest,
		planDigest,
		...result,
		draftDigests: Object.fromEntries(
			[...drafts].map(([id, d]) => [id, hash(d)]),
		),
	}),
)
await db.$disconnect()
