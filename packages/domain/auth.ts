import {
	randomBytes,
	scrypt as scryptCallback,
	timingSafeEqual,
	createHash,
} from 'node:crypto'
import { promisify } from 'node:util'
import {
	setCookie,
	deleteCookie,
	getCookie,
	getRequestIP,
	getHeader,
	getRequestURL,
	type H3Event,
} from 'h3'
import { db } from './prisma.ts'
import { fail, text } from './validation.ts'
const scrypt = promisify(scryptCallback)
const attempts = new Map<string, { count: number; until: number }>()
export function checkOrigin(event: H3Event) {
	const origin = getHeader(event, 'origin')
	if (origin && origin !== getRequestURL(event).origin) fail('FORBIDDEN', 403)
	const site = getHeader(event, 'sec-fetch-site')
	if (site === 'cross-site') fail('FORBIDDEN', 403)
}
export function authLimit(event: H3Event) {
	const key = getRequestIP(event) ?? 'unknown',
		now = Date.now()
	let entry = attempts.get(key)
	if (!entry || entry.until <= now) {
		entry = { count: 0, until: now + 60000 }
		attempts.set(key, entry)
	}
	if (++entry.count > 20) fail('RATE_LIMITED', 429)
	if (attempts.size > 5000)
		for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k)
}
export function accountName(value: unknown) {
	const s = text(value, 'account', 40, 3).toLowerCase()
	if (!/^[a-z0-9_-]+$/.test(s))
		fail('VALIDATION_FAILED', 422, { account: 'INVALID_FIELD' })
	return s
}
export function passwordText(value: unknown) {
	if (typeof value !== 'string' || value.length < 8 || value.length > 128)
		fail('VALIDATION_FAILED', 422, { password: 'INVALID_FIELD' })
	return value
}
export async function hashPassword(value: string) {
	const salt = randomBytes(16).toString('hex')
	const key = (await scrypt(value, salt, 64)) as Buffer
	return `${salt}:${key.toString('hex')}`
}
export async function verifyPassword(value: string, stored: string) {
	const [salt, hash] = stored.split(':')
	if (!salt || !hash) return false
	const key = (await scrypt(value, salt, 64)) as Buffer
	const expected = Buffer.from(hash, 'hex')
	return expected.length === key.length && timingSafeEqual(expected, key)
}
export async function establishSession(event: H3Event, userId: string) {
	const token = randomBytes(32).toString('hex'),
		id = createHash('sha256').update(token).digest('hex'),
		now = new Date()
	await db.authSession.create({
		data: {
			id,
			userId,
			createdAt: now.toISOString(),
			expiresAt: new Date(+now + 30 * 86400000).toISOString(),
		},
	})
	setCookie(event, 'campus_session', token, {
		httpOnly: true,
		sameSite: 'lax',
		secure: getRequestURL(event).protocol === 'https:',
		path: '/',
		maxAge: 30 * 86400,
	})
}
export async function logout(event: H3Event) {
	const token = getCookie(event, 'campus_session')
	if (token)
		await db.authSession.deleteMany({
			where: { id: createHash('sha256').update(token).digest('hex') },
		})
	deleteCookie(event, 'campus_session', { path: '/' })
}
