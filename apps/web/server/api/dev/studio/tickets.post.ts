import { defineEventHandler, readBody } from 'h3'
import {
	runStudioLoginRequest,
	studioLoginFailure,
	studioLoginError,
	studioString,
	issueStudioTicket,
} from '../../../utils/studio-login'
export default defineEventHandler((event) => {
	if (!import.meta.dev) return studioLoginFailure(event)
	return runStudioLoginRequest(event, async () => {
		const body: unknown = await readBody(event)
		if (!body || typeof body !== 'object' || Array.isArray(body))
			studioLoginError(422, 'STUDIO_INVALID_INPUT')
		const userId = studioString(
			(body as Record<string, unknown>).userId,
			'userId',
		)
		const { db } = await import('@campus/domain/prisma')
		if (
			!(await db.user.findUnique({
				where: { id: userId },
				select: { id: true },
			}))
		)
			studioLoginError(404, 'STUDIO_ACCOUNT_MISSING')
		return issueStudioTicket(userId)
	})
})
