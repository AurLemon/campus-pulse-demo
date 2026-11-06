/** Apply the reviewed 200-person Synthetic cohort. No model calls or worker start. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { Snapshot } from '@campus/contracts'
import type { AgentPersona } from '@campus/contracts/agents'
import { db } from '../../packages/domain/prisma.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
import {
	resolveSnapshotFile,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { topics } from './catalog.ts'
interface Profile extends Omit<
	AgentPersona,
	| 'actorId'
	| 'grade'
	| 'interests'
	| 'activeHours'
	| 'activityWeight'
	| 'cooldownMinutes'
	| 'relationships'
> {
	id: string
	bio: string
	interests: Record<string, number>
	source: 'Synthetic'
}
interface BeforeUser {
	id: string
	name: string
	bio: string
	interests: string
	source: string
	role: string
	campus: string
}
interface Before {
	users: BeforeUser[]
	personas: unknown[]
}
const root = resolve('.data/personas-v4'),
	hash = (v: unknown) =>
		createHash('sha256').update(JSON.stringify(v)).digest('hex')
const json = async <T>(path: string): Promise<T> =>
	JSON.parse(await readFile(path, 'utf8')) as T
const profiles = await json<Profile[]>(join(root, 'personas-200.json')),
	before = await json<Before>(join(root, 'before-200.json'))
const allowed = new Set(topics.map((t) => t.tag)),
	ids = new Set(profiles.map((p) => p.id)),
	names = new Set(profiles.map((p) => p.name.normalize('NFKC').toLowerCase()))
if (
	profiles.length !== 200 ||
	ids.size !== 200 ||
	names.size !== 200 ||
	before.users.length !== 200 ||
	before.users.some((u) => !ids.has(u.id))
)
	throw Error('PERSONA_COHORT_INVALID')
for (const p of profiles) {
	if (
		p.source !== 'Synthetic' ||
		p.name.length < 4 ||
		p.name.length > 30 ||
		!p.ordinaryLifeFacts?.length ||
		!p.currentMotives?.length ||
		!p.writingHabits ||
		!p.knowledgeEdges ||
		!p.voice ||
		!p.routine ||
		!p.profileAsOf ||
		Object.entries(p.interests).some(
			([k, v]) => !allowed.has(k) || !Number.isFinite(v) || v < 0 || v > 1,
		)
	)
		throw Error(`PROFILE_INVALID:${p.id}`)
}
const planDigest = hash(profiles),
	receiptId = 'personas-v5:' + planDigest
async function apply() {
	const old = new Map(before.users.map((u) => [u.id, u]))
	const cache = await ensureContentCache(),
		dir = join(cache, 'pulse-personas-v5')
	const save = async (name: string, value: unknown) =>
		writeContentCacheFile(
			join(dir, name),
			JSON.stringify(value, null, '\t') + '\n',
		)
	// Preserve old published fields and internal profiles before any database update.
	await save('before-200.json', before)
	await save('personas-200.json', profiles)
	await save('reply-samples-v5.json', {
		source: 'Synthetic',
		text: await readFile(join(root, 'reply-samples-v5.md'), 'utf8'),
	})
	const initialPack = await packContentCache()
	if (!initialPack.cacheStateUpdated)
		throw Error('PERSONA_BACKUP_ARCHIVE_STATE_PENDING')
	const publicSelect = {
		id: true,
		name: true,
		bio: true,
		interests: true,
		source: true,
		role: true,
		campus: true,
	} as const
	const realBefore = await db.user.findMany({
			where: { source: 'Real' },
			select: publicSelect,
		}),
		realDigest = hash(realBefore)
	const result = await db.$transaction(
		async (tx) => {
			const receipt = await tx.contentImportReceipt.findUnique({
				where: { id: receiptId },
			})
			if (receipt) return JSON.parse(receipt.counts) as { users: number }
			const users = await tx.user.findMany({
				where: { id: { in: [...ids] } },
				select: publicSelect,
			})
			if (users.length !== 200) throw Error('PERSONA_USER_MISSING')
			const collisions = await tx.user.count({
				where: {
					id: { notIn: [...ids] },
					name: { in: profiles.map((p) => p.name) },
				},
			})
			if (collisions) throw Error('PERSONA_NICKNAME_COLLISION')
			for (const u of users) {
				const b = old.get(u.id)
				if (
					!b ||
					u.source !== 'Synthetic' ||
					u.name !== b.name ||
					u.bio !== b.bio ||
					u.interests !== b.interests ||
					u.role !== b.role ||
					u.campus !== b.campus
				)
					throw Error(`PERSONA_CHANGED_ABORT:${u.id}`)
			}
			for (const p of profiles)
				await tx.user.update({
					where: { id: p.id },
					data: {
						name: p.name,
						bio: p.bio,
						interests: JSON.stringify(p.interests),
					},
				})
			const counts = { users: profiles.length }
			await tx.contentImportReceipt.create({
				data: {
					id: receiptId,
					version: 'campus-personas-v5',
					digest: planDigest,
					createdAt: new Date().toISOString(),
					counts: JSON.stringify(counts),
				},
			})
			return counts
		},
		{ timeout: 60000 },
	)
	// Commit above remains durable if a subsequent archive operation needs recovery.
	if (
		hash(
			await db.user.findMany({
				where: { source: 'Real' },
				select: publicSelect,
			}),
		) !== realDigest
	)
		throw Error('REAL_PROFILE_CHANGED_DURING_PUBLICATION')
	await writeContentCacheFile(
		join(cache, 'pulse-natural-v3', 'personas.json'),
		JSON.stringify(profiles, null, '\t') + '\n',
	)
	const profilesById = new Map(profiles.map((p) => [p.id, p])),
		cohorts = []
	for (const file of ['natural-v3.json', 'natural-v3-media.json']) {
		const snapshot = await json<Snapshot>(await resolveSnapshotFile(file))
		if (
			snapshot.users.length !== 200 ||
			snapshot.posts.length !== 1000 ||
			snapshot.comments.length !== 3000 ||
			snapshot.users.some((u) => u.source !== 'Synthetic' || !ids.has(u.id))
		)
			throw Error(`PRESET_COHORT_CHANGED:${file}`)
		snapshot.users = snapshot.users.map((u) => {
			const p = profilesById.get(u.id)!
			return { ...u, name: p.name, bio: p.bio, interests: p.interests }
		})
		await writeSnapshotFile(file, JSON.stringify(snapshot, null, '\t') + '\n')
		cohorts.push({
			file,
			users: snapshot.users.length,
			posts: snapshot.posts.length,
			comments: snapshot.comments.length,
		})
	}
	await publishSnapshots()
	await save('receipt.json', {
		at: new Date().toISOString(),
		receiptId,
		result,
		planDigest,
		cohorts,
		realPublicProfilesPreserved: true,
		nonEmptyBio: profiles.filter((p) => p.bio).length,
		modelRequests: 0,
		workerStarted: false,
	})
	const packed = await packContentCache()
	if (!packed.cacheStateUpdated)
		throw Error('PERSONA_CONTENT_ARCHIVE_STATE_PENDING_AFTER_COMMIT')
	console.log(
		JSON.stringify({
			receiptId,
			result,
			cohorts,
			realPublicProfilesPreserved: true,
			modelRequests: 0,
			workerStarted: false,
		}),
	)
}
try {
	if (process.argv.includes('--apply')) await apply()
	else
		console.log(
			JSON.stringify({
				phase: 'reviewed',
				users: profiles.length,
				digest: planDigest,
				paidRequests: 0,
			}),
		)
} finally {
	await db.$disconnect()
}
