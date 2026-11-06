/** Offline image batches. Shared image accounting only, never the text budget or business DB. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import lockfile from 'proper-lockfile'
import sharp, { type OverlayOptions } from 'sharp'

type Provider = 'junlin' | 'volcengine'
interface BatchScene {
	id: string
	subject: string
	topics: string[]
	provider: Provider
	facts?: string[]
	visibleObjects?: string[]
	kind?: 'photo' | 'sticker'
	aspect?: 'square' | 'portrait' | 'landscape'
	prompt?: string
	postId?: string
}
interface BatchEntry {
	id: string
	sceneId: string
	provider: Provider
	status: 'reserved' | 'generated' | 'failed'
	reservedUsd: number
	at: string
	requestId?: string
	error?: string
	usage?: unknown
	batchDigest?: string
	advertisedPrice?: { currency: 'USD' | 'CNY'; perImage: number }
	accounting?: string
}
interface ImageLedger {
	version: number
	limits: Record<Provider, number>
	entries: BatchEntry[]
	unlimitedProviders?: Partial<Record<Provider, boolean>>
	authorizationAudit?: Array<{
		at: string
		providers: Provider[]
		scope: string
		reason: string
	}>
	stoppedProviders?: Partial<Record<Provider, string>>
	consecutiveChannelFailures?: Partial<Record<Provider, number>>
}
interface BatchFact {
	id: string
	postId?: string
	provider: Provider
	model: string
	kind: string
	file: string
	mediaPath: string
	stagedPath: string
	originalPath: string
	originalWidth?: number
	originalHeight?: number
	originalSha256?: string
	originalFormat?: string
	delivery?: { maxDimension: number; quality: number; resize: string }
	url: string
	sha256: string
	width: number
	height: number
	topics: string[]
	plannedFacts: string[]
	verifiedFacts: string[]
	review: { status: 'pending' }
	prompt: string
	aspect: string
	aspectMatches: boolean
	entryId: string
}
interface BatchOptions {
	planPath?: string
	limit: number
	concurrency: number
	authorizeUnlimited: boolean
}
const providers: Provider[] = ['junlin', 'volcengine']
const directory = resolve('.data/image-generation')
const ledgerPath = join(directory, 'natural-image-ledger.json')
const digest = (bytes: Buffer | string) =>
	createHash('sha256').update(bytes).digest('hex')
async function atomicJson(path: string, value: unknown) {
	const temporary = `${path}.${randomUUID()}.tmp`
	await writeFile(temporary, JSON.stringify(value, null, '\t') + '\n', {
		mode: 0o600,
	})
	await rename(temporary, path)
}
async function writeContact(path: string, page: BatchFact[]) {
	const layers: OverlayOptions[] = []
	for (const [index, fact] of page.entries()) {
		layers.push({
			input: await sharp(fact.stagedPath)
				.resize(240, 240, { fit: 'contain', background: 'white' })
				.png()
				.toBuffer(),
			left: (index % 5) * 240,
			top: Math.floor(index / 5) * 270,
		})
		layers.push({
			input: Buffer.from(
				`<svg width="240" height="30"><text x="6" y="18" font-size="10">${fact.id} / ${fact.provider}</text></svg>`,
			),
			left: (index % 5) * 240,
			top: Math.floor(index / 5) * 270 + 240,
		})
	}
	await sharp({
		create: {
			width: 1200,
			height: Math.ceil(page.length / 5) * 270,
			channels: 3,
			background: 'white',
		},
	})
		.composite(layers)
		.png()
		.toFile(path)
}
async function withLedger<T>(task: (ledger: ImageLedger) => T): Promise<T> {
	const release = await lockfile.lock(ledgerPath, {
		retries: { retries: 80, minTimeout: 100, maxTimeout: 400 },
		stale: 30000,
	})
	try {
		const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as ImageLedger
		const result = task(ledger)
		await atomicJson(ledgerPath, ledger)
		return result
	} finally {
		await release()
	}
}
function sceneIsValid(value: unknown): value is BatchScene {
	if (!value || typeof value !== 'object') return false
	const scene = value as Partial<BatchScene>
	return (
		typeof scene.id === 'string' &&
		/^content-v3-[a-zA-Z0-9_-]+$/.test(scene.id) &&
		typeof scene.subject === 'string' &&
		scene.subject.length > 0 &&
		Array.isArray(scene.topics) &&
		scene.topics.every((x) => typeof x === 'string') &&
		providers.includes(scene.provider as Provider) &&
		(!scene.aspect ||
			['square', 'portrait', 'landscape'].includes(scene.aspect))
	)
}
const style =
	'校园生活社区的合成场景图，不冒充真实校园实拍。普通学生随手拿手机抓拍，生活中已经被使用过的物件与环境，允许画面略歪、边缘局部裁切、轻微噪点和自然手抖，普通顶灯或窗光，主体自然杂乱，不要精致摆拍、产品摄影、广告大片、夸张景深或过饱和滤镜。无海报、拼图、水印、品牌、可读文字、校园地标或终端代码界面。'
export async function runImageBatch(options: BatchOptions) {
	if (
		!Number.isInteger(options.limit) ||
		options.limit < 0 ||
		!Number.isInteger(options.concurrency) ||
		options.concurrency < 1 ||
		options.concurrency > 4
	)
		throw Error('INVALID_BATCH_BOUNDS')
	if (options.authorizeUnlimited) {
		await withLedger((ledger) => {
			ledger.unlimitedProviders = {
				...ledger.unlimitedProviders,
				junlin: true,
				volcengine: true,
			}
			ledger.authorizationAudit ??= []
			ledger.authorizationAudit.push({
				at: new Date().toISOString(),
				providers,
				scope:
					'Image generation only; original limits, entries and unknown-usage reservations retained; text/DS budget unchanged',
				reason:
					'User explicitly removed image limits: 无所谓图片！大胆用，我现在去掉限额',
			})
		})
		console.log(
			JSON.stringify({
				status: 'image-unlimited-authorized',
				providers,
				historicalReservationsRetained: true,
				textBudgetUnchanged: true,
			}),
		)
	}
	if (!options.planPath) return
	const planBytes = await readFile(resolve(options.planPath))
	const plan: unknown = JSON.parse(planBytes.toString('utf8'))
	const scenes: unknown = Array.isArray(plan)
		? plan
		: (plan as { scenes?: unknown })?.scenes
	if (
		!Array.isArray(scenes) ||
		!scenes.every(sceneIsValid) ||
		new Set(scenes.map((x) => x.id)).size !== scenes.length
	)
		throw Error('INVALID_BATCH_PLAN')
	const postIds = scenes
		.map((scene) => scene.postId)
		.filter((id): id is string => Boolean(id))
	if (new Set(postIds).size !== postIds.length)
		throw Error('DUPLICATE_BATCH_POST')
	const batchDigest = digest(planBytes)
	const output = join(directory, 'batches', batchDigest.slice(0, 16))
	await mkdir(output, { recursive: true, mode: 0o700 })
	const releaseRun = await lockfile.lock(join(output, 'run'), {
		realpath: false,
		stale: 30000,
		retries: 0,
	})
	try {
		await atomicJson(join(output, 'plan.json'), plan)
		await mkdir(join(output, 'facts'), { recursive: true })
		await mkdir(join(output, 'images'), { recursive: true })
		await mkdir(join(output, 'originals'), { recursive: true })
		const secretPath = resolve('.data/secrets/image-providers.json')
		if ((await stat(secretPath)).mode & 0o077)
			throw Error('IMAGE_SECRET_PERMISSIONS_REQUIRE_0600')
		const credentials = JSON.parse(
			await readFile(secretPath, 'utf8'),
		) as Record<Provider, { baseUrl: string; apiKey: string }>
		if (credentials.junlin.baseUrl !== 'https://canvas.api-hub.asia/v1')
			throw Error('IMAGE_PRICE_CHANNEL_MISMATCH')
		const response = await fetch('https://api-hub.asia/api/v1/model-plaza', {
			signal: AbortSignal.timeout(30000),
		})
		if (!response.ok) throw Error('IMAGE_PRICE_UNAVAILABLE')
		const data = (await response.json()) as {
			data: {
				groups: {
					id: number
					name: string
					models: {
						name: string
						pricing: {
							per_request_price: number
							intervals?: { per_request_price: number | null }[]
						}
					}[]
				}[]
			}
		}
		const quotes = data.data.groups.flatMap((group) =>
			group.models
				.filter((model) => model.name === 'gpt-image-2.5')
				.map((model) => ({ groupId: group.id, name: group.name, model })),
		)
		const prices = quotes.flatMap((x) => [
			x.model.pricing.per_request_price,
			...(x.model.pricing.intervals ?? [])
				.map((t) => t.per_request_price)
				.filter((x): x is number => x !== null),
		])
		if (!prices.length || prices.some((x) => !Number.isFinite(x) || x <= 0))
			throw Error('IMAGE_PRICE_UNVERIFIED')
		const gptReserve = Math.max(...prices)
		await atomicJson(join(output, 'price-evidence.json'), {
			at: new Date().toISOString(),
			source: 'https://api-hub.asia/api/v1/model-plaza',
			exactModel: 'gpt-image-2.5',
			quotes,
			gptReserveUsd: gptReserve,
			volcengine: {
				advertisedCurrency: 'CNY',
				advertisedPerImage: 0.12,
				conservativeReserveUsd: 0.12,
				accounting:
					'Conservative USD reservation, not a currency conversion or provider debit',
			},
		})
		const facts: BatchFact[] = []
		for (const scene of scenes) {
			try {
				const fact = JSON.parse(
					await readFile(join(output, 'facts', `${scene.id}.json`), 'utf8'),
				) as BatchFact
				const bytes = await readFile(fact.stagedPath)
				if (digest(bytes) !== fact.sha256)
					throw Error('BATCH_IMAGE_DIGEST_MISMATCH')
				await sharp(bytes).stats()
				facts.push(fact)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
			}
		}
		let progressQueue = Promise.resolve()
		function enqueueProgress() {
			if (facts.length % 20) return
			const snapshot = [...facts]
			progressQueue = progressQueue
				.then(async () => {
					await atomicJson(join(output, 'facts-progress.json'), snapshot)
					await writeContact(
						join(
							output,
							`progress-contact-${String(snapshot.length / 20).padStart(3, '0')}.png`,
						),
						snapshot.slice(-20),
					)
					console.log(
						JSON.stringify({
							status: 'batch-progress',
							completed: snapshot.length,
							output,
						}),
					)
				})
				.catch((error) => {
					console.log(
						JSON.stringify({
							status: 'progress-contact-failed',
							completed: snapshot.length,
							error:
								error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
									? error.message
									: 'CONTACT_WRITE_FAILED',
						}),
					)
				})
		}
		const completed = new Set(facts.map((x) => x.id))
		let cursor = 0
		const queue = scenes.slice(0, options.limit)
		const failures: { id: string; reason: string }[] = []
		async function requestImage(
			scene: BatchScene,
			provider: Provider,
		): Promise<boolean> {
			const entry: BatchEntry = {
				id: randomUUID(),
				sceneId: scene.id,
				provider,
				status: 'reserved',
				reservedUsd: provider === 'junlin' ? gptReserve : 0.12,
				at: new Date().toISOString(),
				batchDigest,
				advertisedPrice: {
					currency: provider === 'junlin' ? 'USD' : 'CNY',
					perImage: provider === 'junlin' ? gptReserve : 0.12,
				},
				accounting:
					provider === 'junlin'
						? 'Highest current exact-model advertised per-request price'
						: 'Conservative USD reservation; advertised CNY0.12 retained separately; not FX conversion',
			}
			await withLedger((ledger) => {
				if (ledger.stoppedProviders?.[provider]) throw Error('CHANNEL_PAUSED')
				const previous = ledger.entries.filter((x) => x.sceneId === scene.id)
				if (
					previous.length >= 2 ||
					previous.some((x) => x.status !== 'failed') ||
					previous.some((x) => x.provider === provider)
				)
					throw Error('SCENE_CHECKPOINT_BLOCKED')
				const consumed = ledger.entries
					.filter((x) => x.provider === provider)
					.reduce((n, x) => n + x.reservedUsd, 0)
				if (
					!ledger.unlimitedProviders?.[provider] &&
					consumed + entry.reservedUsd > ledger.limits[provider] + 1e-9
				)
					throw Error('IMAGE_BUDGET_EXHAUSTED')
				ledger.entries.push(entry)
			})
			const model =
				provider === 'junlin'
					? 'gpt-image-2.5'
					: 'doubao-seedream-5-0-flash-260915'
			const aspect = scene.aspect ?? 'square'
			const prompt =
				(scene.prompt || scene.subject) +
				'\n' +
				style +
				(aspect === 'portrait'
					? '竖向构图'
					: aspect === 'landscape'
						? '横向构图'
						: '方形构图')
			const credential = credentials[provider]
			let originalSaved = false
			try {
				const sizes =
					provider === 'junlin'
						? {
								square: '1024x1024',
								portrait: '1024x1536',
								landscape: '1536x1024',
							}
						: { square: '2K', portrait: '1728x2304', landscape: '2304x1728' }
				const request = await fetch(
					credential.baseUrl + '/images/generations',
					{
						method: 'POST',
						headers: {
							authorization: `Bearer ${credential.apiKey}`,
							'content-type': 'application/json',
						},
						body: JSON.stringify(
							provider === 'junlin'
								? { model, prompt, n: 1, size: sizes[aspect], quality: 'low' }
								: {
										model,
										prompt,
										size: sizes[aspect],
										response_format: 'url',
										watermark: false,
									},
						),
						signal: AbortSignal.timeout(240000),
					},
				)
				entry.requestId =
					request.headers.get('x-request-id') ??
					request.headers.get('x-tt-logid') ??
					undefined
				if (!request.ok) {
					const detail = (await request.text())
						.replaceAll(credential.apiKey, '[REDACTED]')
						.slice(0, 4000)
					await atomicJson(join(output, `error-${entry.id}.json`), {
						status: request.status,
						detail,
					})
					throw Error(`HTTP_${request.status}`)
				}
				const body = (await request.json()) as {
					data?: { b64_json?: string; url?: string }[]
					usage?: unknown
					error?: { code?: string }
				}
				entry.usage = body.usage
				if (body.error) throw Error('PROVIDER_ERROR')
				const image = body.data?.[0]
				let bytes: Buffer
				if (image?.b64_json) bytes = Buffer.from(image.b64_json, 'base64')
				else if (image?.url) {
					const url = new URL(image.url)
					if (url.protocol !== 'https:') throw Error('INVALID_IMAGE_URL')
					const downloaded = await fetch(url, {
						signal: AbortSignal.timeout(60000),
					})
					if (!downloaded.ok) throw Error(`DOWNLOAD_${downloaded.status}`)
					bytes = Buffer.from(await downloaded.arrayBuffer())
				} else throw Error('MISSING_IMAGE')
				const metadata = await sharp(bytes, {
					limitInputPixels: 40000000,
					failOn: 'warning',
				}).metadata()
				if (
					!metadata.width ||
					!metadata.height ||
					metadata.width < 512 ||
					metadata.height < 512
				)
					throw Error('INVALID_IMAGE')
				const originalPath = join(
					output,
					'originals',
					`${scene.id}.${metadata.format === 'jpeg' ? 'jpg' : metadata.format}`,
				)
				await writeFile(originalPath, bytes, { flag: 'wx' })
				originalSaved = true
				const derivative = await sharp(bytes)
					.resize({
						width: 1280,
						height: 1280,
						fit: 'inside',
						withoutEnlargement: true,
					})
					.webp({ quality: 80 })
					.toBuffer({ resolveWithObject: true })
				const webp = derivative.data
				const stagedPath = join(output, 'images', `${scene.id}.webp`)
				await writeFile(stagedPath, webp, { flag: 'wx' })
				const fact: BatchFact = {
					id: scene.id,
					postId: scene.postId,
					provider,
					model,
					kind: scene.kind ?? 'photo',
					file: `${scene.id}.webp`,
					mediaPath: stagedPath,
					stagedPath,
					originalPath,
					originalWidth: metadata.width,
					originalHeight: metadata.height,
					originalSha256: digest(bytes),
					originalFormat: metadata.format,
					delivery: {
						maxDimension: 1280,
						quality: 80,
						resize: 'inside-without-enlargement',
					},
					url: `/media/${scene.id}.webp`,
					sha256: digest(webp),
					width: derivative.info.width,
					height: derivative.info.height,
					topics: scene.topics,
					plannedFacts: scene.facts ?? scene.visibleObjects ?? [],
					verifiedFacts: [],
					review: { status: 'pending' },
					prompt,
					aspect,
					aspectMatches:
						(aspect === 'square'
							? metadata.width === metadata.height
							: aspect === 'portrait'
								? metadata.width < metadata.height
								: metadata.width > metadata.height) &&
						Math.abs(
							derivative.info.width * metadata.height -
								derivative.info.height * metadata.width,
						) <= Math.max(metadata.width, metadata.height),
					entryId: entry.id,
				}
				await atomicJson(join(output, 'facts', `${scene.id}.json`), fact)
				facts.push(fact)
				enqueueProgress()
				completed.add(scene.id)
				await withLedger((ledger) => {
					Object.assign(
						ledger.entries.find((x) => x.id === entry.id)!,
						{
							status: 'generated',
							requestId: entry.requestId,
							usage: entry.usage,
						},
					)
					ledger.consecutiveChannelFailures ??= {}
					ledger.consecutiveChannelFailures[provider] = 0
				})
				console.log(
					JSON.stringify({
						scene: scene.id,
						provider,
						status: 'generated',
						width: fact.width,
						height: fact.height,
						completed: facts.length,
					}),
				)
				return true
			} catch (error) {
				const message = error instanceof Error ? error.message : 'UNKNOWN'
				const code = /^[A-Z_0-9]+$/.test(message)
					? message
					: 'REQUEST_OR_STORAGE_FAILED'
				await withLedger((ledger) => {
					Object.assign(
						ledger.entries.find((x) => x.id === entry.id)!,
						{
							status: 'failed',
							error: code,
							requestId: entry.requestId,
							usage: entry.usage,
						},
					)
					ledger.consecutiveChannelFailures ??= {}
					ledger.consecutiveChannelFailures[provider] =
						(ledger.consecutiveChannelFailures[provider] ?? 0) + 1
					if (
						code === 'HTTP_401' ||
						code === 'HTTP_403' ||
						ledger.consecutiveChannelFailures[provider]! >= 2
					) {
						ledger.stoppedProviders ??= {}
						ledger.stoppedProviders[provider] = code
					}
				})
				console.log(
					JSON.stringify({
						scene: scene.id,
						provider,
						status: 'failed',
						error: code,
						reservationRetained: true,
					}),
				)
				if (originalSaved)
					throw Error('ORIGINAL_EXISTS_REVIEW_STORAGE_FAILURE', {
						cause: error,
					})
				return false
			}
		}
		async function generate(scene: BatchScene) {
			if (completed.has(scene.id)) return
			for (let attempt = 0; attempt < 2; attempt++) {
				const checkpoint = await withLedger((ledger) => ({
					previous: ledger.entries.filter((x) => x.sceneId === scene.id),
					paused: ledger.stoppedProviders ?? {},
				}))
				if (
					checkpoint.previous.some((x) => x.status !== 'failed') ||
					checkpoint.previous.length >= 2
				) {
					failures.push({ id: scene.id, reason: 'SCENE_CHECKPOINT_BLOCKED' })
					return
				}
				const preferred = checkpoint.previous.length
					? providers.find((x) => x !== checkpoint.previous[0]!.provider)!
					: scene.provider
				const provider = !checkpoint.paused[preferred]
					? preferred
					: providers.find(
							(x) =>
								!checkpoint.paused[x] &&
								!checkpoint.previous.some((row) => row.provider === x),
						)
				if (!provider) {
					failures.push({
						id: scene.id,
						reason: 'ALL_ELIGIBLE_CHANNELS_PAUSED',
					})
					return
				}
				if (await requestImage(scene, provider)) return
			}
			failures.push({ id: scene.id, reason: 'TWO_ATTEMPTS_EXHAUSTED' })
		}
		await Promise.all(
			Array.from({ length: options.concurrency }, async () => {
				while (cursor < queue.length) {
					const scene = queue[cursor++]!
					try {
						await generate(scene)
					} catch (error) {
						failures.push({
							id: scene.id,
							reason:
								error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
									? error.message
									: 'BATCH_ERROR',
						})
					}
				}
			}),
		)
		await progressQueue
		await atomicJson(
			join(output, 'facts.json'),
			facts.sort((a, b) => a.id.localeCompare(b.id)),
		)

		for (let offset = 0; offset < facts.length; offset += 20) {
			await writeContact(
				join(output, `contact-${String(offset / 20 + 1).padStart(2, '0')}.png`),
				facts.slice(offset, offset + 20),
			)
		}
		await atomicJson(join(output, 'summary.json'), {
			at: new Date().toISOString(),
			batchDigest,
			planPath: resolve(options.planPath),
			selected: queue.length,
			completed: facts.length,
			pendingReview: facts.length,
			failures,
			output,
		})
		console.log(
			JSON.stringify({
				status: 'batch-finished',
				output,
				selected: queue.length,
				completed: facts.length,
				failures: failures.length,
				pendingReview: true,
			}),
		)
	} finally {
		await releaseRun()
	}
}
