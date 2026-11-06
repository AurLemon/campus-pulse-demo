/** Offline Synthetic engagement records. Never writes aggregate counters or existing preferences. */
import Database from 'better-sqlite3'
import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import type { Snapshot, State, Behavior } from '@campus/contracts'
import { validateSnapshot } from './validate.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'

interface HotInput {
	hot: Array<{ post: { id: string }; additions: Array<{ id: string }> }>
}
interface UserRow {
	id: string
	source: string
	createdAt: string
}
interface PostRow {
	id: string
	authorId: string
	source: string
	createdAt: string
}
interface ReactionPlan {
	version: 1
	provenance: 'Synthetic fixture engagement, not real user activity'
	now: string
	posts: PostRow[]
	states: State[]
	behaviors: Behavior[]
	digest: string
}
const arg = (key: string) =>
	process.argv.find((v) => v.startsWith(key + '='))?.slice(key.length + 1)
const apply = process.argv.includes('--apply')
const root = arg('--bundle-root') ? resolve(arg('--bundle-root')!) : undefined
const options = root ? { rootDirectory: root } : {}
const databasePath = resolve(arg('--database') ?? '.data/pulse.db')
const mainDatabase = await realpath(resolve('.data/pulse.db'))
const actualDatabase = await realpath(databasePath)
const actualRoot = root ? await realpath(root) : await realpath('.')
const projectRoot = await realpath('.')
if (
	(actualDatabase !== mainDatabase && actualRoot === projectRoot) ||
	(actualDatabase === mainDatabase && actualRoot !== projectRoot)
)
	throw Error('ISOLATION_REQUIRED')
const database = new Database(databasePath, {
	readonly: !apply,
	fileMustExist: true,
})
database.pragma('foreign_keys = ON')
const cache = await ensureContentCache(options)
const snapshotCache = await ensureContentCache({
	...options,
	kind: 'snapshots',
})
const directory = join(cache, 'hot-reactions-v5')
const planFile = join(directory, 'plan.json')
const json = async <T>(file: string) =>
	JSON.parse(await readFile(file, 'utf8')) as T
function canonical(value: unknown): string {
	if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
	if (value && typeof value === 'object')
		return (
			'{' +
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
				.join(',') +
			'}'
		)
	return JSON.stringify(value)
}
const hash = (value: unknown) =>
	createHash('sha256').update(canonical(value)).digest('hex')
const unit = (value: string) =>
	Number.parseInt(hash(value).slice(0, 8), 16) / 0x100000000
const save = (file: string, value: unknown, kind?: 'snapshots') =>
	writeContentCacheFile(file, JSON.stringify(value, null, 2) + '\n', {
		...options,
		...(kind ? { kind } : {}),
	})
const preset = await json<Snapshot>(
	join(snapshotCache, 'natural-v3-media.json'),
)
const hot = await json<HotInput>(
	resolve(arg('--hot-plan') ?? '.data/activity-conflicts-v5/plan.json'),
)
if (
	hot.hot.length !== 14 ||
	preset.users.length !== 200 ||
	preset.posts.length !== 1000
)
	throw Error('COHORT_SCOPE_CHANGED')
const presetComments = new Set(preset.comments.map((comment) => comment.id))
for (const thread of hot.hot)
	for (const addition of thread.additions) {
		const row = database
			.prepare('SELECT source,postId FROM Comment WHERE id=?')
			.get(addition.id) as { source: string; postId: string } | undefined
		if (
			!row ||
			row.source !== 'Synthetic' ||
			row.postId !== thread.post.id ||
			!presetComments.has(addition.id)
		)
			throw Error('HOT_COMMENT_PUBLICATION_REQUIRED')
	}
