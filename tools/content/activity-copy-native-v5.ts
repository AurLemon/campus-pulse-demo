/** Narrow Activity-only copy edit. Associated live text stays local and is guarded by hash. */
import Database from 'better-sqlite3'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Snapshot } from '@campus/contracts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
import { validateSnapshot } from './validate.ts'
interface Activity {
	id: string
	organizerId: string
	title: string
	body: string
	source: string
	[key: string]: unknown
}
interface Assignment {
	activity: Activity
	activityHash: string
	relatedContextHash: string
}
interface Plan {
	namespace: string
	version: number
	assignments: Assignment[]
	digest: string
}
interface Draft {
	id: string
	title: string
	body: string
}
const namespace = 'activity-copy-native-v5',
	directory = resolve('.data', namespace)
const arg = (key: string) =>
	process.argv.find((v) => v.startsWith(key + '='))?.slice(key.length + 1)
const apply = process.argv.includes('--apply')
const hash = (v: unknown) =>
	createHash('sha256').update(JSON.stringify(v)).digest('hex')
const db = new Database(resolve(arg('--database') ?? '.data/pulse.db'), {
	readonly: !apply,
	fileMustExist: true,
})
const activity = (id: string) =>
	db.prepare('SELECT * FROM Activity WHERE id=?').get(id) as
		Activity | undefined
const contextHash = (id: string) => {
	// Raw associated Real/live text is hashed locally and is never included in an author prompt or plan.
	const posts = db
		.prepare('SELECT * FROM Post WHERE activityId=? ORDER BY id')
		.all(id) as Array<{ id: string }>
	return hash(
		posts.map((post) => ({
			post,
			comments: db
				.prepare('SELECT * FROM Comment WHERE postId=? ORDER BY id')
				.all(post.id),
		})),
	)
}
await mkdir(directory, { recursive: true })
const cache = await ensureContentCache()
const save = async (name: string, value: unknown) => {
	const bytes = JSON.stringify(value, null, 2)
	await writeFile(join(directory, name), bytes)
	await writeContentCacheFile(join(cache, namespace, name), bytes)
}
if (process.argv.includes('--prepare')) {
	if (apply) throw Error('CANNOT_PREPARE_AND_APPLY')
	const existing = JSON.parse(
		await readFile('.data/activity-conflicts-v5/plan.json', 'utf8'),
	) as { blockedActivities: string[] }
	if (existing.blockedActivities.length !== 24)
		throw Error('EXPECTED_EXPLICIT_24_SCOPE')
	const assignments = existing.blockedActivities.map((id) => {
		const a = activity(id)
		if (!a || a.source !== 'Synthetic') throw Error('NOT_SYNTHETIC_ACTIVITY')
		const u = db
			.prepare('SELECT source,role FROM User WHERE id=?')
			.get(a.organizerId) as { source: string; role: string }
		if (u.source !== 'Synthetic' || u.role !== 'ORGANIZER')
			throw Error('ORGANIZER_CHANGED')
		return {
			activity: a,
			activityHash: hash(a),
			relatedContextHash: contextHash(id),
		}
	})
	const body = { namespace, version: 1, assignments }
	const plan = { ...body, digest: hash(body) }
	await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2), {
		flag: 'wx',
	})
	await writeContentCacheFile(
		join(cache, namespace, 'plan.json'),
		JSON.stringify(plan, null, 2),
	)
	console.log(
		JSON.stringify({
			phase: 'prepared',
			activities: 24,
			associatedLiveContentExported: false,
			databaseWritten: false,
		}),
	)
	db.close()
	process.exit(0)
}
const plan = JSON.parse(
	await readFile(join(directory, 'plan.json'), 'utf8'),
) as Plan
const { digest, ...body } = plan
if (
	hash(body) !== digest ||
	plan.namespace !== namespace ||
	plan.assignments.length !== 24
)
	throw Error('PLAN_CHANGED')
const draft = JSON.parse(
	await readFile(join(directory, 'draft.json'), 'utf8'),
) as { activities: Draft[]; provenance: { apiRequest: boolean; model: string } }
if (
	draft.provenance.apiRequest !== false ||
	draft.provenance.model !== 'gpt-6.1-sol' ||
	draft.activities.length !== 24 ||
	new Set(draft.activities.map((d) => d.id)).size !== 24
)
	throw Error('NATIVE_DRAFT_SHAPE')
