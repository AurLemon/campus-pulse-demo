import { loadEnvFile } from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export const projectRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..',
)
// Existing process variables take precedence; never edit the user's shell.
try {
	loadEnvFile(resolve(projectRoot, '.env'))
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
export const supportedModel = 'deepseek-v4.1-flash-1017'