let plan: ReactionPlan
if (process.argv.includes('--prepare')) {
	if (apply) throw Error('PREPARE_AND_APPLY_SEPARATE')
	const users = database
		.prepare(
			"SELECT id,source,createdAt FROM User WHERE source='Synthetic' ORDER BY id",
		)
		.all() as UserRow[]
	const cohortUsers = new Set(preset.users.map((user) => user.id))
	const posts: PostRow[] = [],
		states: State[] = [],
		behaviors: Behavior[] = []
	const now = Date.parse(preset.now)
	for (const { post: target } of hot.hot) {
		const post = database
			.prepare('SELECT id,authorId,source,createdAt FROM Post WHERE id=?')
			.get(target.id) as PostRow | undefined
		if (!post || post.source !== 'Synthetic')
			throw Error('SYNTHETIC_POST_REQUIRED')
		posts.push(post)
		const candidates = users
			.filter(
				(user) =>
					cohortUsers.has(user.id) &&
					user.id !== post.authorId &&
					Math.max(Date.parse(user.createdAt), Date.parse(post.createdAt)) +
						70000 <
						now &&
					!database
						.prepare('SELECT id FROM State WHERE userId=? AND postId=? LIMIT 1')
						.get(user.id, post.id) &&
					!database
						.prepare(
							'SELECT id FROM Behavior WHERE userId=? AND postId=? LIMIT 1',
						)
						.get(user.id, post.id),
			)
			.sort((a, b) => unit(post.id + a.id) - unit(post.id + b.id))
		const count = Math.min(
			candidates.length,
			22 + Math.floor(unit(post.id + 'likes') * 69),
		)
		const favorites = Math.min(
			count,
			2 + Math.floor(unit(post.id + 'favorites') * 14),
		)
		for (const [index, user] of candidates.slice(0, count).entries()) {
			const earliest =
				Math.max(Date.parse(user.createdAt), Date.parse(post.createdAt)) + 60000
			const at =
				earliest +
				Math.floor(unit(post.id + user.id + 'at') * (now - earliest - 5000))
			for (const kind of (index < favorites
				? ['LIKE', 'FAVORITE']
				: ['LIKE']) as Array<'LIKE' | 'FAVORITE'>) {
				const suffix = hash([user.id, post.id, kind]).slice(0, 22)
				const createdAt = new Date(
					at + (kind === 'FAVORITE' ? 1000 : 0),
				).toISOString()
				states.push({
					id: 'sv5hot-' + suffix,
					userId: user.id,
					postId: post.id,
					activityId: null,
					kind,
					createdAt,
				})
				behaviors.push({
					id: 'bv5hot-' + suffix,
					userId: user.id,
					postId: post.id,
					activityId: null,
					kind,
					createdAt,
					effectiveMs: 0,
				})
			}
		}
	}
	const body = {
		version: 1 as const,
		provenance: 'Synthetic fixture engagement, not real user activity' as const,
		now: preset.now,
		posts,
		states,
		behaviors,
	}
	plan = { ...body, digest: hash(body) }
	try {
		const old = await json<ReactionPlan>(planFile)
		if (old.digest !== plan.digest) throw Error('EXISTING_PLAN_CHANGED')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	await save(planFile, plan)
} else plan = await json<ReactionPlan>(planFile)
const { digest, ...body } = plan
if (
	hash(body) !== digest ||
	plan.version !== 1 ||
	plan.now !== preset.now ||
	plan.provenance !== 'Synthetic fixture engagement, not real user activity' ||
	new Set(plan.states.map((row) => row.id)).size !== plan.states.length ||
	plan.states.length !== plan.behaviors.length ||
	plan.posts.length !== 14
)
	throw Error('PLAN_CHANGED')
if (
	hash(plan.posts.map((post) => post.id).sort()) !==
	hash(hot.hot.map((thread) => thread.post.id).sort())
)
	throw Error('HOT_TARGET_SCOPE_CHANGED')
const projections = new Map<string, Snapshot>()
for (const file of ['natural-v3-media.json', 'natural-v3.json']) {
	const snapshot = await json<Snapshot>(join(snapshotCache, file))
	for (const key of ['states', 'behaviors'] as const)
		for (const row of plan[key]) {
			const old = snapshot[key].find((item) => item.id === row.id)
			if (old && hash(old) !== hash(row)) throw Error('SNAPSHOT_CONFLICT')
			if (!old) (snapshot[key] as Array<State | Behavior>).push(row)
		}
	const errors = validateSnapshot(snapshot)
	if (errors.length)
		throw Error('PROJECTED_SNAPSHOT_INVALID:' + errors.slice(0, 4).join(','))
	projections.set(file, snapshot)
}
const receiptId = 'hot-reactions-v5:' + digest
const checkAndApply = database.transaction(() => {
	const receipt = database
		.prepare('SELECT digest FROM ContentImportReceipt WHERE id=?')
		.get(receiptId) as { digest: string } | undefined
	if (receipt && receipt.digest !== digest) throw Error('RECEIPT_CONFLICT')
	for (const post of plan.posts)
		if (
			hash(
				database
					.prepare('SELECT id,authorId,source,createdAt FROM Post WHERE id=?')
					.get(post.id),
			) !== hash(post)
		)
			throw Error('POST_CHANGED')
	const checkedPairs = new Set<string>()
	for (const [index, state] of plan.states.entries()) {
		const behavior = plan.behaviors[index]!
		if (
			!['LIKE', 'FAVORITE'].includes(state.kind) ||
			behavior.kind !== state.kind ||
			state.userId !== behavior.userId ||
			state.postId !== behavior.postId ||
			state.createdAt !== behavior.createdAt ||
			!plan.posts.some((post) => post.id === state.postId)
		)
			throw Error('REACTION_PAIR_CHANGED')
		const user = database
			.prepare('SELECT id,source,createdAt FROM User WHERE id=?')
			.get(state.userId) as UserRow | undefined
		if (
			!user ||
			user.source !== 'Synthetic' ||
			!preset.users.some((entry) => entry.id === state.userId) ||
			Date.parse(state.createdAt) < Date.parse(user.createdAt) ||
			Date.parse(state.createdAt) > Date.parse(plan.now)
		)
			throw Error('SYNTHETIC_ACTOR_OR_CLOCK_CHANGED')
		if (receipt) {
			if (
				hash(
					database.prepare('SELECT * FROM State WHERE id=?').get(state.id),
				) !== hash(state) ||
				hash(
					database
						.prepare('SELECT * FROM Behavior WHERE id=?')
						.get(behavior.id),
				) !== hash(behavior)
			)
				throw Error('RECEIPT_REACTION_DRIFT')
			continue
		}
		const pair = state.userId + '|' + state.postId
		if (!checkedPairs.has(pair)) {
			if (
				database
					.prepare('SELECT id FROM State WHERE userId=? AND postId=? LIMIT 1')
					.get(state.userId, state.postId) ||
				database
					.prepare(
						'SELECT id FROM Behavior WHERE userId=? AND postId=? LIMIT 1',
					)
					.get(state.userId, state.postId)
			)
				throw Error('EXISTING_PREFERENCE_PROTECTED')
			checkedPairs.add(pair)
		}
		if (apply) {
			database
				.prepare(
					'INSERT INTO State(id,userId,postId,activityId,kind,createdAt) VALUES(@id,@userId,@postId,@activityId,@kind,@createdAt)',
				)
				.run(state)
			database
				.prepare(
					'INSERT INTO Behavior(id,userId,postId,activityId,kind,createdAt,effectiveMs) VALUES(@id,@userId,@postId,@activityId,@kind,@createdAt,@effectiveMs)',
				)
				.run(behavior)
		}
	}
	if (apply && !receipt)
		database
			.prepare(
				'INSERT INTO ContentImportReceipt(id,version,digest,createdAt,counts) VALUES(?,?,?,?,?)',
			)
			.run(
				receiptId,
				'hot-reactions-v5',
				digest,
				new Date().toISOString(),
				JSON.stringify({
					states: plan.states.length,
					behaviors: plan.behaviors.length,
				}),
			)
	return Boolean(receipt)
})
const alreadyApplied = checkAndApply()
if (apply) {
	for (const [file, snapshot] of projections)
		await save(join(snapshotCache, file), snapshot, 'snapshots')
	if (
		!(await packContentCache({ ...options, kind: 'snapshots' }))
			.cacheStateUpdated
	)
		throw Error('SNAPSHOT_ARCHIVE_STATE_PENDING_AFTER_COMMIT')
	await save(join(directory, 'cohort-extension.json'), {
		receiptId,
		source: 'Synthetic',
		stateIds: plan.states.map((row) => row.id),
		behaviorIds: plan.behaviors.map((row) => row.id),
		existingRecordsWritten: false,
		modelRequests: 0,
	})
	if (!(await packContentCache(options)).cacheStateUpdated)
		throw Error('CONTENT_ARCHIVE_STATE_PENDING_AFTER_COMMIT')
}
console.log(
	JSON.stringify({
		phase: apply ? 'published' : 'preflight',
		receiptId,
		digest,
		alreadyApplied,
		states: plan.states.length,
		behaviors: plan.behaviors.length,
		databaseWritten: apply && !alreadyApplied,
		modelRequests: 0,
	}),
)
database.close()
