import {
	mkdir,
	readFile,
	writeFile,
	unlink,
	stat,
	rename,
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lock } from 'proper-lockfile'
import { supportedModel } from '../agents/environment.ts'
import { readGlobalAccess } from '../agents/access.ts'
import { locateSdk } from '../agents/sdk.ts'
export interface BatchUsage {
	input: number
	output: number
	cacheRead: number
	estimatedCostUsd: number
}
export interface ModelPricing {
	pricingBasis?: string
	groupId: number
	input: number
	output: number
	cacheRead: number
	checkedAt: string
}
export interface LedgerEntry {
	adjustment?: {
		kind: 'unconfirmed-cache-discount-reserve'
		entryJob: string
		cacheTokens: number
		previousCachePrice: number
		conservativeInputPrice: number
	}
	dispatcherPid?: number
	pricing?: ModelPricing
	taskBudgetId?: string
	id: string
	at: string
	status: 'running' | 'complete' | 'failed'
	reservedUsd: number
	job: string
	usage?: BatchUsage
	error?: string
	accounting?: 'unknown-usage-charged-reservation'
}
export interface Ledger {
	limitIncreases?: Array<{
		at: string
		previousLimitUsd: number
		newLimitUsd: number
		taskBudgetId: string
		additionalUsd: number
		reason: string
	}>
	currentPricing?: ModelPricing
	taskBudgets?: Record<
		string,
		{
			limitUsd: number
			unlimited?: boolean
			unlimitedChanges?: Array<{
				at: string
				enabled: boolean
				historicalProtectionBypassed: boolean
			}>
			createdAt: string
			increases: Array<{ at: string; additionalUsd: number }>
		}
	>
	version: 1
	limitUsd: number
	entries: LedgerEntry[]
	stopped?: string
	authorization?: { at: string; limitUsd: number; reason: string }
}
interface PiResult {
	error?: string
	metadata?: { transportError?: string; responseStatus?: number }
	model: string
	success: boolean
	pricingKnown: boolean
	usageComplete?: boolean
	text: string
	usage: BatchUsage
}
function usageFailure(result: PiResult) {
	const detail =
		result.metadata?.transportError ||
		result.error ||
		(result.metadata?.responseStatus
			? `HTTP ${result.metadata.responseStatus}`
			: 'provider returned no complete token usage')
	return `PI_USAGE_UNKNOWN:${detail.slice(0, 500)}`
}
const directory = resolve('.data/data-generation'),
	ledgerPath = resolve(directory, 'ledger.json'),
	lockPath = resolve(directory, 'budget.lock')
