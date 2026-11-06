import { spawn } from 'node:child_process'
import { readGlobalAccess } from './access.ts'
import { locateSdk } from './sdk.ts'
import { supportedModel } from './environment.ts'

const proxy = process.env.CAMPUS_AGENT_PROXY_URL?.trim()
if (
	!process.env.CAMPUS_AGENT_PROXY_BOOTSTRAPPED &&
	(proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
) {
	const child = spawn(
		process.execPath,
		['--use-env-proxy', ...process.argv.slice(1)],
		{
			env: {
				...process.env,
				...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {}),
				NO_PROXY: [process.env.NO_PROXY, 'localhost', '127.0.0.1', '::1']
					.filter(Boolean)
					.join(','),
				CAMPUS_AGENT_PROXY_BOOTSTRAPPED: '1',
			},
			stdio: 'inherit',
		},
	)
	child.once('error', () => {
		process.exitCode = 1
	})
	const code = await new Promise<number | null>((done) => {
		child.once('close', done)
	})
	process.exit(code ?? 1)
}
// Catalogue access only: no model generation, worker, business write, or budget change.
let apiKey = ''
try {
	const config = await readGlobalAccess()
	apiKey = config.apiKey
	const sdk = await locateSdk()
	const model = process.env.CAMPUS_AGENT_MODEL || supportedModel
	const response = await fetch(`${config.baseUrl}/models`, {
		headers: { authorization: `Bearer ${apiKey}` },
		signal: AbortSignal.timeout(15000),
		redirect: 'error',
	})
	let modelListed: boolean | null = null
	if (response.ok) {
		const result = (await response.json()) as { data?: Array<{ id?: string }> }
		if (Array.isArray(result.data))
			modelListed = result.data.some((row) => row.id === model)
	}
	console.log(
		JSON.stringify(
			{
				configSource: config.source,
				sdkSource: sdk.source,
				model,
				pricingSupported: model === supportedModel,
				httpStatus: response.status,
				modelListed,
				proxyEnabled:
					process.execArgv.includes('--use-env-proxy') ||
					process.env.NODE_USE_ENV_PROXY === '1',
				ok: response.ok && model === supportedModel && modelListed !== false,
				note: 'Catalogue access only; this does not verify generation or provider balance',
			},
			null,
			'\t',
		),
	)
	if (!response.ok || model !== supportedModel || modelListed === false)
		process.exitCode = 1
} catch (error) {
	const failure =
		error instanceof Error ? error : new Error('AGENT_DIAGNOSIS_FAILED')
	const cause = failure.cause instanceof Error ? failure.cause : undefined
	const redact = (text: string) =>
		(apiKey ? text.replaceAll(apiKey, '[REDACTED]') : text).replace(
			/sk-[A-Za-z0-9_-]{12,}/g,
			'[REDACTED]',
		)
	console.log(
		JSON.stringify(
			{
				ok: false,
				error: redact(failure.message),
				cause: cause ? redact(cause.message) : undefined,
				code: (cause as (Error & { code?: string }) | undefined)?.code,
				note: 'No model generation requested',
			},
			null,
			'\t',
		),
	)
	process.exitCode = 1
}
