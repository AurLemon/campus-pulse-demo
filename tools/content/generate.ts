import {
	ensureSnapshotCache,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
	ensureContentCache,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'
import { topics } from './catalog.ts'
import { contentPlan } from './plans.ts'
import { writeActivities, writePosts } from './model-content.ts'
import type { WrittenActivity, WrittenPost } from './model-content.ts'
import { buildSnapshot } from './structure.ts'
import { assignSnapshotPosters } from './poster.ts'
import { validateSnapshot, summarizeSnapshot } from './validate.ts'
import { readLedger } from './budget.ts'
import { applyNaturalContent } from './natural-content.ts'
const size = process.argv.includes('--full') ? 'full' : 'small'
if (process.argv.includes('--dry-run') || !process.argv.includes('--run')) {
	console.log(
		JSON.stringify({
			mode: 'dry-run',
			size,
			model: 'deepseek-v4.1-flash-1017',
			budgetUsd: 1,
			activities: size === 'full' ? 120 : 6,
			posts: size === 'full' ? 1200 : 12,
		}),
	)
	process.exit(0)
}
if (size === 'full' && !process.argv.includes('--approved-expansion'))
	throw new Error('FULL_REQUIRES_REVIEWED_SMALL_LOOP')
const contentCache = await ensureContentCache()
await ensureSnapshotCache()
const activityCount = size === 'full' ? 120 : 6,
	postCount = size === 'full' ? 1200 : 12
async function checkpoint<T>(
	file: string,
	generate: () => Promise<T>,
): Promise<T> {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as T
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
		const result = await generate()
		await writeContentCacheFile(file, JSON.stringify(result, null, '\t'))
		return result
	}
}
const activities: WrittenActivity[] = []
for (let offset = 0; offset < activityCount; offset += 6) {
	const plans = Array.from(
		{ length: Math.min(6, activityCount - offset) },
		(_, j) => {
			const i = offset + j,
				t = topics[i % topics.length]!
			return {
				id: `a${i + 1}`,
				topic: `${t.topic}，第${Math.floor(i / 8) + 1}场，请选择不同的具体切入点`,
				location: t.place,
				voice: t.voice,
			}
		},
	)
	const path =
		size === 'small'
			? join(contentCache, 'small-activities.json')
			: join(contentCache, `full-activities-${offset}.json`)
	activities.push(
		...(await checkpoint(path, () =>
			writeActivities(`${size}-activities-${offset}-v1`, plans),
		)),
	)
	console.log(
		JSON.stringify({
			phase: 'activities',
			done: activities.length,
			total: activityCount,
		}),
	)
}
const posts: WrittenPost[] = []
const batchSize =
	size === 'full'
		? process.env.CAMPUS_DATA_BATCH_SIZE === '32'
			? 32
			: process.env.CAMPUS_DATA_BATCH_SIZE === '16'
				? 16
				: 8
		: 4
for (let offset = 0; offset < postCount;) {
	const checkpointPath = join(contentCache, `${size}-posts-${offset}.json`)
	try {
		const saved = JSON.parse(
			await readFile(checkpointPath, 'utf8'),
		) as WrittenPost[]
		if (
			!Array.isArray(saved) ||
			!saved.length ||
			saved.some((post, index) => post.id !== `p${offset + index + 1}`)
		)
			throw new Error('CHECKPOINT_IDS_INVALID')
		posts.push(...saved)
		offset += saved.length
		console.log(
			JSON.stringify({ phase: 'posts', done: posts.length, total: postCount }),
		)
		continue
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	const requested = Math.min(batchSize, postCount - offset)
	const plans = Array.from({ length: requested }, (_, j) =>
		contentPlan(offset + j, size, activities),
	)
	posts.push(
		...(await checkpoint(checkpointPath, () =>
			writePosts(`${size}-posts-${offset}-v1`, plans),
		)),
	)
	console.log(
		JSON.stringify({ phase: 'posts', done: posts.length, total: postCount }),
	)
	offset += requested
}
const snapshot = buildSnapshot(size, { activities, posts })
await applyNaturalContent(snapshot)
Object.assign(snapshot, assignSnapshotPosters(snapshot))
const errors = validateSnapshot(snapshot)
if (errors.length) throw new Error(JSON.stringify(errors.slice(0, 30)))
await writeSnapshotFile(`${size}.json`, JSON.stringify(snapshot, null, '\t'))
const ledger = await readLedger()
const knownUsage = ledger.entries.reduce(
	(sum, entry) => sum + (entry.usage?.estimatedCostUsd ?? 0),
	0,
)
const unresolvedReservations = ledger.entries.reduce(
	(sum, entry) => sum + (entry.usage ? 0 : entry.reservedUsd),
	0,
)
const summary = {
	...summarizeSnapshot(snapshot),
	generation: {
		model: 'deepseek-v4.1-flash-1017',
		budgetScope: 'startup-total-small-and-full',
		limitUsd: ledger.limitUsd,
		pricingUsdPerMillionTokens: {
			input: 0.07,
			output: 0.28,
			cacheRead: 0.0014,
		},
		knownUsageEstimateUsd: knownUsage,
		unresolvedReservationsUsd: unresolvedReservations,
		conservativeTotalUsd: knownUsage + unresolvedReservations,
		successfulBatches: ledger.entries.filter(
			(entry) => entry.status === 'complete',
		).length,
		failedBatches: ledger.entries.filter((entry) => entry.status === 'failed')
			.length,
		unknownUsageBatches: ledger.entries.filter((entry) => !entry.usage).length,
		inFlightBatches: ledger.entries.filter(
			(entry) => entry.status === 'running',
		).length,
		usage: ledger.entries.reduce(
			(sum, entry) => ({
				input: sum.input + (entry.usage?.input ?? 0),
				output: sum.output + (entry.usage?.output ?? 0),
				cacheRead: sum.cacheRead + (entry.usage?.cacheRead ?? 0),
			}),
			{ input: 0, output: 0, cacheRead: 0 },
		),
	},
}
await writeSnapshotFile(
	`${size}-summary.json`,
	JSON.stringify(summary, null, '\t'),
)
const snapshotBundle = await publishSnapshots()
const contentBundle = await packContentCache()
if (!contentBundle.cacheStateUpdated)
	throw new Error(
		'CONTENT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing the cache',
	)
console.log(JSON.stringify({ ...summary, contentBundle, snapshotBundle }))