const minimumReserve = 0.02,
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

	// Keep the original lock path so already-running dispatchers remain mutually exclusive.
	// The library renews its lease and recovers directories left by SIGKILL.
	const lockOptions = {
		realpath: false,
		stale: 15000,
		update: 2000,
		retries: { retries: 80, factor: 1, minTimeout: 250, maxTimeout: 250 },
	}
	try {
		if ((await stat(lockPath)).isFile()) {
			const releaseRecovery = await lock(
				resolve(directory, 'budget-recovery'),
				lockOptions,
			)
			try {
				const info = await stat(lockPath).catch(() => null)
				if (info?.isFile()) {
					let owner: { pid?: number } = {}
					try {
						owner = JSON.parse(await readFile(lockPath, 'utf8')) as typeof owner
					} catch {
						/* A legacy writer may have died before writing its owner. */
					}
					let dead = false
					if (owner.pid) {
						try {
							process.kill(owner.pid, 0)
						} catch (error) {
							dead = (error as NodeJS.ErrnoException).code === 'ESRCH'
						}
					}
					if (dead || (!owner.pid && Date.now() - info.mtimeMs > 15000))
						await unlink(lockPath)
				}
			} finally {
				await releaseRecovery()
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	let compromised: Error | undefined
	const release = await lock(ledgerPath, {
		...lockOptions,
		lockfilePath: lockPath,
		onCompromised: (error) => {
			compromised = error
		},
	})

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
		if (compromised) throw compromised
		await rename(temporary, ledgerPath)
		return result
	} finally {
		await release()
	}
}
export async function runWritingBatch(
	id: string,
	prompt: string,
	options?: {
		api?: string
		systemPrompt?: string
		maxTokens?: number
		timeoutMs?: number
		taskBudgetId?: string
	},
): Promise<string> {
	if (
		process.env.CAMPUS_AGENT_MODEL &&
		process.env.CAMPUS_AGENT_MODEL !== supportedModel
	)
		throw new Error('AGENT_MODEL_PRICING_NOT_CONFIGURED')
	if (
		Buffer.byteLength(prompt + (options?.systemPrompt ?? ''), 'utf8') >
			120000 ||
		(options?.maxTokens ?? 16384) > 32768
	)
		throw new Error('BATCH_RESERVATION_INPUT_LIMIT')
	// Fail local setup errors before reserving any generation budget.
	await readGlobalAccess()
	await locateSdk()
	const taskBudgetId = options?.taskBudgetId ?? CURRENT_TASK_BUDGET
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
		if (
			ledger.entries.some(
				(entry) => entry.id === id && entry.status === 'running',
			)
		)
			throw new Error('BATCH_ALREADY_RUNNING')
		const pricing = ledger.currentPricing ?? {
			groupId: 97,
			input: 0.12,
			output: 0.48,
			cacheRead: 0.12,
			checkedAt: 'published-model-plaza-2026-11-06',
			pricingBasis: 'published-maximum-uncached-not-actual',
		}
		const reserve = Math.max(
			minimumReserve,
			((Buffer.byteLength(prompt + (options?.systemPrompt ?? ''), 'utf8') *
				pricing.input +
				(options?.maxTokens ?? 16384) * pricing.output) /
				1e6) *
				1.1,
		)
		const spent = ledger.entries.reduce(
			(n, e) => n + (e.usage?.estimatedCostUsd ?? e.reservedUsd),
			0,
		)
		if (
			!ledger.taskBudgets?.[taskBudgetId]?.unlimited &&
			spent + reserve > ledger.limitUsd
		)
			throw new Error('BUDGET_LIMIT')
		const group = ledger.taskBudgets?.[taskBudgetId]
		if (!group) throw new Error('TASK_BUDGET_NOT_AUTHORIZED')
		if (
			!group.unlimited &&
			ledger.entries
				.filter((e) => e.taskBudgetId === taskBudgetId)
				.reduce((n, e) => n + (e.usage?.estimatedCostUsd ?? e.reservedUsd), 0) +
				reserve >
				group.limitUsd
		)
			throw new Error('TASK_BUDGET_LIMIT')
		const job = resolve(
			directory,
			'jobs',
			`${id}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`,
		)
		await mkdir(job, { recursive: true, mode: 0o700 })
		await writeFile(resolve(job, 'task.txt'), prompt, { mode: 0o600 })
		if (options?.systemPrompt)
			await writeFile(resolve(job, 'system.txt'), options.systemPrompt, {
				mode: 0o600,
			})
		const entry: LedgerEntry = {
			dispatcherPid: process.pid,
			taskBudgetId,
			pricing,
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
						CAMPUS_AGENT_SYSTEM_PROMPT_FILE: options?.systemPrompt
							? resolve(entry.job, 'system.txt')
							: '',
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
				failure = usageFailure(result)
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
					(result.usage.input * (entry.pricing?.input ?? 0.07) +
						result.usage.output * (entry.pricing?.output ?? 0.28) +
						result.usage.cacheRead * (entry.pricing?.cacheRead ?? 0.0014)) /
					1e6,
			}
			current.usage = usage
			if (
				usage.input > 200000 ||
				usage.output > 60000 ||
				usage.estimatedCostUsd > entry.reservedUsd
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
				if (entry.dispatcherPid) {
					try {
						process.kill(entry.dispatcherPid, 0)
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
							entry.status = 'failed'
							entry.accounting = 'unknown-usage-charged-reservation'
							entry.error = 'DISPATCHER_INTERRUPTED'
							count++
						}
					}
				}
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
						(result.usage.input * (entry.pricing?.input ?? 0.07) +
							result.usage.output * (entry.pricing?.output ?? 0.28) +
							result.usage.cacheRead * (entry.pricing?.cacheRead ?? 0.0014)) /
						1e6,
				}
				if (
					entry.usage.input > 200000 ||
					entry.usage.output > 60000 ||
					entry.usage.estimatedCostUsd > entry.reservedUsd
				) {
					ledger.stopped = 'abnormal usage exceeded reservation'
					entry.status = 'failed'
					entry.error = 'PI_USAGE_ANOMALY'
					count++
					continue
				}
				entry.status = result.success ? 'complete' : 'failed'
				if (!result.success) entry.error = 'PI_BATCH_FAILED'
			} else {
				entry.status = 'failed'
				entry.accounting = 'unknown-usage-charged-reservation'
				entry.error = usageFailure(result)
				if (!result.pricingKnown || result.model !== model)
					ledger.stopped = 'unknown model pricing'
			}
			count++
		}
		return count
	})
}

