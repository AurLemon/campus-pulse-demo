import '../tools/agents/environment.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availablePort } from './dev-ports.ts'
import { productOrigin } from '../apps/agents/client.ts'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
interface ProcessGracePeriods {
	workerMs?: number
	studioMs?: number
}
/** Own the development process trees and let bounded worker requests settle before cleanup. */
export async function superviseStudioProcesses(
	workerArgs: string[],
	studioArgs: string[],
	grace: ProcessGracePeriods = {},
	webArgs?: string[],
) {
	const windows = process.platform === 'win32'
	const options = {
		cwd: projectRoot,
		detached: !windows,
		stdio: 'inherit' as const,
	}
	const worker = spawn(process.execPath, workerArgs, {
		...options,
		env: { ...process.env, CAMPUS_AGENT_PARENT_PID: String(process.pid) },
	})
	const studio = spawn(process.execPath, studioArgs, options)
	const web = webArgs ? spawn(process.execPath, webArgs, options) : undefined
	const ended = (child: ChildProcess) =>
		new Promise<void>((done) => {
			child.once('exit', () => done())
			child.once('error', () => {
				process.exitCode = 1
				done()
			})
		})
	const workerEnded = ended(worker),
		studioEnded = ended(studio),
		webEnded = web ? ended(web) : Promise.resolve(),
		cleaned = new Set<number>()
	function signalTree(child: ChildProcess, signal: NodeJS.Signals) {
		if (!child.pid || cleaned.has(child.pid)) return
		try {
			if (windows) {
				const killer = spawn(
					'taskkill',
					['/PID', String(child.pid), '/T', '/F'],
					{ stdio: 'ignore' },
				)
				killer.once('error', () => child.kill())
			} else process.kill(-child.pid, signal)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
		}
		if (signal === 'SIGKILL' || windows) cleaned.add(child.pid)
	}
	let closing = false,
		workerTimer: ReturnType<typeof setTimeout> | undefined,
		studioTimer: ReturnType<typeof setTimeout> | undefined
	function close() {
		if (closing) return
		closing = true
		signalTree(studio, 'SIGTERM')
		if (web) signalTree(web, 'SIGTERM')
		if (windows) signalTree(worker, 'SIGKILL')
		else if (worker.exitCode === null && worker.signalCode === null)
			worker.kill('SIGTERM')
		workerTimer = setTimeout(
			() => signalTree(worker, 'SIGKILL'),
			grace.workerMs ?? 130000,
		)
		studioTimer = setTimeout(() => {
			signalTree(studio, 'SIGKILL')
			if (web) signalTree(web, 'SIGKILL')
		}, grace.studioMs ?? 5000)
	}
	process.on('SIGINT', close)
	process.on('SIGTERM', close)
	if (web)
		void webEnded.then(() => {
			if (!closing && web.exitCode) process.exitCode = web.exitCode
			signalTree(web, 'SIGKILL')
			close()
		})
	// A leader exiting must never leave its Pi/Nuxt descendants behind.
	void workerEnded.then(() => signalTree(worker, 'SIGKILL'))
	void studioEnded.then(() => {
		if (!closing && studio.exitCode) process.exitCode = studio.exitCode
		signalTree(studio, 'SIGKILL')
		close()
	})
	try {
		await studioEnded
		close()
		await Promise.all([workerEnded, webEnded])
	} finally {
		clearTimeout(workerTimer)
		clearTimeout(studioTimer)
		signalTree(worker, 'SIGKILL')
		signalTree(studio, 'SIGKILL')
		if (web) signalTree(web, 'SIGKILL')
		process.off('SIGINT', close)
		process.off('SIGTERM', close)
	}
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const require = createRequire(import.meta.url),
		nuxt = join(dirname(require.resolve('nuxt/package.json')), 'bin/nuxt.mjs')
	const origin = process.env.NUXT_STUDIO_PRODUCT_ORIGIN || productOrigin()
	const mainPort = Number(new URL(origin).port || 80)
	const port = await availablePort(mainPort + 1)
	process.env.NUXT_STUDIO_PRODUCT_ORIGIN = origin
	process.env.CAMPUS_AGENT_PRODUCT_ORIGIN = origin
	console.log(`[dev] Studio http://127.0.0.1:${port} / Web ${origin}`)
	await superviseStudioProcesses(
		[join(projectRoot, 'apps/agents/worker.ts')],
		[
			nuxt,
			'dev',
			join(projectRoot, 'apps/studio'),
			'--host',
			'127.0.0.1',
			'--port',
			String(port),
			'--strictPort',
			'--no-takeover',
			'--no-tui',
		],
	)
}
