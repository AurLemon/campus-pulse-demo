import bridgeSecret from '#campus-studio-proof-secret'
import {
	verifyStudioRequest,
	originalOriginHeader,
} from '../../../../modules/studio-bridge-security'
import { randomUUID } from 'node:crypto'
import {
	createError,
	getHeader,
	getRequestURL,
	setHeader,
	setResponseStatus,
	type H3Event,
} from 'h3'

export function studioProductError(statusCode: number, code: string): never {
	const error = createError({ statusCode, statusMessage: code, data: { code } })
	error.stack = ''
	throw error
}
export function studioProductFailure(
	event: H3Event,
	statusCode = 404,
	code = 'NOT_FOUND',
) {
	setResponseStatus(event, statusCode)
	setHeader(event, 'Cache-Control', 'no-store')
	return { error: true, statusCode, statusMessage: code, data: { code } }
}
function loopbackHost(value: string) {
	const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(value)
	return (
		!!match &&
		(!match[2] || (Number(match[2]) > 0 && Number(match[2]) <= 65535))
	)
}
function pureLoopbackOrigin(value: string) {
	try {
		const url = new URL(value)
		if (
			['http:', 'https:'].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			loopbackHost(url.host) &&
			url.origin === value
		)
			return url.origin
	} catch {
		/* Invalid origins are not configuration fallback candidates. */
	}
	studioProductError(403, 'STUDIO_PRODUCT_ORIGIN_INVALID')
}
export function assertStudioProductRequest(event: H3Event) {
	if (!import.meta.dev) studioProductError(404, 'NOT_FOUND')
	if (!verifyStudioRequest(event, bridgeSecret))
		studioProductError(403, 'STUDIO_ACCESS_DENIED')
	if (getHeader(event, 'x-campus-studio') !== '1')
		studioProductError(403, 'STUDIO_ACCESS_DENIED')
	const studioOrigin = pureLoopbackOrigin(
		String(event.node.req.headers[originalOriginHeader] ?? ''),
	)
	const origin = getHeader(event, 'origin')
	if (origin !== undefined && pureLoopbackOrigin(origin) !== studioOrigin)
		studioProductError(403, 'STUDIO_ACCESS_DENIED')
	if (
		event.method === 'POST' &&
		getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase() !==
			'application/json'
	)
		studioProductError(415, 'STUDIO_JSON_REQUIRED')
	setHeader(event, 'Cache-Control', 'no-store')
	setHeader(event, 'Referrer-Policy', 'no-referrer')
	return studioOrigin
}
export function studioProductOrigin(event: H3Event, studioOrigin: string) {
	const configured = useRuntimeConfig(event).studioProductOrigin
	if (typeof configured === 'string' && configured)
		return pureLoopbackOrigin(configured)
	const origin = new URL(studioOrigin)
	origin.port = '3000'
	return origin.origin
}
/** Browser links must use the same cookie host as the current Studio page. */
export function studioProductBrowserOrigin(
	event: H3Event,
	productOrigin: string,
) {
	const product = new URL(pureLoopbackOrigin(productOrigin))
	const studio = new URL(pureLoopbackOrigin(getRequestURL(event).origin))
	product.hostname = studio.hostname
	return product.origin
}
export async function requestStudioProduct<T>(
	event: H3Event,
	path: '/api/dev/studio/users' | '/api/dev/studio/tickets',
	body?: { userId: string },
	query?: Record<string, string>,
): Promise<{ data: T; productOrigin: string }> {
	const studioOrigin = assertStudioProductRequest(event),
		productOrigin = studioProductOrigin(event, studioOrigin)
	try {
		const data = await $fetch<T, string>(`${productOrigin}${path}`, {
			method: body ? 'POST' : 'GET',
			query,
			body,
			headers: { 'x-campus-studio': '1', Origin: studioOrigin },
			timeout: 3000,
			retry: 0,
			redirect: 'error',
			credentials: 'omit',
		})
		return { data, productOrigin }
	} catch (error) {
		const failure = error as {
			response?: { status?: number }
			statusCode?: number
			data?: { data?: { code?: string } }
		}
		const status = failure.response?.status ?? failure.statusCode,
			code = failure.data?.data?.code
		if (!status) studioProductError(503, 'STUDIO_PRODUCT_OFFLINE')
		if (status === 404 && code === 'STUDIO_ACCOUNT_MISSING')
			studioProductError(404, code)
		if (status === 429) studioProductError(429, 'STUDIO_TICKETS_BUSY')
		if (status === 422) studioProductError(422, 'STUDIO_INVALID_INPUT')
		studioProductError(503, 'STUDIO_PRODUCT_UNAVAILABLE')
	}
}
export async function runStudioProductRequest<T>(
	event: H3Event,
	handler: () => Promise<T>,
) {
	try {
		assertStudioProductRequest(event)
		return await handler()
	} catch (error) {
		const failure = error as { statusCode?: number; data?: { code?: string } },
			status = failure.statusCode
		if (
			typeof status === 'number' &&
			status >= 400 &&
			status <= 503 &&
			typeof failure.data?.code === 'string' &&
			/^(?:STUDIO_[A-Z_]+|NOT_FOUND)$/.test(failure.data.code)
		)
			return studioProductFailure(event, status, failure.data.code)
		if (typeof status === 'number' && status >= 400 && status < 500)
			return studioProductFailure(event, 422, 'STUDIO_INVALID_INPUT')
		console.error(
			JSON.stringify({
				code: 'STUDIO_PRODUCT_REQUEST_FAILED',
				requestId: randomUUID(),
				error: error instanceof Error ? error.message : 'unknown',
			}),
		)
		return studioProductFailure(event, 500, 'STUDIO_PRODUCT_REQUEST_FAILED')
	}
}
