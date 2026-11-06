import { CAMPUSES } from '@campus/contracts'
import { randomUUID, createHash } from 'node:crypto'
import {
	defineEventHandler,
	createError,
	getCookie,
	type H3Event,
	type EventHandlerRequest,
} from 'h3'
import { db } from './prisma.ts'
export function fail(
	code: string,
	statusCode = 400,
	fields?: Record<string, string>,
): never {
	throw createError({
		statusCode,
		statusMessage: code,
		data: { code, fields, requestId: randomUUID() },
	})
}
export function api<T>(
	handler: (event: H3Event<EventHandlerRequest>) => Promise<T>,
) {
	return defineEventHandler(async (event) => {
		try {
			return await handler(event)
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'P2002'
			)
				fail('CONFLICT', 409)
			if (error && typeof error === 'object' && 'statusCode' in error) {
				const e = error as { statusCode: number; data?: { code?: string } }
				if (e.data?.code && /^[A-Z_]+$/.test(e.data.code)) throw error
				if (e.statusCode >= 400 && e.statusCode < 500)
					fail(
						e.statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED',
						e.statusCode,
					)
			}
			const requestId = randomUUID()
			console.error(
				JSON.stringify({
					requestId,
					code: 'INTERNAL_ERROR',
					error: error instanceof Error ? error.message : 'unknown',
				}),
			)
			throw createError({
				statusCode: 500,
				statusMessage: 'Internal server error',
				data: { code: 'INTERNAL_ERROR', requestId },
			})
		}
	})
}
export async function optionalActor(event: H3Event) {
	const token = getCookie(event, 'campus_session')
	if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
	const id = createHash('sha256').update(token).digest('hex')
	const session = await db.authSession.findUnique({ where: { id } })
	if (!session || session.expiresAt <= new Date().toISOString()) return null
	const user = await db.user.findUnique({ where: { id: session.userId } })

	return user
}
export async function actor(event: H3Event) {
	const user = await optionalActor(event)
	if (!user) fail('UNAUTHORIZED', 401)
	return user
}
export function businessNow() {
	return new Date().toISOString()
}
export function text(
	value: unknown,
	field: string,
	max: number,
	min = 1,
): string {
	if (
		typeof value !== 'string' ||
		value.trim().length < min ||
		value.trim().length > max
	)
		fail('VALIDATION_FAILED', 422, { [field]: 'INVALID_FIELD' })
	return value.trim()
}
export function tags(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length > 8 ||
		value.some(
			(v) => typeof v !== 'string' || !/^[\p{L}\p{N}_-]{1,24}$/u.test(v),
		)
	)
		fail('VALIDATION_FAILED', 422, { tags: 'INVALID_FIELD' })
	return [...new Set(value)] as string[]
}
export function objectBody(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		fail('VALIDATION_FAILED', 422)
	return value as Record<string, unknown>
}

export function campusName(value: unknown): string {
	if (typeof value !== 'string' || !CAMPUSES.some((c) => c === value))
		fail('VALIDATION_FAILED', 422, { campus: 'INVALID_FIELD' })
	return value as string
}
