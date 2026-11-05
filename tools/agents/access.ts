import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

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
}
export async function readGlobalAccess(): Promise<AccessConfig> {
	const directory =
		process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), '.pi/agent')
	const models = JSON.parse(
		await readFile(resolve(directory, 'models.json'), 'utf8'),
	) as PiModels
	const provider = models.providers?.['campus-hub']
	if (!provider?.baseUrl || !provider.apiKey)
		throw new Error('GLOBAL_PI_PROVIDER_NOT_CONFIGURED')
	const key = provider.apiKey
	const environment = key.match(
		/^\$\{([A-Z_][A-Z0-9_]*)\}$|^\$([A-Z_][A-Z0-9_]*)$/i,
	)
	const apiKey = environment
		? process.env[environment[1] ?? environment[2]!]
		: key
	if (!apiKey || key.startsWith('!'))
		throw new Error('GLOBAL_PI_KEY_MUST_BE_LITERAL_OR_ENVIRONMENT_REFERENCE')
	return { baseUrl: provider.baseUrl, apiKey }
}
