import {
	mkdir,
	open,
	readFile,
	writeFile,
	unlink,
	rename,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
export interface BatchUsage {
	input: number
	output: number
	cacheRead: number
	estimatedCostUsd: number
}
interface LedgerEntry {
	id: string
	at: string
	status: 'running' | 'complete' | 'failed'
	reservedUsd: number
	job: string
	usage?: BatchUsage
	error?: string
	accounting?: 'unknown-usage-charged-reservation'
}
interface Ledger {
	version: 1
	limitUsd: number
	entries: LedgerEntry[]
	stopped?: string
	authorization?: { at: string; limitUsd: number; reason: string }
}
interface PiResult {
	model: string
	success: boolean
	pricingKnown: boolean
	usageComplete?: boolean
	text: string
	usage: BatchUsage
}
const directory = resolve('.data/data-generation'),
	ledgerPath = resolve(directory, 'ledger.json'),
	lockPath = resolve(directory, 'budget.lock')
const reserve = 0.02,
	model = 'deepseek-v4.1-flash-1017'
export async function readLedger(): Promise<Ledger> {
	try {
		return JSON.parse(await readFile(ledgerPath, 'utf8')) as Ledger
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
		return { version: 1, limitUsd: 10, entries: [] }
	}
}
async function withLedger<T>(task: (ledger: Ledger) => Promise<T>): Promise<T> {
	await mkdir(directory, { recursive: true, mode: 0o700 })
	const started = Date.now()
	let lock: Awaited<ReturnType<typeof open>> | undefined
	while (!lock) {
		try {
			lock = await open(lockPath, 'wx', 0o600)
			await lock.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }))
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
			if (Date.now() - started > 30000)
				throw new Error('DATA_BATCH_LOCKED', { cause: e })
			await new Promise((r) => setTimeout(r, 50))
		}
	}
	try {
		const ledger = await readLedger()
		const result = await task(ledger)
		const temporary = resolve(
			directory,
			`ledger-${process.pid}-${Date.now()}.tmp`,
		)
		await writeFile(temporary, JSON.stringify(ledger, null, '\t'), {
			mode: 0o600,
		})
		await rename(temporary, ledgerPath)
		return result
	} finally {
		await lock.close()
		await unlink(lockPath)
	}
}
export async function runWritingBatch(
	id: string,
	prompt: string,
	options?: { api?: string; maxTokens?: number; timeoutMs?: number },
): Promise<string> {
	const entryOrText = await withLedger(async (ledger) => {
		if (ledger.stopped) throw new Error(`BUDGET_STOPPED:${ledger.stopped}`)
		const cached = ledger.entries.findLast(
			(e) => e.id === id && e.status === 'complete',
		)
		if (cached) {
			const result = JSON.parse(
				await readFile(resolve(cached.job, 'result.json'), 'utf8'),
			) as PiResult
			return result.text
		}
		const spent = ledger.entries.reduce(
			(n, e) => n + (e.usage?.estimatedCostUsd ?? e.reservedUsd),
			0,
		)
		if (spent + reserve > ledger.limitUsd) throw new Error('BUDGET_LIMIT')
		const job = resolve(
			directory,
			'jobs',
			`${id}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`,
		)
		await mkdir(job, { recursive: true, mode: 0o700 })
		await writeFile(resolve(job, 'task.txt'), prompt, { mode: 0o600 })
		const entry: LedgerEntry = {
			id,
			at: new Date().toISOString(),
			status: 'running',
			reservedUsd: reserve,
			job,
		}
		ledger.entries.push(entry)
		return entry
	})
	if (typeof entryOrText === 'string') return entryOrText
	const entry = entryOrText
	let result: PiResult | undefined, failure: string | undefined
	try {
		const code = await new Promise<number | null>((done, reject) => {
			const child = spawn(
				'pnpm',
				['agent:run', resolve(entry.job, 'task.txt'), '--run'],
				{
					cwd: process.cwd(),
					env: {
						...process.env,
						CAMPUS_AGENT_MODEL: model,
						CAMPUS_AGENT_CWD: entry.job,
						...(options?.api ? { CAMPUS_AGENT_API: options.api } : {}),
						...(options?.maxTokens
							? { CAMPUS_AGENT_MAX_TOKENS: String(options.maxTokens) }
							: {}),
						...(options?.timeoutMs
							? { CAMPUS_AGENT_TIMEOUT_MS: String(options.timeoutMs) }
							: {}),
					},
					stdio: ['ignore', 'ignore', 'ignore'],
				},
			)
			child.once('close', done)
			child.once('error', reject)
		})
		try {
			result = JSON.parse(
				await readFile(resolve(entry.job, 'result.json'), 'utf8'),
			) as PiResult
		} catch {
			failure = 'PI_RESULT_MISSING'
		}
		if (result) {
			if (!result.pricingKnown || result.model !== model)
				failure = 'PI_PRICING_UNKNOWN'
			else if (
				result.usageComplete === false ||
				!result.usage ||
				![
					result.usage.input,
					result.usage.output,
					result.usage.cacheRead,
				].every((n) => Number.isFinite(n) && n >= 0) ||
				result.usage.input + result.usage.output <= 0
			)
				failure = 'PI_USAGE_UNKNOWN'
			else if (code !== 0 || !result.success) failure = 'PI_BATCH_FAILED'
		}
	} catch (e) {
		failure = e instanceof Error ? e.message : String(e)
	}
	await withLedger(async (ledger) => {
		const current = ledger.entries.find((e) => e.job === entry.job)
		if (!current) throw new Error('LEDGER_ENTRY_MISSING')
		if (
			result?.pricingKnown &&
			result.usageComplete !== false &&
			result.model === model &&
			result.usage &&
			[result.usage.input, result.usage.output, result.usage.cacheRead].every(
				(n) => Number.isFinite(n) && n >= 0,
			) &&
			result.usage.input + result.usage.output > 0
		) {
			const usage = {
				...result.usage,
				estimatedCostUsd:
					(result.usage.input * 0.07 +
						result.usage.output * 0.28 +
						result.usage.cacheRead * 0.0014) /
					1e6,
			}
			current.usage = usage
			if (
				usage.input > 200000 ||
				usage.output > 60000 ||
				usage.estimatedCostUsd > reserve
			) {
				ledger.stopped = 'abnormal usage exceeded reservation'
				failure = 'PI_USAGE_ANOMALY'
			}
		} else {
			current.accounting = 'unknown-usage-charged-reservation'
		}
		current.status = failure ? 'failed' : 'complete'
		if (failure) current.error = failure
		if (failure === 'PI_PRICING_UNKNOWN')
			ledger.stopped = 'unknown model pricing'
	})
	if (failure) throw new Error(failure)
	return result!.text
}

