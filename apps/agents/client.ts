import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
export function credential() {
	const path = resolve(
		process.env.CAMPUS_AGENT_TOKEN_FILE ?? '.data/agents/service-token',
	)
	return readFileSync(path, 'utf8').trim()
}
export function productOrigin() {
	const origin =
		process.env.CAMPUS_AGENT_PRODUCT_ORIGIN ?? 'http://127.0.0.1:3000'
	const u = new URL(origin)
	if (
		!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
		u.origin !== origin
	)
		throw new Error('AGENT_LOOPBACK_REQUIRED')
	return origin
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
	const response = await fetch(`${productOrigin()}/api/agent/${path}`, {
		method: body ? 'POST' : 'GET',
		headers: {
			authorization: `Bearer ${credential()}`,
			'x-campus-studio': '1',
			...(body ? { 'content-type': 'application/json' } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(15000),
		redirect: 'error',
	})
	if (!response.ok) {
		const source = await response.text()
		let code = ''
		try {
			const details = JSON.parse(source) as {
				data?: { code?: string }
				statusMessage?: string
				message?: string
			}
			code =
				details.statusMessage ??
				details.data?.code ??
				(details.message && /^[A-Z_]+$/.test(details.message)
					? details.message
					: '')
		} catch {
			/* Non-JSON upstream errors still retain their bounded source. */
		}
		if (response.status === 409 && /AGENT_HUM/.test(source))
			code = 'AGENT_HUMAN_CONTROLLED'
		throw new Error(
			`PRODUCT_${response.status}:${code}:${source.slice(0, 160)}`,
		)
	}

	const payload = await response.text()
	return (payload ? JSON.parse(payload) : null) as T
}
