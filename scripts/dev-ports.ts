import { createServer } from 'node:net'

export function validPort(value: string | number): number {
	const port = Number(value)
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error(`INVALID_DEV_PORT:${value}`)
	return port
}

/** Find sequential loopback ports; Nuxt strictPort prevents a later race from silently changing them. */
export async function availablePort(start: number): Promise<number> {
	validPort(start)
	for (let port = start; port <= 65535; port++) {
		const free = await new Promise<boolean>((resolve, reject) => {
			const server = createServer()
			server.once('error', (error: NodeJS.ErrnoException) => {
				if (error.code === 'EADDRINUSE') resolve(false)
				else reject(error)
			})
			server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
				server.close((error) => (error ? reject(error) : resolve(true)))
			})
		})
		if (free) return port
	}
	throw new Error('NO_AVAILABLE_DEV_PORT')
}
