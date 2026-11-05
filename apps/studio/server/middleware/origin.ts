import { loopbackHost } from '../../../../modules/studio-bridge-security'
import { runStudioProductRequest } from '../utils/studio-product'
export default defineEventHandler(async (event) => {
	const host = event.node.req.headers.host
	const address = event.node.req.socket?.remoteAddress
	if (
		(host && !loopbackHost(host)) ||
		(address && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) ||
		getHeader(event, 'sec-fetch-site') === 'cross-site'
	)
		throw createError({ statusCode: 403, statusMessage: 'STUDIO_LOCAL_ONLY' })
	if (event.path.startsWith('/api/studio/'))
		setHeader(event, 'Cache-Control', 'no-store')
	if (
		['/api/studio/accounts', '/api/studio/account-link'].includes(event.path)
	) {
		const result = await runStudioProductRequest(event, async () => undefined)
		if (result) return result
		return
	}
	if (event.method !== 'POST' || !event.path.startsWith('/api/studio/')) return
	const origin = getHeader(event, 'origin')
	if (origin && origin !== getRequestURL(event).origin)
		throw createError({ statusCode: 403, statusMessage: 'ORIGIN_NOT_ALLOWED' })
	if (!getHeader(event, 'content-type')?.startsWith('application/json'))
		throw createError({ statusCode: 415, statusMessage: 'JSON_REQUIRED' })
})
