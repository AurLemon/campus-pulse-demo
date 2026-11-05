import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { resolve, dirname, delimiter } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readGlobalAccess } from './access.ts'

interface PiUsage {
	input?: number
	output?: number
	cacheRead?: number
	cost?: { total?: number }
}
interface PiMessage {
	content?: Array<{ type: string; text?: string; thinking?: string }>
	stopReason?: string
	errorMessage?: string
	usage?: PiUsage
}
interface PiEvent {
	type: string
	delta?: string
	message?: PiMessage
	error?: PiMessage
}
interface Runtime {
	getModel(provider: string, id: string): Record<string, unknown> | undefined
	streamSimple(
		model: Record<string, unknown>,
		context: Record<string, unknown>,
		options: Record<string, unknown>,
	): AsyncIterable<PiEvent>
}
interface PiSdk {
	ModelRuntime: { create(options: Record<string, unknown>): Promise<Runtime> }
}
// Native Node fetch ignores HTTP(S)_PROXY unless enabled at process startup.
// Re-exec this bounded tool only; no shell, provider, or system proxy configuration changes.
if (
	!process.env.CAMPUS_AGENT_PROXY_BOOTSTRAPPED &&
	(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
) {
	const child = spawn(
		process.execPath,
		['--use-env-proxy', ...process.argv.slice(1)],
		{
			env: { ...process.env, CAMPUS_AGENT_PROXY_BOOTSTRAPPED: '1' },
			stdio: 'inherit',
		},
	)
	const code = await new Promise<number | null>((done, reject) => {
		child.once('close', done)
		child.once('error', reject)
	})
	process.exit(code ?? 1)
}

const promptFile = process.argv[2]
if (!promptFile || !process.argv.includes('--run')) {
	console.log('Usage: pnpm agent:run <prompt-file> --run')
	process.exit(promptFile ? 0 : 1)
}
if (process.argv.includes('--read-only'))
	throw new Error(
		'SDK_CONTENT_RUNNER_IS_TOOL_FREE: use explicit reviewed input instead of file access',
	)
const access = await readGlobalAccess()
const model = process.env.CAMPUS_AGENT_MODEL ?? 'deepseek-v4.1-flash-1017'
const job = resolve(
	process.env.CAMPUS_AGENT_CWD ??
		`.data/agents/jobs/${Date.now()}-${process.pid}`,
)
await mkdir(job, { recursive: true, mode: 0o700 })
const prompt = await readFile(resolve(promptFile), 'utf8')
const sanitize = (s: string) =>
	s
		.replaceAll(access.apiKey, '[REDACTED]')
		.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
async function locateSdk() {
	if (process.env.CAMPUS_PI_SDK_ROOT)
		return resolve(
			process.env.CAMPUS_PI_SDK_ROOT,
			'@earendil-works/pi-coding-agent/dist/core/model-runtime.js',
		)
	for (const directory of (process.env.PATH ?? '').split(delimiter)) {
		try {
			const shim = await readFile(
				resolve(directory, process.platform === 'win32' ? 'pi.cmd' : 'pi'),
				'utf8',
			)
			const target = shim.match(/# cmd-shim-target=(.+)/)?.[1]?.trim()
			if (target) return resolve(dirname(target), '../core/model-runtime.js')
		} catch {
			// A PATH entry may not contain the global Pi shim.
		}
	}
	const globalModules = execFileSync('pnpm', ['root', '-g'], {
		encoding: 'utf8',
	}).trim()
	return resolve(
		globalModules,
		'@earendil-works/pi-coding-agent/dist/core/model-runtime.js',
	)
}
const sdkPath = await locateSdk()
const sdk = (await import(pathToFileURL(sdkPath).href)) as PiSdk
const agentDir =
	process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), '.pi/agent')
const maxTokens = Math.min(
	32768,
	Math.max(1024, Number(process.env.CAMPUS_AGENT_MAX_TOKENS) || 16384),
)
const timeoutMs = Math.min(
	300000,
	Math.max(10000, Number(process.env.CAMPUS_AGENT_TIMEOUT_MS) || 180000),
)
const controller = new AbortController()
const timer = setTimeout(
	() => controller.abort(new Error('TASK_TIMEOUT')),
	timeoutMs,
)
let final: PiMessage | undefined,
	error: string | undefined,
	settled = false,
	eventBytes = 0
