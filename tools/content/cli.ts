import { readFile } from 'node:fs/promises'
import { resolveSnapshotFile } from './snapshot-bundle.ts'
import type { Snapshot } from '@campus/contracts'
import { validateSnapshot, summarizeSnapshot } from './validate.ts'
const command = process.argv[2] ?? 'validate'
const file = await resolveSnapshotFile(process.argv[3] ?? 'small.json')
const snapshot = JSON.parse(await readFile(file, 'utf8')) as Snapshot
const errors = validateSnapshot(snapshot)
if (errors.length)
	throw new Error(`INVALID_SNAPSHOT: ${errors.slice(0, 20).join(', ')}`)
if (command === 'import' || command === 'reset') {
	if (
		command === 'reset' &&
		!process.argv.includes('--confirm-synthetic-reset')
	)
		throw new Error('RESET_CONFIRMATION_REQUIRED')
	const { importSnapshot } = await import('@campus/domain/import')
	await importSnapshot(snapshot, command === 'reset')
	const { db } = await import('@campus/domain/prisma')
	await db.$disconnect()
}
console.log(
	JSON.stringify({ command, file, ...summarizeSnapshot(snapshot) }, null, '\t'),
)
