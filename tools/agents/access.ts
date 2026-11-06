import { readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { projectRoot } from './environment.ts'
interface ModelProvider {
	baseUrl?: string
	apiKey?: string
}
interface PiModels {
	providers?: Record<string, ModelProvider>
}
export interface AccessConfig {
	baseUrl: string
	apiKey: string
	directory?: string
	source: 'environment' | 'project' | 'explicit' | 'global'
}
function resolveValue(value: string) {
	if (value.startsWith('!')) throw new Error('AGENT_CONFIG_COMMAND_NOT_ALLOWED')
	const reference = value.match(
		/^\$\{([A-Z_][A-Z0-9_]*)\}$|^\$([A-Z_][A-Z0-9_]*)$/i,
	)
	return reference ? (process.env[reference[1] ?? reference[2]!] ?? '') : value
}
export async function readGlobalAccess(): Promise<AccessConfig> {
	const baseUrl = process.env.CAMPUS_AGENT_BASE_URL?.trim()
	const apiKey = process.env.CAMPUS_AGENT_API_KEY?.trim()
	if (baseUrl || apiKey) {
		if (!baseUrl || !apiKey)
			throw new Error('AGENT_ENV_REQUIRES_BASE_URL_AND_API_KEY')
		return validate({ baseUrl, apiKey, source: 'environment' })
	}
	let directory: string, source: AccessConfig['source']
	if (process.env.PI_CODING_AGENT_DIR) {
		directory = resolve(projectRoot, process.env.PI_CODING_AGENT_DIR)
		source = 'explicit'
	} else {
		directory = resolve(projectRoot, '.pi/agent')
		try {
			await access(resolve(directory, 'models.json'))
			source = 'project'
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
			directory = resolve(homedir(), '.pi/agent')
			source = 'global'
		}
	}
	let models: PiModels
	try {
		models = JSON.parse(
			await readFile(resolve(directory, 'models.json'), 'utf8'),
		) as PiModels
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			throw new Error('AGENT_MODEL_NOT_CONFIGURED: copy .env.example to .env', {
				cause: error,
			})
		throw new Error('AGENT_MODEL_CONFIG_INVALID', { cause: error })
	}
	const provider = models.providers?.['campus-hub']
	if (!provider?.baseUrl || !provider.apiKey)
		throw new Error('AGENT_PROVIDER_NOT_CONFIGURED')
	return validate({
		baseUrl: resolveValue(provider.baseUrl),
		apiKey: resolveValue(provider.apiKey),
		directory,
		source,
	})
}
function validate(config: AccessConfig) {
	let url: URL
	try {
		url = new URL(config.baseUrl)
	} catch {
		throw new Error('AGENT_BASE_URL_INVALID')
	}
	if (
		!['https:', 'http:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error('AGENT_BASE_URL_INVALID')
	if (!config.apiKey || config.apiKey.startsWith('!'))
		throw new Error('AGENT_API_KEY_MISSING')
	return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, '') }
}
