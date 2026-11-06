import { MAX_AGENT_ACTORS } from '../../packages/contracts/agents.ts'
import '../../tools/agents/environment.ts'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
	AgentPersona,
	AgentRuntimeStatus,
	AgentJobFilter,
	AgentJob,
} from '../../packages/contracts/agents.ts'
export const directory = resolve(
	process.env.CAMPUS_AGENT_DATA_DIR ?? '.data/agents',
)
mkdirSync(directory, { recursive: true, mode: 0o700 })
export const store = new Database(resolve(directory, 'runtime.db'))
store.pragma('journal_mode = WAL')
store.pragma('busy_timeout = 5000')
store.exec(`CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY,body TEXT NOT NULL,lastRunAt TEXT);
 CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,actorId TEXT NOT NULL,status TEXT NOT NULL,action TEXT,error TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,leaseUntil TEXT,decision TEXT,result TEXT);
 CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT,actorId TEXT NOT NULL,body TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY,actorId TEXT NOT NULL,createdAt TEXT NOT NULL);`)
export function setting<T>(id: string, fallback: T): T {
	const row = store.prepare('SELECT value FROM settings WHERE id=?').get(id) as
		{ value: string } | undefined
	return row ? (JSON.parse(row.value) as T) : fallback
}
export function configure(id: string, value: unknown) {
	store
		.prepare(
			'INSERT INTO settings(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
		)
		.run(id, JSON.stringify(value))
}
// Migrate only the former shipped interval. Other saved controls remain unchanged.
if (setting('schedulerDefaultsVersion', 0) < 1) {
	if (setting<number>('intervalSeconds', 60) === 210)
		configure('intervalSeconds', 60)
	configure('schedulerDefaultsVersion', 1)
}
export const PROTECTED_PAUSE =
	/BUDGET|PRICING|PI_USAGE_UNKNOWN|PI_RESULT_MISSING|USAGE_ANOMALY/
export function personas(): AgentPersona[] {
	return (
		store.prepare('SELECT body FROM personas ORDER BY id').all() as Array<{
			body: string
		}>
	).map((r) => JSON.parse(r.body) as AgentPersona)
}
export function completedDecisions() {
	return (
		store
			.prepare("SELECT COUNT(*) total FROM jobs WHERE status='complete'")
			.get() as { total: number }
	).total
}
export const MAX_ACTORS = MAX_AGENT_ACTORS
export const MAX_CONCURRENCY = 16
export const MAX_BACKGROUND_CONCURRENCY = MAX_CONCURRENCY - 2
export function enqueueActor(actorId: string) {
	if (!store.prepare('SELECT id FROM personas WHERE id=?').get(actorId))
		throw new Error('INVALID_ACTOR')
	const id = randomUUID(),
		now = new Date().toISOString()
	store
		.prepare(
			"INSERT INTO jobs(id,actorId,status,createdAt,updatedAt) VALUES(?,?,'queued',?,?)",
		)
		.run(id, actorId, now, now)
	return id
}
interface JobRow {
	trigger: string | null
	id: string
	actorId: string
	status: string
	action: string | null
	error: string | null
	createdAt: string
	updatedAt: string
	decision: string | null
	result: string | null
	targetTitle: string | null
}
if (
	!(
		store.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>
	).some((c) => c.name === 'targetTitle')
)
	store.exec('ALTER TABLE jobs ADD COLUMN targetTitle TEXT')
for (const [table, column, type] of [
	['signals', 'kind', "TEXT NOT NULL DEFAULT ''"],
	['jobs', 'readAcknowledgements', 'TEXT'],
	['jobs', 'trigger', 'TEXT'],
	['signals', 'trigger', 'TEXT'],
] as const) {
	if (
		!(
			store.prepare(`PRAGMA table_info(${table})`).all() as Array<{
				name: string
			}>
		).some((item) => item.name === column)
	)
		store.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}
export function runtimeStatus(filter: AgentJobFilter = {}): AgentRuntimeStatus {
	const people = personas(),
		names = new Map(people.map((p) => [p.actorId, p.name]))
	const clauses: string[] = [],
		values: string[] = []
	for (const key of ['actorId', 'action', 'status'] as const)
		if (filter[key]) {
			clauses.push(`${key}=?`)
			values.push(filter[key]!)
		}
	if (filter.q) {
		clauses.push('(decision LIKE ? OR targetTitle LIKE ? OR error LIKE ?)')
		values.push(...Array<string>(3).fill(`%${filter.q}%`))
	}
	const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
	const total = (
		store.prepare(`SELECT COUNT(*) total FROM jobs${where}`).get(...values) as {
			total: number
		}
	).total
	const pageSize = 50,
		page = Math.max(
			1,
			Math.min(Math.ceil(total / pageSize) || 1, filter.page || 1),
		)
	const rows = store
		.prepare(
			`SELECT * FROM jobs${where} ORDER BY createdAt DESC,rowid DESC LIMIT ? OFFSET ?`,
		)
		.all(...values, pageSize, (page - 1) * pageSize) as JobRow[]
	const jobs: AgentJob[] = rows.map((row) => {
		const decision = row.decision
			? (JSON.parse(row.decision) as AgentJob['decision'])
			: null
		const result = row.result
			? (JSON.parse(row.result) as AgentJob['result'])
			: null
		const action = decision?.action,
			target = action === 'post' ? result?.id : decision?.targetId
		const path =
			action === 'follow'
				? 'users'
				: ['borrow', 'return', 'reading', 'read'].includes(action ?? '')
					? 'books'
					: 'posts'
		return {
			...row,
			trigger: row.trigger
				? (JSON.parse(row.trigger) as AgentJob['trigger'])
				: null,
			actorName: names.get(row.actorId) ?? row.actorId,
			decision,
			result,
			targetUrl:
				target && action !== 'skip' && action !== 'message'
					? `/${path}/${encodeURIComponent(String(target))}`
					: null,
		}
	})
	const count = (status: string) =>
		(
			store
				.prepare('SELECT COUNT(*) total FROM jobs WHERE status=?')
				.get(status) as { total: number }
		).total

	return {
		maxActorLimit: MAX_ACTORS,
		actorCount: people.length,
		enabled: setting('enabled', false),
		pauseReason: setting('pauseReason', null),
		intervalSeconds: setting('intervalSeconds', 60),
		actorLimit: setting('actorLimit', Math.min(MAX_ACTORS, people.length)),
		workerPid: setting('workerPid', null),
		heartbeatAt: setting('heartbeatAt', null),
		personas: personas(),
		concurrency: setting('concurrency', 1),
		maxConcurrency: MAX_CONCURRENCY,
		maxBackgroundConcurrency: MAX_BACKGROUND_CONCURRENCY,
		decisionLimit: setting('decisionLimit', 200),
		completedDecisions: completedDecisions(),
		queuedCount: count('queued'),
		runningCount: count('running'),
		jobTotal: total,
		jobPage: page,
		jobPageSize: pageSize,
		jobs,
	}
}
export function remember(actorId: string, body: string) {
	store
		.prepare('INSERT INTO memories(actorId,body,createdAt) VALUES(?,?,?)')
		.run(actorId, body, new Date().toISOString())
	store
		.prepare(
			'DELETE FROM memories WHERE actorId=? AND id NOT IN (SELECT id FROM memories WHERE actorId=? ORDER BY id DESC LIMIT 12)',
		)
		.run(actorId, actorId)
}