export const CURRENT_TASK_BUDGET = 'community-agents-v1'
export async function authorizeTaskBudget(
	id = CURRENT_TASK_BUDGET,
	limitUsd = 5,
) {
	if (id !== CURRENT_TASK_BUDGET || limitUsd !== 5)
		throw new Error('INVALID_INITIAL_AUTHORIZATION')
	await withLedger(async (ledger) => {
		ledger.taskBudgets ??= {}
		ledger.taskBudgets[id] ??= {
			limitUsd,
			createdAt: new Date().toISOString(),
			increases: [],
		}
	})
	return readTaskBudget(id)
}
export async function readTaskBudget(id = CURRENT_TASK_BUDGET) {
	const ledger = await readLedger()
	const group = ledger.taskBudgets?.[id]
	const cost = (entries: LedgerEntry[]) =>
		entries.reduce(
			(n, e) => n + (e.usage?.estimatedCostUsd ?? e.reservedUsd),
			0,
		)
	const entries = ledger.entries.filter((e) => e.taskBudgetId === id)
	const spentUsd = cost(entries)
	const historicalSpentUsd = cost(ledger.entries)
	return {
		id,
		limitUsd: group?.limitUsd ?? 0,
		unlimited: group?.unlimited ?? false,
		unlimitedChanges: group?.unlimitedChanges ?? [],
		spentUsd,
		remainingUsd: Math.max(
			0,
			Math.min(
				(group?.limitUsd ?? 0) - spentUsd,
				ledger.limitUsd - historicalSpentUsd,
			),
		),
		historicalLimitUsd: ledger.limitUsd,
		historicalSpentUsd,
		requests: entries.filter((entry) => !entry.adjustment).length,
		adjustmentReservedUsd: entries
			.filter((entry) => entry.adjustment)
			.reduce((total, entry) => total + entry.reservedUsd, 0),
		running: entries.filter((e) => e.status === 'running').length,
		stopped: ledger.stopped ?? null,
		authorized: !!group,
		increases: group?.increases ?? [],
	}
}
export async function increaseTaskBudget(id: string, additionalUsd: number) {
	if (
		id !== CURRENT_TASK_BUDGET ||
		!Number.isFinite(additionalUsd) ||
		additionalUsd <= 0 ||
		additionalUsd > 10
	)
		throw new Error('INVALID_BUDGET_INCREASE')
	await withLedger(async (ledger) => {
		const group = ledger.taskBudgets?.[id]
		if (!group) throw new Error('TASK_BUDGET_NOT_AUTHORIZED')
		const historicalSpent = ledger.entries.reduce(
			(n, e) => n + (e.usage?.estimatedCostUsd ?? e.reservedUsd),
			0,
		)
		const groupSpent = ledger.entries
			.filter((e) => e.taskBudgetId === id)
			.reduce((n, e) => n + (e.usage?.estimatedCostUsd ?? e.reservedUsd), 0)

		const requiredHistoricalLimit =
			historicalSpent - groupSpent + group.limitUsd + additionalUsd
		if (requiredHistoricalLimit > ledger.limitUsd) {
			ledger.limitIncreases ??= []
			ledger.limitIncreases.push({
				at: new Date().toISOString(),
				previousLimitUsd: ledger.limitUsd,
				newLimitUsd: requiredHistoricalLimit,
				taskBudgetId: id,
				additionalUsd,
				reason:
					'Explicit Studio confirmation increased task budget and its cumulative protection threshold',
			})
			ledger.limitUsd = requiredHistoricalLimit
		}
		group.limitUsd += additionalUsd
		group.increases.push({ at: new Date().toISOString(), additionalUsd })
	})
	return readTaskBudget(id)
}