/** Reconcile terminated dispatchers without inventing usage or sending a new request. */
export async function reconcileWritingJobs(): Promise<number> {
	return withLedger(async (ledger) => {
		let count = 0
		for (const entry of ledger.entries.filter((e) => e.status === 'running')) {
			let result: PiResult
			try {
				result = JSON.parse(
					await readFile(resolve(entry.job, 'result.json'), 'utf8'),
				) as PiResult
			} catch {
				continue
			}
			const valid =
				result.pricingKnown &&
				result.usageComplete !== false &&
				result.model === model &&
				result.usage &&
				[result.usage.input, result.usage.output, result.usage.cacheRead].every(
					(n) => Number.isFinite(n) && n >= 0,
				) &&
				result.usage.input + result.usage.output > 0
			if (valid) {
				entry.usage = {
					...result.usage,
					estimatedCostUsd:
						(result.usage.input * 0.07 +
							result.usage.output * 0.28 +
							result.usage.cacheRead * 0.0014) /
						1e6,
				}
				entry.status = result.success ? 'complete' : 'failed'
				if (!result.success) entry.error = 'PI_BATCH_FAILED'
			} else {
				entry.status = 'failed'
				entry.accounting = 'unknown-usage-charged-reservation'
				entry.error = 'PI_USAGE_UNKNOWN'
			}
			count++
		}
		return count
	})
}