for (const d of draft.activities) {
	if (
		!plan.assignments.some((a) => a.activity.id === d.id) ||
		!d.title.trim() ||
		!d.body.trim() ||
		d.title.length > 120 ||
		d.body.length > 20000 ||
		/[。]/.test(d.title + d.body)
	)
		throw Error('DRAFT_CONTENT')
}
const draftDigest = hash(draft),
	receiptDigest = hash({ planDigest: plan.digest, draftDigest }),
	receiptId = namespace + ':' + receiptDigest
if (apply) {
	const path = arg('--approval')
	if (!path) throw Error('REVIEW_APPROVAL_REQUIRED')
	const approval = JSON.parse(await readFile(path, 'utf8')) as {
		status: string
		scope: string
		planDigest: string
		draftDigest: string
	}
	if (
		approval.status !== 'approved' ||
		approval.scope !== 'production' ||
		approval.planDigest !== plan.digest ||
		approval.draftDigest !== draftDigest
	)
		throw Error('APPROVAL_MISMATCH')
}
const snapshotDirectory = await ensureContentCache({ kind: 'snapshots' })
const snapshots = new Map<string, { before: string; after: Snapshot }>()
for (const file of ['natural-v3.json', 'natural-v3-media.json']) {
	const before = await readFile(join(snapshotDirectory, file), 'utf8'),
		s = JSON.parse(before) as Snapshot
	for (const d of draft.activities) {
		const a = s.activities.find((a) => a.id === d.id)
		if (!a || a.source !== 'Synthetic') throw Error('SNAPSHOT_ACTIVITY_SOURCE')
		a.title = d.title
		a.body = d.body
	}
	const errors = validateSnapshot(s)
	if (errors.length)
		throw Error('SNAPSHOT_INVALID:' + errors.slice(0, 10).join(','))
	snapshots.set(file, { before: hash(before), after: s })
}
const prior = db
	.prepare('SELECT digest FROM ContentImportReceipt WHERE id=?')
	.get(receiptId) as { digest: string } | undefined
const verify = () => {
	for (const assignment of plan.assignments) {
		const a = activity(assignment.activity.id),
			d = draft.activities.find((d) => d.id === assignment.activity.id)!
		const expected = prior
			? { ...assignment.activity, title: d.title, body: d.body }
			: assignment.activity
		if (
			hash(a) !== hash(expected) ||
			contextHash(assignment.activity.id) !== assignment.relatedContextHash
		)
			throw Error('ACTIVITY_OR_LIVE_CONTEXT_CHANGED:' + assignment.activity.id)
	}
}
try {
	if (apply) {
		db.transaction(() => {
			verify()
			if (!prior) {
				for (const d of draft.activities)
					db.prepare('UPDATE Activity SET title=?,body=? WHERE id=?').run(
						d.title,
						d.body,
						d.id,
					)
				db.prepare(
					'INSERT INTO ContentImportReceipt(id,version,digest,createdAt,counts) VALUES(?,?,?,?,?)',
				).run(
					receiptId,
					namespace,
					receiptDigest,
					new Date().toISOString(),
					JSON.stringify({ activities: 24, posts: 0, comments: 0 }),
				)
			}
		}).immediate()
	} else verify()
} finally {
	db.close()
}
const receipt = {
	receiptId,
	receiptDigest,
	planDigest: plan.digest,
	draftDigest,
	committed: apply,
	alreadyCommitted: !!prior,
	activities: 24,
	associatedPostsChanged: 0,
	associatedCommentsChanged: 0,
	provenance: draft.provenance,
}
await save(apply ? 'publish-receipt.json' : 'preflight.json', receipt)
if (apply) {
	for (const [file, s] of snapshots) {
		if (
			hash(await readFile(join(snapshotDirectory, file), 'utf8')) !== s.before
		)
			throw Error('SNAPSHOT_CACHE_CHANGED_AFTER_DB_COMMIT')
		await writeContentCacheFile(
			join(snapshotDirectory, file),
			JSON.stringify(s.after, null, 2),
			{ kind: 'snapshots' },
		)
	}
	const snaps = await packContentCache({ kind: 'snapshots' })
	if (!snaps.cacheStateUpdated) throw Error('SNAPSHOT_ARCHIVE_STATE_PENDING')
	const content = await packContentCache()
	if (!content.cacheStateUpdated) throw Error('CONTENT_ARCHIVE_STATE_PENDING')
}
console.log(JSON.stringify(receipt))