export async function configureTaskPricing(groupId: number) {
	const multiplier =
		groupId === 97 ? 0.12 : groupId === 98 ? 0.07 : groupId === 99 ? 0.04 : null
	if (multiplier === null) throw new Error('UNKNOWN_MODEL_GROUP_PRICING')
	await withLedger(async (ledger) => {
		ledger.currentPricing = {
			groupId,
			input: multiplier,
			output: 4 * multiplier,
			cacheRead: multiplier,
			checkedAt: new Date().toISOString(),
			pricingBasis:
				groupId === 97
					? 'published-maximum-uncached-not-actual'
					: 'published-selected-group-not-actual',
		}
	})
	return (await readLedger()).currentPricing
}

/** Preserve original usage and add a transparent reserve for unconfirmed cache discounts. */
export async function reserveUnconfirmedCacheDiscounts() {
	return withLedger(async (ledger) => {
		if (!ledger.currentPricing) throw new Error('MODEL_PRICING_NOT_CONFIGURED')
		ledger.currentPricing = {
			...ledger.currentPricing,
			cacheRead: ledger.currentPricing.input,
			pricingBasis: 'published-maximum-uncached-not-actual',
			checkedAt: new Date().toISOString(),
		}
		let addedUsd = 0,
			adjustedEntries = 0
		const modelEntries = ledger.entries.filter(
			(entry) =>
				entry.taskBudgetId === CURRENT_TASK_BUDGET &&
				!entry.adjustment &&
				entry.usage &&
				entry.usage.cacheRead > 0,
		)
		for (const entry of modelEntries) {
			const originalCachePrice = entry.pricing?.cacheRead ?? 0.0014
			const conservativeInputPrice = Math.max(
				0.12,
				entry.pricing?.input ?? 0.07,
			)
			const desired =
				(entry.usage!.cacheRead *
					Math.max(0, conservativeInputPrice - originalCachePrice)) /
				1e6
			const previous = ledger.entries.filter(
				(row) => row.adjustment?.entryJob === entry.job,
			)
			const reserved = previous.reduce(
					(total, row) => total + row.reservedUsd,
					0,
				),
				additional = desired - reserved
			if (additional <= 1e-12) continue
			ledger.entries.push({
				id:
					'cache-discount-reserve-' +
					createHash('sha256').update(entry.job).digest('hex').slice(0, 20) +
					'-' +
					previous.length,
				taskBudgetId: CURRENT_TASK_BUDGET,
				at: new Date().toISOString(),
				status: 'complete',
				reservedUsd: additional,
				job: 'ledger-adjustment:no-model-request',
				adjustment: {
					kind: 'unconfirmed-cache-discount-reserve',
					entryJob: entry.job,
					cacheTokens: entry.usage!.cacheRead,
					previousCachePrice: originalCachePrice,
					conservativeInputPrice,
				},
			})
			adjustedEntries++
			addedUsd += additional
		}
		return {
			adjustedEntries,
			addedUsd,
			basis:
				'Unconfirmed cache discount difference reserved conservatively, not actual billing',
		}
	})
}

/** Used by Studio controls and worker startup. Preserve limits, entries and anomaly stops. */
export async function setTaskBudgetUnlimited(enabled: boolean) {
	await withLedger(async (ledger) => {
		const group = ledger.taskBudgets?.[CURRENT_TASK_BUDGET]
		if (!group) throw new Error('TASK_BUDGET_NOT_AUTHORIZED')
		group.unlimited = enabled
		group.unlimitedChanges ??= []
		group.unlimitedChanges.push({
			at: new Date().toISOString(),
			enabled,
			historicalProtectionBypassed: enabled,
		})
	})
	return readTaskBudget()
}
