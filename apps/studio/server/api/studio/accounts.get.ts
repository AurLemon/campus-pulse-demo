import { defineEventHandler, getQuery } from 'h3'
import type { StudioAccountsResponse } from '@campus/contracts'
import {
	requestStudioProduct,
	runStudioProductRequest,
	studioProductFailure,
} from '../../utils/studio-product'
export default defineEventHandler((event) => {
	if (!import.meta.dev) return studioProductFailure(event)
	return runStudioProductRequest(
		event,
		async () =>
			(
				await requestStudioProduct<StudioAccountsResponse>(
					event,
					'/api/dev/studio/users',
					undefined,
					Object.fromEntries(
						Object.entries(getQuery(event)).map(([key, value]) => [
							key,
							String(value),
						]),
					),
				)
			).data,
	)
})
