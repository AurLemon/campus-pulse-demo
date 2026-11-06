import { readOnlyBookSnapshot } from '@campus/domain/books'
import { recommendBooks } from '@campus/recommendation/books'
import type { BookMode } from '@campus/contracts/books'
import { studioDatabaseUrl } from '../../../utils/snapshot'
export default defineEventHandler(async (event) => {
	const input: unknown = await readBody(event)
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw createError({ statusCode: 422 })
	const body = input as Record<string, unknown>,
		snapshot = await readOnlyBookSnapshot(studioDatabaseUrl())
	const resultCount = Number(body.resultCount ?? 20),
		neighborCount = Number(body.neighborCount ?? 15),
		mode = String(body.mode ?? 'hybrid')
	if (
		!Number.isInteger(resultCount) ||
		resultCount < 0 ||
		resultCount > 50 ||
		!Number.isInteger(neighborCount) ||
		neighborCount < 0 ||
		neighborCount > 100 ||
		!['hybrid', 'user', 'item', 'content'].includes(mode) ||
		!snapshot.users.some((u) => u.id === body.userId)
	)
		throw createError({ statusCode: 422, statusMessage: 'INVALID_INPUT' })
	const suppliedWeights = body.weights
	const keys = ['user', 'item', 'content'] as const
	if (suppliedWeights !== undefined) {
		if (
			!suppliedWeights ||
			typeof suppliedWeights !== 'object' ||
			Array.isArray(suppliedWeights) ||
			Object.keys(suppliedWeights).length !== 3
		)
			throw createError({ statusCode: 422, statusMessage: 'INVALID_WEIGHTS' })
		const values = suppliedWeights as Record<string, unknown>
		if (
			keys.some(
				(key) =>
					typeof values[key] !== 'number' ||
					!Number.isFinite(values[key]) ||
					values[key] < 0 ||
					values[key] > 100,
			)
		)
			throw createError({ statusCode: 422, statusMessage: 'INVALID_WEIGHTS' })
	}
	const weights = suppliedWeights as
		{ user: number; item: number; content: number } | undefined
	const now = new Date().toISOString()
	return {
		now,
		result: recommendBooks({
			now,
			snapshot,
			userId: String(body.userId),
			mode: mode as BookMode,
			resultCount,
			neighborCount,
			crossDomain: body.crossDomain !== false,
			weights,
		}),
		books: snapshot.books,
	}
})
