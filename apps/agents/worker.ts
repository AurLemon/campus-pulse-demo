import { randomUUID, randomBytes } from 'node:crypto'
import { writeFile, readFile, open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
	store,
	directory,
	setting,
	configure,
	personas,
	remember,
	enqueueActor,
	MAX_CONCURRENCY,
	completedDecisions,
	PROTECTED_PAUSE,
} from './store.ts'
import { request } from './client.ts'
import { syncPersonas } from './personas.ts'
import { buildAgentPrompt } from './prompt.ts'
import {
	runWritingBatch,
	readTaskBudget,
	authorizeTaskBudget,
	reconcileWritingJobs,
} from '../../tools/content/budget.ts'
import type {
	AgentPersona,
	AgentDecision,
	AgentOperation,
	AgentReadAcknowledgement,
	AgentTrigger,
} from '../../packages/contracts/agents.ts'
const lockPath = resolve(directory, 'worker.lock')
try {
	const old = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number }
	try {
		process.kill(old.pid, 0)
		throw new Error('AGENT_WORKER_ALREADY_RUNNING')
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e
	}
	await unlink(lockPath)
} catch (e) {
	if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
}
const lock = await open(lockPath, 'wx', 0o600)
await lock.writeFile(JSON.stringify({ pid: process.pid }))
const tokenPath = resolve(
	process.env.CAMPUS_AGENT_TOKEN_FILE ?? '.data/agents/service-token',
)
try {
	await writeFile(tokenPath, randomBytes(32).toString('hex'), {
		flag: 'wx',
		mode: 0o600,
	})
} catch (e) {
	if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
}
await authorizeTaskBudget()
await reconcileWritingJobs()
let stopping = false
const stop = () => {
	stopping = true
	clearInterval(heartbeatTimer)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
process.on('disconnect', stop)
configure('workerPid', process.pid)
store
	.prepare(
		"UPDATE jobs SET status=CASE WHEN decision IS NULL THEN 'failed' ELSE 'ready' END,error=CASE WHEN decision IS NULL THEN 'INTERRUPTED_USAGE_RESERVED' ELSE NULL END WHERE status='running'",
	)
	.run()
let nextSignals = 0
let nextRun = 0,
	synchronized = false
let syncFailureReason: string | undefined
const sampleArgument = process.argv.find((arg) => arg.startsWith('--sample='))
const sampleSize = sampleArgument
	? Math.min(10, Math.max(1, Number(sampleArgument.split('=')[1]) || 1))
	: 1
const single = process.argv.includes('--once') || !!sampleArgument
const syncOnly = process.argv.includes('--sync-only')
const maximum = Number(
	process.env.CAMPUS_AGENT_MAX_DECISIONS ?? (single ? '1' : '0'),
)
let completed = 0
const active = new Map<string, Promise<void>>()
const activeKinds = new Map<string, AgentTrigger['kind']>()
const humanControlledActors = new Set<string>()
const legacyPause = setting('pauseReason', '') ?? ''
if (
	/^PRODUCT_409:/.test(legacyPause) &&
	/AGENT_HUM/.test(legacyPause) &&
	!PROTECTED_PAUSE.test(legacyPause)
)
	configure('pauseReason', null)
const legacyStep = setting<string | null>('stepActorId', null)
if (legacyStep) {
	enqueueActor(legacyStep)
	configure('stepActorId', null)
}
async function runJob(
	actor: AgentPersona,
	id: string,
	decisionText?: string | null,
	savedReads?: string | null,
	trigger: AgentTrigger = { kind: 'sweep', recipientId: actor.actorId },
	legacyDecision = false,
) {
	const requestTrigger = { ...trigger, signalIds: undefined }
	let readAcknowledgements: AgentReadAcknowledgement[] = savedReads
		? (JSON.parse(savedReads) as AgentReadAcknowledgement[])
		: []
	let decision: AgentDecision
	if (decisionText) decision = JSON.parse(decisionText) as AgentDecision
	else {
		const context = await request<{
			posts: Array<{ id: string; title: string }>
			replyOpportunity?: { mayReply: boolean }
			books: Array<{ id: string; title: string }>
			privateThreads: Array<{
				conversationId: string
				messages: { nextSequence: number }
			}>
		}>('context', {
			actorId: actor.actorId,
			operationId: id,
			trigger: requestTrigger,
		})
		readAcknowledgements = context.privateThreads.map((thread) => ({
			conversationId: thread.conversationId,
			sequence: thread.messages.nextSequence,
		}))
		const memoryRows = store
			.prepare(
				'SELECT body FROM memories WHERE actorId=? ORDER BY id DESC LIMIT 12',
			)
			.all(actor.actorId) as Array<{ body: string }>
		const memories = memoryRows
			.flatMap((row) => {
				try {
					const memory = JSON.parse(row.body) as {
						action: string
						targetId?: string
						body?: string
					}
					if (trigger.kind === 'direct-message')
						return memory.action === 'message' &&
							memory.targetId === trigger.conversationId
							? [memory]
							: []
					return memory.action === 'message' ? [] : [memory]
				} catch {
					return []
				}
			})
			.slice(0, 6)

		const prompt = buildAgentPrompt(actor, context, memories, requestTrigger)
		const noTarget =
			(trigger.kind === 'direct-message' && !context.privateThreads.length) ||
			(trigger.kind === 'comment' &&
				(!context.posts.length || context.replyOpportunity?.mayReply === false))
		const output = noTarget
			? JSON.stringify({ action: 'skip' })
			: await runWritingBatch(`runtime-${id}`, prompt, {
					maxTokens:
						trigger.kind === 'direct-message'
							? 768
							: trigger.kind === 'comment'
								? 1024
								: trigger.kind === 'social'
									? 512
									: 2048,
					timeoutMs: 90000,
				})
		decision = JSON.parse(
			output.replace(/^```(?:json)?\s*|\s*```$/g, ''),
		) as AgentDecision
		store
			.prepare(
				'UPDATE jobs SET decision=?,action=?,status=?,readAcknowledgements=? WHERE id=?',
			)
			.run(
				JSON.stringify(decision),
				decision.action,
				'running',
				JSON.stringify(readAcknowledgements),
				id,
			)
		store
			.prepare('UPDATE jobs SET targetTitle=? WHERE id=?')
			.run(
				decision.title ??
					[...context.posts, ...context.books].find(
						(item) => item.id === decision.targetId,
					)?.title ??
					null,
				id,
			)
	}
	const operation: AgentOperation = {
		operationId: id,
		trigger: legacyDecision ? undefined : requestTrigger,
		readAcknowledgements,
		actorId: actor.actorId,
		decision,
	}
	// Always query receipt first after an uncertain network result or restart.
	const cached = await request<unknown>('receipt', {
		operationId: id,
		actorId: actor.actorId,
	})
	const result =
		cached && !readAcknowledgements.length
			? cached
			: await request<unknown>('operations', operation)
	const now = new Date().toISOString()
	store
		.prepare(
			"UPDATE jobs SET status='complete',result=?,updatedAt=?,error=NULL WHERE id=?",
		)
		.run(JSON.stringify(result), now, id)
	store
		.prepare('UPDATE personas SET lastRunAt=? WHERE id=?')
		.run(now, actor.actorId)
	remember(
		actor.actorId,
		JSON.stringify({
			action: decision.action,
			targetId: decision.targetId,
			body: decision.body?.slice(0, 300),
			at: now,
		}),
	)
	completed++
}
const heartbeatTimer = setInterval(() => {
	if (stopping) return
	configure('heartbeatAt', new Date().toISOString())
	if (process.env.CAMPUS_AGENT_PARENT_PID) {
		try {
			process.kill(Number(process.env.CAMPUS_AGENT_PARENT_PID), 0)
		} catch {
			stop()
		}
	}
}, 3000)
heartbeatTimer.unref()

try {
	while (!stopping) {
		configure('heartbeatAt', new Date().toISOString())
		if (process.env.CAMPUS_AGENT_PARENT_PID) {
			try {
				process.kill(Number(process.env.CAMPUS_AGENT_PARENT_PID), 0)
			} catch {
				stop()
				break
			}
		}
		if (!synchronized) {
			try {
				const actors =
					await request<Parameters<typeof syncPersonas>[0]>('actors')
				await syncPersonas(actors)
				if (
					syncFailureReason &&
					setting('pauseReason', '') === syncFailureReason &&
					!PROTECTED_PAUSE.test(syncFailureReason)
				)
					configure('pauseReason', null)
				syncFailureReason = undefined
				for (const actor of actors)
					if (actor.humanControlled) humanControlledActors.add(actor.id)
				synchronized = true
			} catch (e) {
				if (!PROTECTED_PAUSE.test(setting('pauseReason', '') ?? '')) {
					syncFailureReason = e instanceof Error ? e.message : 'PRODUCT_OFFLINE'
					configure('pauseReason', syncFailureReason)
				}
				if (single || syncOnly) break
				await new Promise((r) => setTimeout(r, 3000))
				continue
			}
		}
		if (syncOnly) break
		const protectedPause = PROTECTED_PAUSE.test(
			setting('pauseReason', '') ?? '',
		)
		if (
			protectedPause ||
			(!single &&
				!setting('enabled', false) &&
				!store
					.prepare(
						"SELECT id FROM jobs WHERE status IN ('queued','ready') LIMIT 1",
					)
					.get())
		) {
			if (single) break
			await new Promise((r) => setTimeout(r, 1000))
			continue
		}
		if (Date.now() >= nextSignals) {
			try {
				const result = await request<{
					cursor: string
					humanControlledActorIds: string[]
					signals: Array<{
						id: string
						actorId: string
						createdAt: string
						kind?: string
						trigger?: AgentTrigger
					}>
				}>('signals', {
					pendingSignalIds: (
						store
							.prepare('SELECT id FROM signals WHERE trigger IS NULL LIMIT 200')
							.all() as Array<{ id: string }>
					).map((row) => row.id),
					after: setting(
						'signalCursor',
						new Date(Date.now() - 86400000).toISOString(),
					),
				})
				humanControlledActors.clear()
				for (const id of result.humanControlledActorIds ?? [])
					humanControlledActors.add(id)
				store.transaction(() => {
					for (const item of result.signals)
						store
							.prepare(
								'INSERT INTO signals(id,actorId,createdAt,kind,trigger) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET trigger=excluded.trigger,kind=excluded.kind',
							)
							.run(
								item.id,
								item.actorId,
								item.createdAt,
								item.kind ?? '',
								item.trigger ? JSON.stringify(item.trigger) : null,
							)
					configure('signalCursor', result.cursor)
				})()
			} catch {
				/* Product outage must not kill the independent worker. */
			}
			nextSignals = Date.now() + 750
		}
		const budget = await readTaskBudget()
		if (budget.stopped || (!budget.unlimited && budget.remainingUsd < 0.02)) {
			configure('enabled', false)
			if (!PROTECTED_PAUSE.test(setting('pauseReason', '') ?? ''))
				configure(
					'pauseReason',
					budget.stopped ? `BUDGET_STOPPED:${budget.stopped}` : 'BUDGET_LIMIT',
				)
			if (single || syncOnly) break
			await new Promise((r) => setTimeout(r, 1000))
			continue
		}
		if (maximum > 0 && !single && completed + active.size >= maximum) {
			if (active.size === 0) break
			await new Promise((r) => setTimeout(r, 200))
			continue
		}

		const backgroundLimit = single
			? 1
			: Math.min(MAX_CONCURRENCY - 2, Math.max(1, setting('concurrency', 1)))
		const backgroundActive = [...activeKinds.values()].filter(
			(kind) => kind !== 'direct-message',
		).length
		const directActive = active.size - backgroundActive
		const totalLimit = single ? 1 : MAX_CONCURRENCY
		const decisionLimit = setting('decisionLimit', 200)
		if (active.size >= totalLimit) {
			await new Promise((r) => setTimeout(r, 100))
			continue
		}
		if (
			decisionLimit > 0 &&
			completedDecisions() + active.size >= decisionLimit
		) {
			configure('enabled', false)
			configure('pauseReason', 'DECISION_LIMIT')
			await new Promise((r) => setTimeout(r, 500))
			continue
		}
		const everyone = personas()
		const all = everyone
			.slice(0, setting('actorLimit', everyone.length))
			.filter(
				(p) => !active.has(p.actorId) && !humanControlledActors.has(p.actorId),
			)
		interface PendingJob {
			id: string
			actorId: string
			decision: string | null
			readAcknowledgements: string | null
			trigger: string | null
		}
		const pendingRows = store
			.prepare(
				"SELECT id,actorId,decision,readAcknowledgements,trigger FROM jobs WHERE status IN ('ready','queued') AND actorId NOT IN (SELECT actorId FROM jobs WHERE status='running') AND (status='queued' OR updatedAt<?) ORDER BY CASE status WHEN 'ready' THEN 0 ELSE 1 END,createdAt",
			)
			.all(new Date(Date.now() - 10000).toISOString()) as PendingJob[]
		const pending = pendingRows.find((job) => {
			if (active.has(job.actorId) || humanControlledActors.has(job.actorId))
				return false
			const kind = job.trigger
				? (JSON.parse(job.trigger) as AgentTrigger).kind
				: 'sweep'
			return kind === 'direct-message'
				? directActive < 2
				: backgroundActive < backgroundLimit
		})
		interface SignalRow {
			id: string
			actorId: string
			kind: string
			createdAt: string
			trigger: string | null
			lastRunAt: string | null
		}
		const signalRows = setting('enabled', false)
			? (store
					.prepare(
						"SELECT signals.*,personas.lastRunAt FROM signals JOIN personas ON personas.id=signals.actorId WHERE signals.actorId NOT IN (SELECT actorId FROM jobs WHERE status='running') ORDER BY signals.createdAt",
					)
					.all() as SignalRow[])
			: []
		const failedSignalIds = new Set(
			(
				store
					.prepare(
						"SELECT trigger FROM jobs WHERE status='failed' AND trigger IS NOT NULL",
					)
					.all() as Array<{ trigger: string }>
			).flatMap(
				(job) => (JSON.parse(job.trigger) as AgentTrigger).signalIds ?? [],
			),
		)
		const groups = new Map<
			string,
			{ trigger: AgentTrigger; signals: SignalRow[] }
		>()
		for (const signal of signalRows) {
			if (failedSignalIds.has(signal.id)) continue
			if (
				active.has(signal.actorId) ||
				humanControlledActors.has(signal.actorId)
			)
				continue
			const trigger: AgentTrigger = signal.trigger
				? (JSON.parse(signal.trigger) as AgentTrigger)
				: {
						kind:
							signal.kind === 'DirectMessageCreated'
								? 'direct-message'
								: ['CommentCreated', 'MentionCreated'].includes(signal.kind)
									? 'comment'
									: 'social',
						recipientId: signal.actorId,
						signalId: signal.id,
						createdAt: signal.createdAt,
					}
			// Older signals without target metadata cannot safely inspect a private conversation.
			if (trigger.kind === 'direct-message' && !trigger.conversationId) continue
			if (trigger.kind === 'comment' && !trigger.targetId) continue
			const key = `${signal.actorId}:${trigger.kind}:${trigger.kind === 'social' ? '' : (trigger.conversationId ?? trigger.targetId ?? '')}`
			const group = groups.get(key)
			if (group) {
				group.signals.push(signal)
				group.trigger =
					trigger.kind === 'social'
						? {
								...trigger,
								relatedSignals: group.signals
									.slice(-12)
									.flatMap((item) =>
										item.trigger
											? [JSON.parse(item.trigger) as AgentTrigger]
											: [],
									),
							}
						: trigger
			} else groups.set(key, { trigger, signals: [signal] })
		}
		const eligible = [...groups.values()]
			.filter((group) => {
				const kind = group.trigger.kind
				const last = group.signals.at(-1)!,
					first = group.signals[0]!
				const age = Date.now() - Date.parse(last.createdAt)
				if (kind === 'direct-message')
					return (
						directActive < 2 &&
						(age >= 500 || Date.now() - Date.parse(first.createdAt) >= 1500)
					)
				if (backgroundActive >= backgroundLimit) return false
				const cooldown = 10000
				return (
					age >= 1500 &&
					(!last.lastRunAt ||
						Date.now() - Date.parse(last.lastRunAt) >= cooldown)
				)
			})
			.sort(
				(a, b) =>
					({ 'direct-message': 0, comment: 1, social: 2, sweep: 3 })[
						a.trigger.kind
					] -
					{ 'direct-message': 0, comment: 1, social: 2, sweep: 3 }[
						b.trigger.kind
					],
			)
		const directPending = pendingRows.find(
			(job) =>
				!active.has(job.actorId) &&
				!humanControlledActors.has(job.actorId) &&
				job.trigger &&
				(JSON.parse(job.trigger) as AgentTrigger).kind === 'direct-message' &&
				directActive < 2,
		)
		const wake = directPending ? undefined : eligible[0]
		const selectedPending =
			directPending ??
			(wake?.trigger.kind === 'direct-message' ? undefined : pending)
		const canSweep =
			backgroundActive < backgroundLimit &&
			(single || (setting('enabled', false) && Date.now() >= nextRun))
		if (!selectedPending && !wake && !canSweep) {
			await new Promise((r) => setTimeout(r, 100))
			continue
		}

		const hour = Number(
			new Intl.DateTimeFormat('en', {
				hour: 'numeric',
				hourCycle: 'h23',
				timeZone: 'Asia/Shanghai',
			}).format(new Date()),
		)
		const candidates = all.filter((p) => {
			const row = store
				.prepare('SELECT lastRunAt FROM personas WHERE id=?')
				.get(p.actorId) as { lastRunAt: string | null }
			return (
				(!row.lastRunAt ||
					Date.now() - Date.parse(row.lastRunAt) > p.cooldownMinutes * 60000) &&
				Math.random() <
					p.activityWeight * (p.activeHours.includes(hour) ? 1 : 0.2)
			)
		})
		const actor = selectedPending
			? everyone.find((p) => p.actorId === selectedPending.actorId)
			: wake
				? everyone.find((p) => p.actorId === wake.trigger.recipientId)
				: single
					? all[completed % all.length]
					: candidates[Math.floor(Math.random() * candidates.length)]

		if (!actor) {
			if (single || syncOnly) break
			nextRun = Date.now() + 30000
			continue
		}
		const trigger: AgentTrigger = selectedPending?.trigger
			? (JSON.parse(selectedPending.trigger) as AgentTrigger)
			: wake
				? {
						...wake.trigger,
						signalIds: wake.signals.map((signal) => signal.id),
					}
				: { kind: 'sweep', recipientId: actor.actorId }
		const consumedSignals = (
			trigger.signalIds ??
			(selectedPending ? [] : (wake?.signals.map((signal) => signal.id) ?? []))
		).map((id) => ({ id }))

		const id = selectedPending?.id ?? randomUUID(),
			now = new Date().toISOString()
		store
			.prepare(
				"INSERT INTO jobs(id,actorId,status,createdAt,updatedAt,leaseUntil,trigger) VALUES(?,?,'running',?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='running',updatedAt=excluded.updatedAt",
			)
			.run(
				id,
				actor.actorId,
				now,
				now,
				new Date(Date.now() + 180000).toISOString(),
				JSON.stringify(trigger),
			)
		const execute = async () => {
			try {
				await runJob(
					actor,
					id,
					selectedPending?.decision,
					selectedPending?.readAcknowledgements,
					trigger,
					Boolean(selectedPending?.decision && !selectedPending.trigger),
				)
				store.transaction(() => {
					for (const signal of consumedSignals)
						store.prepare('DELETE FROM signals WHERE id=?').run(signal.id)
				})()
			} catch (e) {
				const error = e instanceof Error ? e.message : 'AGENT_FAILED'
				const humanControlled = error.includes('AGENT_HUMAN_CONTROLLED')
				if (humanControlled) humanControlledActors.add(actor.actorId)

				const saved = store
					.prepare('SELECT decision FROM jobs WHERE id=?')
					.get(id) as { decision: string | null }
				store
					.prepare('UPDATE jobs SET status=?,error=?,updatedAt=? WHERE id=?')
					.run(
						humanControlled
							? saved.decision
								? 'ready'
								: 'queued'
							: saved.decision &&
								  !/PRODUCT_4\d\d/.test(error) &&
								  !PROTECTED_PAUSE.test(error)
								? 'ready'
								: 'failed',
						error,
						new Date().toISOString(),
						id,
					)
				const priorReason = setting('pauseReason', '') ?? ''
				if (
					!humanControlled &&
					(!PROTECTED_PAUSE.test(priorReason) ||
						(!/PI_USAGE_UNKNOWN/.test(priorReason) &&
							PROTECTED_PAUSE.test(error)))
				)
					configure('pauseReason', error)
				if (PROTECTED_PAUSE.test(error)) configure('enabled', false)
			}
		}
		activeKinds.set(actor.actorId, trigger.kind)
		const execution = execute().finally(() => {
			active.delete(actor.actorId)
			activeKinds.delete(actor.actorId)
		})
		active.set(actor.actorId, execution)
		if (single) await execution

		if (trigger.kind === 'sweep' && !selectedPending)
			nextRun =
				Date.now() +
				setting('intervalSeconds', 60) * 1000 * (0.85 + Math.random() * 0.3)
		if (
			(single && completed >= sampleSize) ||
			(maximum > 0 && !single && completed >= maximum)
		)
			break
		if (single && setting('pauseReason', null)) break
	}
} finally {
	await Promise.allSettled(active.values())
	clearInterval(heartbeatTimer)
	configure('workerPid', null)
	configure('heartbeatAt', new Date().toISOString())
	await lock.close()
	await unlink(lockPath)
	store.close()
}
