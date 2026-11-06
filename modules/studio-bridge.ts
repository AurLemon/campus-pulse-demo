import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { addDevServerHandler, defineNuxtModule } from 'nuxt/kit'
import { defineEventHandler, setHeader, setResponseStatus } from 'h3'
import {
	loopbackHost,
	loopbackOrigin,
	proofHeader,
	originalOriginHeader,
	signStudioRequest,
} from './studio-bridge-security.ts'

export default defineNuxtModule({
	meta: { name: 'campus-local-studio-bridge' },
	setup(_options, nuxt) {
		const secret = nuxt.options.dev ? randomBytes(32).toString('hex') : ''
		nuxt.hook('nitro:config', (config) => {
			config.virtual ??= {}
			config.virtual['#campus-studio-proof-secret'] =
				`export default ${JSON.stringify(secret)}`
		})
		nuxt.hook('prepare:types', ({ references }) => {
			references.push({
				path: fileURLToPath(
					new URL('../types/studio-bridge.d.ts', import.meta.url),
				),
			})
		})
		if (!nuxt.options.dev) return
		const paths = new Set([
			'/api/dev/studio/users',
			'/api/dev/studio/tickets',
			'/api/dev/studio/consume',
			'/api/studio/accounts',
			'/api/studio/account-link',
		])
		addDevServerHandler({
			handler: defineEventHandler((event) => {
				const path = event.path.split('?')[0]!
				if (!paths.has(path) && !path.startsWith('/api/agent/')) return
				// Remove all client-supplied attestations before validating the original TCP connection.
				delete event.node.req.headers['x-campus-studio-proof']
				delete event.node.req.headers['x-campus-studio-original-origin']
				const host = event.node.req.headers.host,
					address = event.node.req.socket.remoteAddress,
					origin = event.node.req.headers.origin,
					secure =
						(event.node.req.socket as { encrypted?: boolean }).encrypted ===
						true
				const sameOrigin = `${secure ? 'https' : 'http'}://${host}`
				let status = 403,
					code = 'STUDIO_ACCESS_DENIED'
				const valid =
					['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '') &&
					typeof host === 'string' &&
					loopbackHost(host) &&
					event.node.req.headers['x-campus-studio'] === '1' &&
					(origin === undefined ||
						(typeof origin === 'string' &&
							loopbackOrigin(origin) &&
							(!path.startsWith('/api/studio/') || origin === sameOrigin)))
				if (valid) {
					const type = event.node.req.headers['content-type']
					if (
						event.method !== 'POST' ||
						(typeof type === 'string' &&
							type.split(';')[0]?.trim().toLowerCase() === 'application/json')
					) {
						event.node.req.headers[originalOriginHeader] = sameOrigin
						event.node.req.headers[proofHeader] = signStudioRequest(
							event,
							secret,
						)
						return
					}
					status = 415
					code = 'STUDIO_JSON_REQUIRED'
				}
				setResponseStatus(event, status)
				setHeader(event, 'Cache-Control', 'no-store')
				return {
					error: true,
					statusCode: status,
					statusMessage: code,
					data: { code },
				}
			}),
		})
	},
})
