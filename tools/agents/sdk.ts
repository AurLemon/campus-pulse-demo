import { readFile, access, realpath } from 'node:fs/promises'
import { dirname, delimiter, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { projectRoot } from './environment.ts'
async function exists(path: string) {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}
export async function locateSdk(): Promise<{
	path: string
	source: 'explicit' | 'global' | 'local'
}> {
	if (process.env.CAMPUS_PI_SDK_ROOT) {
		const path = resolve(
			process.env.CAMPUS_PI_SDK_ROOT,
			'@earendil-works/pi-coding-agent/dist/core/model-runtime.js',
		)
		if (!(await exists(path))) throw new Error('AGENT_EXPLICIT_SDK_NOT_FOUND')
		return { path, source: 'explicit' }
	}
	for (const directory of (process.env.PATH ?? '').split(delimiter)) {
		if (resolve(directory).startsWith(resolve(projectRoot, 'node_modules')))
			continue
		try {
			const executable = resolve(
				directory,
				process.platform === 'win32' ? 'pi.cmd' : 'pi',
			)
			const actual = await realpath(executable)
			for (const relative of [
				'core/model-runtime.js',
				'../core/model-runtime.js',
			]) {
				const path = resolve(dirname(actual), relative)
				if (await exists(path)) return { path, source: 'global' }
			}
			const shim = await readFile(
				resolve(directory, process.platform === 'win32' ? 'pi.cmd' : 'pi'),
				'utf8',
			)
			const target = shim.match(/# cmd-shim-target=(.+)/)?.[1]?.trim()
			if (target) {
				const path = resolve(dirname(target), '../core/model-runtime.js')
				if (await exists(path)) return { path, source: 'global' }
			}
		} catch {
			/* Continue through supported install layouts. */
		}
	}
	try {
		const root = execFileSync('pnpm', ['root', '-g'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim()
		const path = resolve(
			root,
			'@earendil-works/pi-coding-agent/dist/core/model-runtime.js',
		)
		if (await exists(path)) return { path, source: 'global' }
	} catch {
		/* A missing global pnpm setup must not prevent local use. */
	}
	try {
		const path = resolve(
			dirname(
				fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')),
			),
			'core/model-runtime.js',
		)
		if (await exists(path)) return { path, source: 'local' }
	} catch {
		/* Report an actionable installation error below. */
	}
	throw new Error('AGENT_SDK_NOT_INSTALLED: run pnpm install')
}
