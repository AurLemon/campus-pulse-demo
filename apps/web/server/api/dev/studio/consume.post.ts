import { createHash, randomUUID } from 'node:crypto'
import { defineEventHandler, getCookie, readBody } from 'h3'
import {
	runStudioLoginRequest,
	studioLoginFailure,
	studioLoginError,
	takeStudioTicket,
} from '../../../utils/studio-login'
export default defineEventHandler((event) => {
	if (!import.meta.dev) return studioLoginFailure(event)
	return runStudioLoginRequest(event, async () => {
		const body: unknown = await readBody(event)
		if (!body || typeof body !== 'object' || Array.isArray(body))
			studioLoginError(422, 'STUDIO_INVALID_INPUT')
		const userId = takeStudioTicket((body as Record<string, unknown>).ticket)
		const { db } = await import('@campus/domain/prisma')
		if (
			!(await db.user.findUnique({
				where: { id: userId },
				select: { id: true },
			}))
		)
			studioLoginError(404, 'STUDIO_ACCOUNT_MISSING')
		const oldToken = getCookie(event, 'campus_session')
		const { establishSession } = await import('@campus/domain/auth')
		await establishSession(event, userId)
		if (oldToken && /^[a-f0-9]{64}$/.test(oldToken)) {
			try {
				await db.authSession.deleteMany({
					where: { id: createHash('sha256').update(oldToken).digest('hex') },
				})
			} catch (error) {
				console.error(
					JSON.stringify({
						code: 'STUDIO_OLD_SESSION_CLEANUP_FAILED',
						requestId: randomUUID(),
						error: error instanceof Error ? error.message : 'unknown',
					}),
				)
			}
		}
		return { userId }
	})
})