await writeFile(resolve(job, 'events.jsonl'), ' ', { mode: 0o600 })
await writeFile(resolve(job, 'stderr.log'), '', { mode: 0o600 })
const metadata: {
	sdk: string
	maxTokens: number
	timeoutMs: number
	processProxyEnabled?: boolean
	configuredMaxTokens?: unknown
	responseStatus?: number
	payloadMaxTokens?: unknown
	wire?: Record<string, unknown>
} = {
	sdk: 'global-pi-model-runtime',
	maxTokens,
	timeoutMs,
	processProxyEnabled:
		process.execArgv.includes('--use-env-proxy') ||
		process.env.NODE_USE_ENV_PROXY === '1',
}
try {
	const runtime = await sdk.ModelRuntime.create({
		modelsPath: resolve(agentDir, 'models.json'),
		authPath: resolve(agentDir, 'auth.json'),
		allowModelNetwork: false,
		refreshOnCreate: false,
	})
	const configured = runtime.getModel('campus-hub', model)
	if (!configured) throw new Error('GLOBAL_PI_MODEL_NOT_CONFIGURED')
	metadata.configuredMaxTokens = configured.maxTokens
	// Clone only for this request. Never mutate the global provider or models.json.
	const api = process.env.CAMPUS_AGENT_API ?? 'openai-completions'
	if (!['openai-completions', 'openai-responses'].includes(api))
		throw new Error('UNSUPPORTED_TASK_API')
	const taskModel = { ...configured, maxTokens, api, reasoning: false }
	const stream = runtime.streamSimple(
		taskModel,
		{
			systemPrompt:
				'Complete only the supplied bounded writing task. Return the requested JSON and stop. No tools or external context are available.',
			messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
			tools: [],
		},
		{
			maxTokens,
			reasoning: 'off',
			maxRetries: 0,
			timeoutMs,
			signal: controller.signal,
			fetch: async (
				input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				if (typeof init?.body === 'string') {
					try {
						const payload = JSON.parse(init.body) as Record<string, unknown>
						metadata.wire = Object.fromEntries(
							[
								'model',
								'max_tokens',
								'max_completion_tokens',
								'max_output_tokens',
								'thinking',
								'reasoning',
								'reasoning_effort',
								'response_format',
								'text',
								'stream',
							]
								.filter((key) => key in payload)
								.map((key) => [key, payload[key]]),
						)
						await writeFile(
							resolve(job, 'request-meta.json'),
							JSON.stringify(metadata, null, '\t'),
							{ mode: 0o600 },
						)
					} catch {
						/* Metadata is optional and never includes credentials or messages. */
					}
				}
				return fetch(input, init)
			},
			onPayload: (payload: unknown) => {
				const value = payload as Record<string, unknown>
				metadata.payloadMaxTokens =
					value.max_tokens ??
					value.max_completion_tokens ??
					value.max_output_tokens
				if (api === 'openai-responses') {
					value.reasoning = { effort: 'none' }
					value.text = { format: { type: 'json_object' } }
					delete value.thinking
					delete value.response_format
				} else {
					value.thinking = { type: 'disabled' }
					delete value.reasoning_effort
					value.response_format = { type: 'json_object' }
				}
				return value
			},
			onResponse: (response: { status: number }) => {
				metadata.responseStatus = response.status
			},
		},
	)
	for await (const event of stream) {
		const saved = {
			type: event.type,
			...(event.delta !== undefined ? { delta: event.delta } : {}),
			...(event.message ? { message: event.message } : {}),
			...(event.error ? { error: event.error } : {}),
		}
		const line = sanitize(JSON.stringify(saved)) + '\n'
		eventBytes += line.length
		if (eventBytes > 4000000) {
			controller.abort()
			throw new Error('OUTPUT_LIMIT')
		}
		await appendFile(resolve(job, 'events.jsonl'), line, { mode: 0o600 })
		if (event.type === 'done') {
			final = event.message
			settled = true
		}
		if (event.type === 'error') {
			final = event.error
			error = event.error?.errorMessage ?? 'PROVIDER_ERROR'
			settled = true
		}
	}
} catch (e) {
	error = sanitize(e instanceof Error ? e.message : String(e))
} finally {
	clearTimeout(timer)
}
const usage = {
	input: final?.usage?.input ?? 0,
	output: final?.usage?.output ?? 0,
	cacheRead: final?.usage?.cacheRead ?? 0,
	estimatedCostUsd: final?.usage?.cost?.total ?? 0,
}
const text = sanitize(
	(final?.content ?? [])
		.filter((c) => c.type === 'text')
		.map((c) => c.text ?? '')
		.join(''),
)
const usageComplete =
	!!final?.usage &&
	[final.usage.input, final.usage.output].every(
		(value) =>
			typeof value === 'number' && Number.isFinite(value) && value >= 0,
	) &&
	[usage.input, usage.output, usage.cacheRead].every(
		(n) => Number.isFinite(n) && n >= 0,
	) &&
	usage.input + usage.output > 0
const success =
	settled && usageComplete && !error && final?.stopReason === 'stop' && !!text
const resultFile = resolve(job, 'result.json')
await writeFile(
	resolve(job, 'request-meta.json'),
	JSON.stringify(metadata, null, '\t'),
	{ mode: 0o600 },
)
await writeFile(resolve(job, 'stderr.log'), error ?? '', { mode: 0o600 })
await writeFile(
	resultFile,
	JSON.stringify(
		{
			model,
			success,
			exitCode: success ? 0 : 1,
			terminationReason: controller.signal.aborted ? 'timeout' : undefined,
			toolCalls: 0,
			text,
			usage,
			pricingKnown: model === 'deepseek-v4.1-flash-1017',
			stopReason: final?.stopReason,
			error,
			usageComplete,
			metadata,
		},
		null,
		'\t',
	),
	{ mode: 0o600 },
)
console.log(
	JSON.stringify({
		model,
		success,
		stopReason: final?.stopReason,
		usageComplete,
		resultFile,
		usage,
		error,
	}),
)
process.exitCode = success ? 0 : 1
