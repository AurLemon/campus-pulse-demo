import Database from 'better-sqlite3'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readTaskBudget } from '../../tools/content/budget.ts'
import { readGlobalAccess } from '../../tools/agents/access.ts'

const directory = resolve(process.env.CAMPUS_AGENT_DATA_DIR ?? '.data/agents')
let runtime: {
	personas: number
	enabled: boolean
	workerPid: number | null
	workerAlive: boolean
	heartbeatAt: string | null
	jobs: Array<{ status: string; count: number }>
} | null = null
try {
	const database = new Database(resolve(directory, 'runtime.db'), {
		readonly: true,
		fileMustExist: true,
	})
	try {
		const setting = <T>(id: string, fallback: T): T => {
			const row = database
				.prepare('SELECT value FROM settings WHERE id=?')
				.get(id) as { value: string } | undefined
			return row ? (JSON.parse(row.value) as T) : fallback
		}
		const workerPid = setting<number | null>('workerPid', null)
		let workerAlive = false
		if (workerPid) {
			try {
				process.kill(workerPid, 0)
				workerAlive = true
			} catch {
				/* A stopped worker is a valid idle state. */
			}
		}
		runtime = {
			personas: (
				database.prepare('SELECT COUNT(*) AS total FROM personas').get() as {
					total: number
				}
			).total,
			enabled: setting('enabled', false),
			workerPid,
			workerAlive,
			heartbeatAt: setting('heartbeatAt', null),
			jobs: database
				.prepare('SELECT status,COUNT(*) AS count FROM jobs GROUP BY status')
				.all() as Array<{ status: string; count: number }>,
		}
	} finally {
		database.close()
	}
} catch (error) {
	if ((error as { code?: string }).code !== 'SQLITE_CANTOPEN') throw error
}
let tokenConfigured = false,
	tokenPrivate = false,
	modelConfigured = false
try {
	const info = await stat(
		resolve(
			process.env.CAMPUS_AGENT_TOKEN_FILE ?? '.data/agents/service-token',
		),
	)
	tokenConfigured = info.isFile() && info.size >= 32
	tokenPrivate = process.platform === 'win32' || (info.mode & 0o077) === 0
} catch {
	/* Only report presence and permissions, never the credential. */
}
try {
	await readGlobalAccess()
	modelConfigured = true
} catch {
	/* Configuration errors must not echo provider credentials. */
}
console.log(
	JSON.stringify(
		{
			runtime,
			tokenConfigured,
			tokenPrivate,
			modelConfigured,
			budget: await readTaskBudget(),
			note: 'Read-only inspection, no model request or background worker started',
		},
		null,
		'\t',
	),
)
