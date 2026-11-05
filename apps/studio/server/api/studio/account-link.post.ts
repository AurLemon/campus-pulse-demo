import { defineEventHandler, readBody } from 'h3'
import type { StudioLoginLink, StudioLoginTicket } from '@campus/contracts'
import {
	requestStudioProduct,
	runStudioProductRequest,
	studioProductFailure,
	studioProductError,
} from '../../utils/studio-product'
export default defineEventHandler((event) => {
	if (!import.meta.dev) return studioProductFailure(event)
	return runStudioProductRequest(event, async (): Promise<StudioLoginLink> => {
		const body: unknown = await readBody(event)
		if (!body || typeof body !== 'object' || Array.isArray(body))
			studioProductError(422, 'STUDIO_INVALID_INPUT')
		const userId = (body as Record<string, unknown>).userId
		if (typeof userId !== 'string' || !userId || userId.length > 100)
			studioProductError(422, 'STUDIO_INVALID_INPUT')
		const { data, productOrigin } =
			await requestStudioProduct<StudioLoginTicket>(
				event,
				'/api/dev/studio/tickets',
				{ userId },
			)
		return {
			url: `${productOrigin}/studio-login#ticket=${encodeURIComponent(data.ticket)}`,
			expiresAt: data.expiresAt,
		}
	})
})
