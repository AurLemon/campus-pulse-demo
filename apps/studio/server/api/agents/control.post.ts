import {
	configure,
	runtimeStatus,
	enqueueActor,
	MAX_BACKGROUND_CONCURRENCY,
	MAX_ACTORS,
} from '../../../../agents/store'
import {
	CURRENT_TASK_BUDGET,
	increaseTaskBudget,
	readTaskBudget,
	setTaskBudgetUnlimited,
} from '../../../../../tools/content/budget'
export default defineEventHandler(async (event) => {
	const origin = getHeader(event, 'origin')
	if (
		origin !== getRequestURL(event).origin ||
		getHeader(event, 'sec-fetch-site') === 'cross-site'
	)
		throw createError({ statusCode: 403, statusMessage: 'ORIGIN_NOT_ALLOWED' })
	const b = await readBody<Record<string, unknown>>(event)
	if (b.action === 'unlimitedBudget') {
		if (typeof b.enabled !== 'boolean' || (b.enabled && b.confirm !== true))
			throw createError({
				statusCode: 422,
				statusMessage: 'EXPLICIT_CONFIRMATION_REQUIRED',
			})
		const budget = await setTaskBudgetUnlimited(b.enabled)
		if (!budget.unlimited && budget.remainingUsd < 0.02) {
			configure('enabled', false)
			configure('pauseReason', 'BUDGET_LIMIT')
		}
	} else if (b.action === 'increase')
		await increaseTaskBudget(CURRENT_TASK_BUDGET, Number(b.additionalUsd))
	else if (b.action === 'stop') configure('enabled', false)
	else if (b.action === 'start') {
		const budget = await readTaskBudget()
		if (budget.stopped || (!budget.unlimited && budget.remainingUsd < 0.02))
			throw createError({ statusCode: 409, statusMessage: 'BUDGET_LIMIT' })
		if (
			runtimeStatus().decisionLimit > 0 &&
			runtimeStatus().completedDecisions >= runtimeStatus().decisionLimit
		)
			throw createError({ statusCode: 409, statusMessage: 'DECISION_LIMIT' })
		configure('enabled', true)
		configure('pauseReason', null)
	} else if (b.action === 'configure') {
		const interval = Number(b.intervalSeconds),
			limit = Number(b.actorLimit),
			concurrency = Number(b.concurrency),
			decisionLimit = Number(b.decisionLimit)
		const fields: Record<string, string> = {}
		if (!Number.isInteger(interval) || interval < 15 || interval > 3600)
			fields.intervalSeconds = '15–3600'
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTORS)
			fields.actorLimit = `1–${MAX_ACTORS}`
		if (
			!Number.isInteger(concurrency) ||
			concurrency < 1 ||
			concurrency > MAX_BACKGROUND_CONCURRENCY
		)
			fields.concurrency = `1–${MAX_BACKGROUND_CONCURRENCY}`
		if (!Number.isSafeInteger(decisionLimit) || decisionLimit < 0)
			fields.decisionLimit = '≥ 0'
		if (Object.keys(fields).length)
			throw createError({
				statusCode: 422,
				statusMessage: 'INVALID_SETTINGS',
				data: { fields },
			})

		configure('intervalSeconds', interval)
		configure('actorLimit', limit)
		configure('concurrency', concurrency)
		configure('decisionLimit', decisionLimit)
		if (
			decisionLimit > 0 &&
			runtimeStatus().completedDecisions >= decisionLimit
		) {
			configure('enabled', false)
			configure('pauseReason', 'DECISION_LIMIT')
		}
	} else if (b.action === 'step') {
		const status = runtimeStatus()
		if (!status.personas.some((p) => p.actorId === b.actorId))
			throw createError({ statusCode: 422, statusMessage: 'INVALID_ACTOR' })
		const budget = await readTaskBudget()
		if (budget.stopped || (!budget.unlimited && budget.remainingUsd < 0.02))
			throw createError({ statusCode: 409, statusMessage: 'BUDGET_LIMIT' })
		if (
			status.decisionLimit > 0 &&
			status.completedDecisions >= status.decisionLimit
		)
			throw createError({ statusCode: 409, statusMessage: 'DECISION_LIMIT' })
		enqueueActor(String(b.actorId))
	} else throw createError({ statusCode: 422, statusMessage: 'INVALID_ACTION' })
	return { ...runtimeStatus(), budget: await readTaskBudget() }
})
