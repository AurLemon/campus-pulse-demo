import { randomUUID } from 'node:crypto'
import {
	recommendActivities,
	recommendPosts,
	EXPLORATION_STRENGTH,
} from '@campus/recommendation'
import type { RecommendationTraceEvent } from '@campus/recommendation'
import type { ScoreWeights } from '@campus/contracts'
import { readStudioSnapshot } from '../../utils/snapshot'

export default defineEventHandler(async (event) => {
	const body: unknown = await readBody(event)
	if (!body || typeof body !== 'object' || Array.isArray(body))
		throw createError({ statusCode: 422, statusMessage: 'INVALID_INPUT' })
	const value = body as Record<string, unknown>
	const { snapshot, revision } = await readStudioSnapshot(
		value.crossDomain !== false,
	)
	const seed = value.seed ?? randomUUID()
	if (typeof seed !== 'string' || !seed || seed.length > 128)
		throw createError({ statusCode: 422, statusMessage: 'INVALID_INPUT' })
	const k = Number(value.k)
	const now =
		value.clock === 'fixed' ? String(value.now ?? snapshot.now) : snapshot.now
	const type = value.type ?? 'activity'
	if (
		(type === 'post' && !snapshot.posts.length) ||
		(type === 'activity' && !snapshot.activities.length)
	)
		throw createError({ statusCode: 503, statusMessage: 'STUDIO_DATA_EMPTY' })
	if (
		!Number.isInteger(k) ||
		k < 0 ||
		k > 50 ||
		!snapshot.users.some((user) => user.id === value.userId) ||
		!Number.isFinite(Date.parse(now)) ||
		(type !== 'activity' && type !== 'post')
	)
		throw createError({ statusCode: 422, statusMessage: 'INVALID_INPUT' })
	const suppliedWeights = value.weights
	if (
		!suppliedWeights ||
		typeof suppliedWeights !== 'object' ||
		Array.isArray(suppliedWeights)
	)
		throw createError({ statusCode: 422, statusMessage: 'INVALID_WEIGHTS' })
	const weights = suppliedWeights as ScoreWeights
	const keys = ['interest', 'social', 'popularity', 'context'] as const
	if (
		Object.keys(weights).length !== 4 ||
		keys.some(
			(key) =>
				!Number.isFinite(weights[key]) ||
				weights[key] < 0 ||
				weights[key] > 100,
		) ||
		!keys.reduce((sum, key) => sum + weights[key], 0)
	)
		throw createError({ statusCode: 422, statusMessage: 'INVALID_WEIGHTS' })
	const events: RecommendationTraceEvent[] = []
	const result = (type === 'post' ? recommendPosts : recommendActivities)(
		{
			snapshot,
			userId: String(value.userId),
			now,
			k,
			weights,
			exploration: { seed, strength: EXPLORATION_STRENGTH },
		},
		{ onTrace: (step) => events.push(step), maxEvents: 10000 },
	)
	return {
		snapshot,
		revision,
		now,
		result,
		events,
		truncated: events.some((step) => step.action === 'truncated'),
	}
})
