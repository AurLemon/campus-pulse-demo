import { defineEventHandler } from 'h3'
import { checkOrigin } from '@campus/domain/auth'
import { assertStudioLoginRequest } from '../utils/studio-login'
export default defineEventHandler((event) => {
	if (
		event.method === 'POST' &&
		['/api/dev/studio/tickets', '/api/dev/studio/consume'].includes(event.path)
	) {
		assertStudioLoginRequest(event)
		return
	}
	if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) checkOrigin(event)
})
