import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readGlobalAccess } from './access.ts'
import { locateSdk } from './sdk.ts'
import { supportedModel } from './environment.ts'

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
	registerProvider(provider: string, config: Record<string, unknown>): void
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
const explicitProxy = process.env.CAMPUS_AGENT_PROXY_URL?.trim()
if (
	!process.env.CAMPUS_AGENT_PROXY_BOOTSTRAPPED &&
	(explicitProxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
) {
	const child = spawn(
		process.execPath,
		['--use-env-proxy', ...process.argv.slice(1)],
		{
			env: {
				...process.env,
				...(explicitProxy
					? { HTTPS_PROXY: explicitProxy, HTTP_PROXY: explicitProxy }
					: {}),
				NO_PROXY: [process.env.NO_PROXY, 'localhost', '127.0.0.1', '::1']
					.filter(Boolean)
					.join(','),
				CAMPUS_AGENT_PROXY_BOOTSTRAPPED: '1',
			},
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
const systemPrompt = process.env.CAMPUS_AGENT_SYSTEM_PROMPT_FILE
	? await readFile(resolve(process.env.CAMPUS_AGENT_SYSTEM_PROMPT_FILE), 'utf8')
	: 'Complete only the supplied bounded writing task. Return the requested JSON and stop. No tools or external context are available.'
const access = await readGlobalAccess()
const model = process.env.CAMPUS_AGENT_MODEL || supportedModel
if (model !== supportedModel)
	throw new Error('AGENT_MODEL_PRICING_NOT_CONFIGURED')
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
const sdkLocation = await locateSdk()
const sdk = (await import(pathToFileURL(sdkLocation.path).href)) as PiSdk
const maxTokens = Math.min(
	32768,
	Math.max(128, Number(process.env.CAMPUS_AGENT_MAX_TOKENS) || 16384),
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
	sdkSource?: string
	configSource?: string
	transportError?: string
	payloadMaxTokens?: unknown
	wire?: Record<string, unknown>
	messageRoles?: unknown[]
	hasInstructions?: boolean
} = {
	sdk: 'pi-model-runtime',
	sdkSource: sdkLocation.source,
	configSource: access.source,
	maxTokens,
	timeoutMs,
	processProxyEnabled:
		process.execArgv.includes('--use-env-proxy') ||
		process.env.NODE_USE_ENV_PROXY === '1',
}
try {
	const runtime = await sdk.ModelRuntime.create({
		modelsPath: access.directory
			? resolve(access.directory, 'models.json')
			: null,
		authPath: resolve(job, 'auth.json'),
		allowModelNetwork: false,
		refreshOnCreate: false,
	})
	const api = process.env.CAMPUS_AGENT_API || 'openai-completions'
	if (!['openai-completions', 'openai-responses'].includes(api))
		throw new Error('UNSUPPORTED_TASK_API')
	if (access.source === 'environment')
		runtime.registerProvider('campus-hub', {
			baseUrl: access.baseUrl,
			api,
			apiKey: access.apiKey,
			models: [
				{
					id: model,
					name: model,
					reasoning: false,
					input: ['text'],
					cost: {
						input: 0.12,
						output: 0.48,
						cacheRead: 0.12,
						cacheWrite: 0.12,
					},
					contextWindow: 131072,
					maxTokens,
				},
			],
		})
	const configured = runtime.getModel('campus-hub', model)
	if (!configured) throw new Error('GLOBAL_PI_MODEL_NOT_CONFIGURED')
	metadata.configuredMaxTokens = configured.maxTokens
	// Clone only for this request. Never mutate the global provider or models.json.
	const taskModel = { ...configured, maxTokens, api, reasoning: false }
	const stream = runtime.streamSimple(
		taskModel,
		{
			systemPrompt,
			messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
			tools: [],
		},
		{
			maxTokens,
			apiKey: access.apiKey,
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
						metadata.messageRoles = (
							Array.isArray(payload.messages)
								? payload.messages
								: Array.isArray(payload.input)
									? payload.input
									: []
						).map((message: Record<string, unknown>) => message.role)
						metadata.hasInstructions =
							typeof payload.instructions === 'string' &&
							payload.instructions.length > 0
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
				try {
					const response = await fetch(input, init)
					metadata.responseStatus = response.status
					return response
				} catch (failure) {
					const details: string[] = []
					let cause: unknown = failure
					for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
						const value = cause as Error & { code?: string }
						details.push(
							[value.name, value.code, value.message]
								.filter(Boolean)
								.join(': '),
						)
						cause = value.cause
					}
					metadata.transportError = sanitize(details.join(' / ')).slice(0, 500)
					throw failure
				}
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
if (error && metadata.transportError)
	error = sanitize(`${error} (${metadata.transportError})`)
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
