import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readGlobalAccess } from './access.ts'

interface ProbeResult {
	model: string
	protocol: string
	returnedModel?: string
	httpStatus?: number
	seconds: number
	ok: boolean
	reply?: string
	error?: string
	usage?: unknown
}

const run = process.argv.includes('--run')
const group = process.env.MODEL_PROBE_GROUP ?? 'current-key-group'
const directory = resolve('.data/agents')
const requestedLimit = Number(process.env.MODEL_PROBE_MAX_REQUESTS ?? 12)
if (!Number.isFinite(requestedLimit) || requestedLimit < 1)
	throw new Error('Invalid probe request limit')
const maxRequests = Math.min(40, Math.floor(requestedLimit))
const requested = process.env.MODEL_PROBE_MODELS?.split(',').filter(Boolean)
const standardModels = [
	'deepseek-v4.1-flash-1017',
	'deepseek-v4.1-flash',
	'deepseek-v4-pro-0813',
	'qwen3.8-flash',
	'glm-5.3-flash',
	'MiniMax-M2.7',
]
const allModels = [
	...standardModels,
	'kimi-k3',
	'glm-5.3',
	'glm-5.1',
	'glm-5.2',
	'kimi-k2.7-code',
	'MiniMax-M3',
	'minimax-m3',
	'MiniMax-M2.7-highspeed',
	'kimi-k2.8',
	'glm-5.3-flashx',
	'qwen3.8-max',
	'qwen3.7-max',
	'mimo-v2.6-pro',
	'mimo-v2.6-flash',
	'mimo-v2.5-pro',
	'mimo-v2.5',
	'hy4-preview',
	'hy3',
	'deepseek-v4-flash-0731',
]
const models =
	requested ?? (process.argv.includes('--all') ? allModels : standardModels)

const protocols = (process.env.MODEL_PROBE_PROTOCOLS ?? 'responses,chat').split(
	',',
)

if (!run) {
	console.log(
		JSON.stringify({
			dryRun: true,
			group,
			models,
			protocols,
			maxRequests,
			maxOutputTokens: 32,
		}),
	)
	process.exit(0)
}

const access = await readGlobalAccess()
if (!access.baseUrl.startsWith('https://') || !access.apiKey)
	throw new Error('Invalid model access configuration')
const headers = {
	Authorization: `Bearer ${access.apiKey}`,
	'Content-Type': 'application/json',
}
const results: ProbeResult[] = []
await mkdir(directory, { recursive: true, mode: 0o700 })

function safe(value: unknown): string {
	return String(value)
		.replaceAll(access.apiKey, '[REDACTED]')
		.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
		.slice(0, 300)
}

function readOutput(data: Record<string, unknown>): string {
	const choices = data.choices as
		Array<{ message?: { content?: string } }> | undefined
	if (typeof choices?.[0]?.message?.content === 'string')
		return choices[0].message.content
	if (typeof data.output_text === 'string') return data.output_text
	const output = data.output as
		Array<{ content?: Array<{ text?: string }> }> | undefined
	return (output ?? [])
		.flatMap((item) => item.content ?? [])
		.map((item) => item.text ?? '')
		.join('')
}

for (const model of models) {
	for (const protocol of protocols) {
		if (results.length >= maxRequests) break
		const start = performance.now()
		const result: ProbeResult = { model, protocol, seconds: 0, ok: false }
		try {
			const responses = protocol === 'responses'
			const body = responses
				? {
						model,
						input: 'Reply with exactly OK.',
						max_output_tokens: 32,
						stream: false,
						store: false,
					}
				: {
						model,
						messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
						max_tokens: 32,
						stream: false,
						thinking: { type: 'disabled' },
					}
			const response = await fetch(
				`${access.baseUrl.replace(/\/$/, '')}/${responses ? 'responses' : 'chat/completions'}`,
				{
					method: 'POST',
					headers,
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(20000),
				},
			)
			result.httpStatus = response.status
			const raw = await response.text()
			let data: Record<string, unknown>
			try {
				data = JSON.parse(raw)
			} catch {
				const events = raw
					.split('\n')
					.filter((line) => line.startsWith('data: '))
					.map((line) => {
						try {
							return JSON.parse(line.slice(6)) as Record<string, unknown>
						} catch {
							return {}
						}
					})
				data = (events.findLast((event) => event.response)?.response ??
					{}) as Record<string, unknown>
				if (!Object.keys(data).length)
					throw new Error(
						`Non-JSON response (${response.status}); body omitted`,
					)
			}
			if (response.ok) {
				result.returnedModel =
					typeof data.model === 'string' ? data.model : undefined
				result.reply = safe(readOutput(data).trim())
				result.ok = result.reply === 'OK'
				result.usage = data.usage
				if (!result.ok)
					result.error =
						'Response received but expected OK text was not returned'
			} else {
				const error = data.error as { message?: string } | undefined
				result.error = safe(error?.message ?? `HTTP ${response.status}`)
			}
		} catch (error) {
			result.error = safe(
				error instanceof Error
					? `${error.name}: ${error.message}; ${error.cause instanceof Error ? error.cause.message : ''}`
					: error,
			)
		}
		result.seconds = Math.round((performance.now() - start) / 10) / 100
		results.push(result)
		console.log(JSON.stringify(result))
		await writeFile(
			resolve(directory, `probe-${group.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`),
			JSON.stringify(
				{ group, createdAt: new Date().toISOString(), results },
				null,
				'\t',
			),
			{ mode: 0o600 },
		)
		if (result.httpStatus === 401 || result.httpStatus === 402) process.exit(2)
	}
	if (results.length >= maxRequests) break
}
if (!results.some((result) => result.ok)) process.exitCode = 1
