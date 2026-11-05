import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

export const proofHeader = 'x-campus-studio-proof'
export const originalOriginHeader = 'x-campus-studio-original-origin'
export function loopbackHost(value: string) {
	const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(value)
	return (
		!!match &&
		(!match[2] || (Number(match[2]) > 0 && Number(match[2]) <= 65535))
	)
}
export function loopbackOrigin(value: string) {
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
function boundRequest(event: H3Event) {
	const headers = event.node.req.headers
	return [
		event.method,
		event.node.req.url,
		headers.host,
		headers.origin ?? '',
		headers['x-campus-studio'],
		headers['content-type'] ?? '',
		headers[originalOriginHeader] ?? '',
	]
}
function signature(
	event: H3Event,
	secret: string,
	stamp: string,
	nonce: string,
) {
	return createHmac('sha256', secret)
		.update(JSON.stringify([stamp, nonce, ...boundRequest(event)]))
		.digest()
}
export function signStudioRequest(event: H3Event, secret: string) {
	const stamp = String(Date.now()),
		nonce = randomBytes(16).toString('hex')
	return `${stamp}.${nonce}.${signature(event, secret, stamp, nonce).toString('hex')}`
}
const consumed = new Map<string, number>()
const verifiedContextKey = '__campusStudioSocketProofVerified'
/** The outer Nuxt listener attests the original socket. The secret stays in server-only modules. */
export function verifyStudioRequest(event: H3Event, secret: string) {
	if (event.context[verifiedContextKey] === true) return true
	const proof = event.node.req.headers[proofHeader]
	if (!secret || typeof proof !== 'string') return false
	const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(proof)
	if (!match) return false
	const [, stamp, nonce, digest] = match,
		now = Date.now(),
		age = now - Number(stamp)
	if (age < -1000 || age > 10000) return false
	for (const [key, until] of consumed) if (until <= now) consumed.delete(key)
	if (consumed.has(nonce!) || consumed.size >= 5000) return false
	if (
		!timingSafeEqual(
			Buffer.from(digest!, 'hex'),
			signature(event, secret, stamp!, nonce!),
		)
	)
		return false
	consumed.set(nonce!, now + 11000)
	event.context[verifiedContextKey] = true
	return true
}
