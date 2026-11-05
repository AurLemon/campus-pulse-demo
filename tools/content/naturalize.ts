import {
	resolveSnapshotFile,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Snapshot } from '@campus/contracts'
import { applyNaturalContent, readNaturalContent } from './natural-content.ts'
import { validateSnapshot, summarizeSnapshot } from './validate.ts'
import { readLedger } from './budget.ts'

const content = await readNaturalContent()
if (!content || content.personas.length !== 200)
	throw new Error('NATURAL_CONTENT_NOT_REVIEWED')
const run = process.argv.includes('--run')
for (const size of ['small', 'full']) {
	const path = await resolveSnapshotFile(`${size}.json`)
	const before = await readFile(path, 'utf8')
	const snapshot = JSON.parse(before) as Snapshot
	await applyNaturalContent(snapshot)
	const errors = validateSnapshot(snapshot)
	if (errors.length) throw new Error(JSON.stringify(errors.slice(0, 30)))
	const ledger = await readLedger()
	const knownUsageEstimateUsd = ledger.entries.reduce(
		(sum, entry) => sum + (entry.usage?.estimatedCostUsd ?? 0),
		0,
	)
	const unresolvedReservationsUsd = ledger.entries.reduce(
		(sum, entry) => sum + (entry.usage ? 0 : entry.reservedUsd),
		0,
	)
	const oldSummary = JSON.parse(
		await readFile(await resolveSnapshotFile(`${size}-summary.json`), 'utf8'),
	) as { generation: Record<string, unknown> }
	const summary = {
		...summarizeSnapshot(snapshot),
		generation: {
			...oldSummary.generation,
			knownUsageEstimateUsd,
			unresolvedReservationsUsd,
			conservativeTotalUsd: knownUsageEstimateUsd + unresolvedReservationsUsd,
			successfulBatches: ledger.entries.filter(
				(entry) => entry.status === 'complete',
			).length,
			failedBatches: ledger.entries.filter((entry) => entry.status === 'failed')
				.length,
			unknownUsageBatches: ledger.entries.filter((entry) => !entry.usage)
				.length,
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
		naturalContent: {
			version: content.version,
			personas: content.personas.length,
			modelRewrittenThreads: content.threads.length,
			linkedPostBodiesPreserved: true,
			longArticleBodiesPreserved: true,
		},
	}
	if (run) {
		const backupDirectory = resolve('.data/content-polish-v2/applied-backups')
		await mkdir(backupDirectory, { recursive: true })
		await writeFile(
			resolve(backupDirectory, `${size}-${Date.now()}.json`),
			before,
			{ mode: 0o600 },
		)
		await writeSnapshotFile(path, JSON.stringify(snapshot, null, '\t'))
		await writeSnapshotFile(
			`${size}-summary.json`,
			JSON.stringify(summary, null, '\t'),
		)
	}
	console.log(
		JSON.stringify({ mode: run ? 'run' : 'dry-run', size, ...summary }),
	)
}

if (run) await publishSnapshots()
