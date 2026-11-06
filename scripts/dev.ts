import '../tools/agents/environment.ts'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availablePort, validPort } from './dev-ports.ts'
import { superviseStudioProcesses } from './studio-with-agents.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2).filter((value) => value !== '--')
let requested = validPort(
	process.env.NUXT_PORT || process.env.NITRO_PORT || process.env.PORT || 3000,
)
for (let i = 0; i < args.length; i++) {
	const arg = args[i]!
	if (arg === '--port' || arg === '-p') requested = validPort(args[++i] ?? '')
	else if (arg.startsWith('--port=')) requested = validPort(arg.slice(7))
	else throw new Error(`UNSUPPORTED_DEV_ARGUMENT:${arg}`)
}
const webPort = await availablePort(requested)
const studioPort = await availablePort(webPort + 1)
const origin = `http://127.0.0.1:${webPort}`
// The account bridge, profile links and worker must all target the selected Web server.
process.env.CAMPUS_AGENT_PRODUCT_ORIGIN = origin
process.env.NUXT_STUDIO_PRODUCT_ORIGIN = origin
const require = createRequire(import.meta.url)
const nuxt = join(dirname(require.resolve('nuxt/package.json')), 'bin/nuxt.mjs')
function devArgs(app: string, port: number): string[] {
	return [
		nuxt,
		'dev',
		join(root, 'apps', app),
		'--host',
		'127.0.0.1',
		'--port',
		String(port),
		'--strictPort',
		'--no-takeover',
		'--no-tui',
	]
}
console.log(`[dev] Web ${origin} / Studio http://127.0.0.1:${studioPort}`)
await superviseStudioProcesses(
	[join(root, 'apps/agents/worker.ts')],
	devArgs('studio', studioPort),
	{},
	devArgs('web', webPort),
)
