import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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
import type { Snapshot } from '@campus/contracts'
interface NameSource {
	name: string
	sourceUrl: string
	listingUrl: string
}
const apply = process.argv.includes('--apply')
const existing = await readFile(
	'.data/community-refine-v2/receipt.json',
	'utf8',
).catch(() => null)
if (apply && existing) {
	console.log('ALREADY_APPLIED')
	await db.$disconnect()
	process.exit(0)
}
const candidates = JSON.parse(
	await readFile('.data/avatar-import-v2/public-names.json', 'utf8'),
) as NameSource[]
const users = await db.user.findMany({
	where: { source: 'Synthetic' },
	orderBy: { id: 'asc' },
})
if (users.length !== 200 || candidates.length < 200)
	throw Error('COHORT_OR_SOURCE_INCOMPLETE')
const ranked = candidates
	.map((x) => ({
		...x,
		key: createHash('sha256')
			.update('public-nickname-v2:' + x.name)
			.digest('hex'),
	}))
	.sort((a, b) => a.key.localeCompare(b.key))
	.slice(0, 200)
const names = users.map((u, i) => ({
	id: u.id,
	before: u.name,
	after: ranked[i]!.name,
	sourceUrl: ranked[i]!.sourceUrl,
}))
const stock = new Set(
	(
		JSON.parse(
			await readFile('.data/assets-cache/manifest.json', 'utf8'),
		) as Array<{ id: string; origin: string }>
	)
		.filter((x) => x.origin === 'Stock')
		.map((x) => x.id),
)
const posts = await db.post.findMany({
	where: { source: 'Synthetic' },
	include: {
		Comment_postId: { where: { source: 'Real' }, select: { id: true } },
	},
	orderBy: { id: 'asc' },
})
const used = new Set<string>()
const changedPosts: Array<{ id: string; before: string; after: string }> = []
// Preserve real participants and images explicitly referenced in the text before reducing generic attachments.
posts.sort(
	(a, b) =>
		Number(b.Comment_postId.length > 0) - Number(a.Comment_postId.length > 0) ||
		Number(/如图|看图|照片里|截图|图里|上图|下图/.test(b.body)) -
			Number(/如图|看图|照片里|截图|图里|上图|下图/.test(a.body)),
)
for (const p of posts) {
	const ids = JSON.parse(p.mediaIds) as string[]
	const keep = ids.filter(
		(id) => !stock.has(id) || p.Comment_postId.length > 0 || !used.has(id),
	)
	for (const id of keep) if (stock.has(id)) used.add(id)
	if (JSON.stringify(keep) !== p.mediaIds)
		changedPosts.push({
			id: p.id,
			before: p.mediaIds,
			after: JSON.stringify(keep),
		})
}
const activities = await db.activity.findMany({
	where: { source: 'Synthetic' },
	orderBy: { id: 'asc' },
})
const activityUsed = new Set<string>()
const changedActivities: Array<{ id: string; before: string }> = []
for (const a of activities)
	if (a.coverId && stock.has(a.coverId)) {
		if (activityUsed.has(a.coverId))
			changedActivities.push({ id: a.id, before: a.coverId })
		else activityUsed.add(a.coverId)
	}
const plan = {
	names,
	posts: changedPosts,
	activities: changedActivities,
	at: new Date().toISOString(),
}
await mkdir('.data/community-refine-v2', { recursive: true })
await writeFile(
	'.data/community-refine-v2/plan.json',
	JSON.stringify(plan, null, 2),
)
if (apply) {
	await db.$transaction(
		async (tx) => {
			for (const n of names) {
				const r = await tx.user.updateMany({
					where: { id: n.id, name: n.before, source: 'Synthetic' },
					data: { name: n.after },
				})
				if (r.count !== 1) throw Error('USER_CHANGED')
			}
			for (const p of changedPosts) {
				const r = await tx.post.updateMany({
					where: { id: p.id, mediaIds: p.before, source: 'Synthetic' },
					data: { mediaIds: p.after },
				})
				if (r.count !== 1) throw Error('POST_CHANGED')
			}
			for (const a of changedActivities) {
				const r = await tx.activity.updateMany({
					where: { id: a.id, coverId: a.before, source: 'Synthetic' },
					data: { coverId: null },
				})
				if (r.count !== 1) throw Error('ACTIVITY_CHANGED')
			}
		},
		{ timeout: 30000 },
	)
	const cache = await ensureContentCache()
	const personaPath = cache + '/pulse-natural-v3/personas.json'
	const personas = JSON.parse(await readFile(personaPath, 'utf8')) as Array<{
		id: string
		name: string
	}>
	for (const p of personas)
		p.name = names.find((n) => n.id === p.id)?.after ?? p.name
	await writeContentCacheFile(personaPath, JSON.stringify(personas, null, 2))
	await writeContentCacheFile(
		cache + '/pulse-natural-v3/refine-v2-receipt.json',
		JSON.stringify(plan, null, 2),
	)
	for (const file of ['natural-v3.json', 'natural-v3-media.json']) {
		const path = await resolveSnapshotFile(file)
		const s = JSON.parse(await readFile(path, 'utf8')) as Snapshot
		for (const u of s.users)
			u.name = names.find((n) => n.id === u.id)?.after ?? u.name
		if (file === 'natural-v3-media.json') {
			for (const p of s.posts) {
				const c = changedPosts.find((x) => x.id === p.id)
				if (c) p.mediaIds = JSON.parse(c.after)
			}
			for (const a of s.activities)
				if (changedActivities.some((x) => x.id === a.id)) a.coverId = null
		}
		await writeSnapshotFile(path, JSON.stringify(s))
	}
	await packContentCache()
	await publishSnapshots()
	await writeFile(
		'.data/community-refine-v2/receipt.json',
		JSON.stringify({
			applied: true,
			names: names.length,
			posts: changedPosts.length,
			activities: changedActivities.length,
			at: new Date().toISOString(),
		}),
	)
}
console.log(
	JSON.stringify({
		applied: apply,
		names: names.length,
		postDuplicatesRemoved: changedPosts.length,
		activityDuplicatesRemoved: changedActivities.length,
		samples: names.slice(0, 8),
	}),
)
await db.$disconnect()
