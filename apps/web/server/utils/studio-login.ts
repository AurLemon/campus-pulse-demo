import bridgeSecret from '#campus-studio-proof-secret'
import {
	verifyStudioRequest,
	loopbackHost,
} from '../../../../modules/studio-bridge-security'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
	createError,
	getHeader,
	setHeader,
	setResponseStatus,
	type H3Event,
} from 'h3'
import type { StudioLoginTicket } from '@campus/contracts'

interface TicketRecord {
	userId: string
	expiresAt: number
}
const tickets = new Map<string, TicketRecord>()
const maximumTickets = 1000
const lifetime = 60000
export function studioLoginError(statusCode: number, code: string): never {
	const error = createError({ statusCode, statusMessage: code, data: { code } })
	error.stack = ''
	throw error
}
export function studioLoginFailure(
	event: H3Event,
	statusCode = 404,
	code = 'NOT_FOUND',
) {
	setResponseStatus(event, statusCode)
	setHeader(event, 'Cache-Control', 'no-store')
	return { error: true, statusCode, statusMessage: code, data: { code } }
}
function loopbackOrigin(value: string) {
	try {
		const url = new URL(value)
		return (
			['http:', 'https:'].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			loopbackHost(url.host) &&
			url.origin === value
		)
	} catch {
		return false
	}
}
/** Original socket/Host only. Forwarded headers never enable this development bridge. */
export function assertStudioLoginRequest(event: H3Event) {
	if (!import.meta.dev) studioLoginError(404, 'NOT_FOUND')
	if (!verifyStudioRequest(event, bridgeSecret))
		studioLoginError(403, 'STUDIO_ACCESS_DENIED')
	if (getHeader(event, 'x-campus-studio') !== '1')
		studioLoginError(403, 'STUDIO_ACCESS_DENIED')
	const origin = getHeader(event, 'origin')
	if (origin !== undefined && !loopbackOrigin(origin))
		studioLoginError(403, 'STUDIO_ACCESS_DENIED')
	if (
		event.method === 'POST' &&
		getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase() !==
			'application/json'
	)
		studioLoginError(415, 'STUDIO_JSON_REQUIRED')
	setHeader(event, 'Cache-Control', 'no-store')
	setHeader(event, 'Referrer-Policy', 'no-referrer')
}
export async function runStudioLoginRequest<T>(
	event: H3Event,
	handler: () => Promise<T>,
) {
	try {
		assertStudioLoginRequest(event)
		return await handler()
	} catch (error) {
		const failure = error as { statusCode?: number; data?: { code?: string } }
		const status = failure.statusCode
		if (
			typeof status === 'number' &&
			status >= 400 &&
			status < 500 &&
			typeof failure.data?.code === 'string' &&
			/^(?:STUDIO_[A-Z_]+|NOT_FOUND)$/.test(failure.data.code)
		)
			return studioLoginFailure(event, status, failure.data.code)
		if (typeof status === 'number' && status >= 400 && status < 500)
			return studioLoginFailure(event, 422, 'STUDIO_INVALID_INPUT')
		console.error(
			JSON.stringify({
				code: 'STUDIO_LOGIN_FAILED',
				requestId: randomUUID(),
				error: error instanceof Error ? error.message : 'unknown',
			}),
		)
		return studioLoginFailure(event, 500, 'STUDIO_LOGIN_FAILED')
	}
}
export function studioString(value: unknown, _field: 'userId' | 'ticket') {
	if (typeof value !== 'string' || !value || value.length > 100)
		studioLoginError(422, 'STUDIO_INVALID_INPUT')
	return value
}
function cleanExpired(now: number) {
	for (const [key, entry] of tickets)
		if (entry.expiresAt <= now) tickets.delete(key)
}
export function issueStudioTicket(userId: string): StudioLoginTicket {
	const now = Date.now()
	cleanExpired(now)
	if (tickets.size >= maximumTickets)
		studioLoginError(429, 'STUDIO_TICKETS_BUSY')
	const ticket = randomBytes(32).toString('base64url'),
		expiresAt = now + lifetime
	tickets.set(createHash('sha256').update(ticket).digest('hex'), {
		userId,
		expiresAt,
	})
	return { ticket, expiresAt: new Date(expiresAt).toISOString() }
}
/** Synchronous take/delete happens before any database await, so concurrent consumers cannot replay. */
export function takeStudioTicket(value: unknown) {
	const ticket = studioString(value, 'ticket')
	if (!/^[A-Za-z0-9_-]{43}$/.test(ticket))
		studioLoginError(422, 'STUDIO_TICKET_INVALID')
	const key = createHash('sha256').update(ticket).digest('hex'),
		entry = tickets.get(key)
	tickets.delete(key)
	if (!entry) studioLoginError(410, 'STUDIO_TICKET_INVALID')
	const now = Date.now()
	cleanExpired(now)
	if (entry.expiresAt <= now) studioLoginError(410, 'STUDIO_TICKET_EXPIRED')
	return entry.userId
}
