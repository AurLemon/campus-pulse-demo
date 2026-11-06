/** Three Synthetic promotion actors and posts, appended through the audited import path. */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { ContentImportBatch, Snapshot } from '@campus/contracts'
import type { AgentPersona } from '@campus/contracts/agents'
import { runWritingBatch, type Ledger } from './budget.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
import {
	resolveSnapshotFile,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { validateSnapshot } from './validate.ts'

interface WrittenPersona {
	id: string
	name: string
	bio: string
	voice: string
	routine: string
	ordinaryLifeFacts: string[]
	currentMotives: string[]
}
interface WrittenPost {
	id: string
	title: string
	body: string
}
interface Plan {
	id: string
	createdAt: string
}
const batchId = 'campus-ads-v1'
const specs = [
	{
		id: 'ads_secondhand',
		postId: 'ads_post_secondhand',
		campus: '铜盘校区',
		topic: 'daily',
		kind: '整理自己闲置物品的校园个人转让',
	},
	{
		id: 'ads_photo',
		postId: 'ads_post_photo',
		campus: '旗山校区',
		topic: 'photography',
		kind: '课余接校园人像约拍的个人推广',
	},
	{
		id: 'ads_print',
		postId: 'ads_post_print',
		campus: '鼓山校区',
		topic: 'technology',
		kind: '课余提供文档排版和打印协助的个人推广',
	},
] as const
const cache = await ensureContentCache()
const directory = join(cache, batchId)
const json = async <T>(file: string): Promise<T> =>
	JSON.parse(await readFile(file, 'utf8')) as T
const serialize = (value: unknown) => JSON.stringify(value, null, '\t') + '\n'
const save = (file: string, value: unknown) =>
	writeContentCacheFile(join(directory, file), serialize(value))
const digest = (value: unknown) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex')
const ledgerFile = resolve('.data/data-generation/ledger.json')
async function generateOnce(id: string, prompt: string) {
	const ledger = await json<Ledger>(ledgerFile)
	if (
		ledger.entries.some((row) => row.id === id && row.status === 'failed') &&
		!ledger.entries.some((row) => row.id === id && row.status === 'complete')
	)
		throw Error(`FAILED_BATCH_NO_AUTOMATIC_RETRY:${id}`)
	const raw = await runWritingBatch(id, prompt, {
		api: 'openai-completions',
		maxTokens: 4096,
		timeoutMs: 180000,
	})
	await save(`${id}-raw.json`, {
		source: 'Synthetic',
		writer: 'deepseek-v4.1-flash-1017',
		raw,
	})
	return JSON.parse(
		raw
			.trim()
			.replace(/^```(?:json)?\s*/, '')
			.replace(/\s*```$/, ''),
	) as unknown
}
function text(value: unknown, max: number): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= max &&
		!/[。．.]|https?:|www\.|二维码|微信|电话|手机号|元\/|￥|¥|\d{5,}/i.test(
			value,
		)
	)
}
function checkProfiles(value: unknown): asserts value is WrittenPersona[] {
	if (!Array.isArray(value) || value.length !== 3)
		throw Error('ADS_PERSONAS_COUNT')
	for (const spec of specs) {
		const row = value.find((entry: WrittenPersona) => entry.id === spec.id)
		if (
			!row ||
			!text(row.name, 30) ||
			!text(row.bio, 150) ||
			!text(row.voice, 1000) ||
			!text(row.routine, 400) ||
			!Array.isArray(row.ordinaryLifeFacts) ||
			!row.ordinaryLifeFacts.length ||
			!row.ordinaryLifeFacts.every((v: unknown) => text(v, 400)) ||
			!Array.isArray(row.currentMotives) ||
			!row.currentMotives.length ||
			!row.currentMotives.every((v: unknown) => text(v, 400))
		)
			throw Error(`ADS_PERSONA_INVALID:${spec.id}`)
	}
	if (new Set(value.map((row) => row.name)).size !== 3)
		throw Error('ADS_NAMES_DUPLICATE')
}
function checkPosts(value: unknown): asserts value is WrittenPost[] {
	if (!Array.isArray(value) || value.length !== 3)
		throw Error('ADS_POSTS_COUNT')
	for (const spec of specs) {
		const row = value.find((entry: WrittenPost) => entry.id === spec.postId)
		if (!row || !text(row.title, 60) || !text(row.body, 1200))
			throw Error(`ADS_POST_INVALID:${spec.postId}`)
	}
}
let plan: Plan
try {
	plan = await json<Plan>(join(directory, 'plan.json'))
} catch (error) {
	if (
		(error as NodeJS.ErrnoException).code !== 'ENOENT' ||
		!process.argv.includes('--generate')
	)
		throw error
	plan = { id: batchId, createdAt: new Date().toISOString() }
	await save('plan.json', plan)
}
const restrictions =
	'只输出JSON，不用Markdown。仅3个全新的Synthetic校园个人推广角色，不冒充真实商家或学校官方。不得出现真实商家、品牌、网址、二维码、联系方式、价格或交付保证。不要虚构具体校内地名和已有订单。所有字符串不用中文句号和英文句号，不用中点和分号。昵称自然，不按兴趣加编号，bio简短，只写角色公开介绍，不写内部人设或合成说明。voice保留个人动机、有限知识和说话习惯，不全员客服，不强迫回复别人。'
if (process.argv.includes('--generate')) {
	const profiles = await generateOnce(
		`${batchId}-personas`,
		`${restrictions}\n先创建人物，尚不写帖子。按以下固定id/校区/推广范围分别生成，id保持原样：${JSON.stringify(specs)}\n返回数组，每项严格为{id,name,bio,voice,routine,ordinaryLifeFacts:string[],currentMotives:string[]}。生活事实是虚构角色背景，不写真实营业地址或已服务客户数量。`,
	)
	checkProfiles(profiles)
	await save('personas.json', profiles)
	const posts = await generateOnce(
		`${batchId}-posts`,
		`${restrictions}\n人物已固定，分别按其口吻写1条推广帖，每帖80至180字，标题直接说明所提供的物品或协助，正文像个人自己招揽但别写空泛广告口号。是否回复按自己的空闲决定，不承诺随时在线。不增加商品型号、价格和优惠承诺，不编造真实交易结果。可以引导站内评论或私信了解细节。人物：${JSON.stringify(profiles)}\n固定作者和帖子id/范围：${JSON.stringify(specs)}\n返回数组，每项严格为{id:帖子id,title,body}。`,
	)
	checkPosts(posts)
	await save('posts.json', posts)
	const snapshot: Snapshot = {
		version: batchId,
		source: 'Synthetic',
		seed: 203,
		now: plan.createdAt,
		users: specs.map((spec) => {
			const p = profiles.find((row) => row.id === spec.id)!
			return {
				id: spec.id,
				name: p.name,
				bio: p.bio,
				campus: spec.campus,
				role: 'STUDENT',
				interests: { [spec.topic]: 1 },
				createdAt: plan.createdAt,
				source: 'Synthetic',
			}
		}),
		posts: specs.map((spec, index) => {
			const p = posts.find((row) => row.id === spec.postId)!
			return {
				...p,
				authorId: spec.id,
				activityId: null,
				tags: [spec.topic],
				kind: 'TEXT',
				purpose: 'DISCUSSION',
				mediaIds: [],
				posterTemplate: index === 1 ? 'quote' : 'orbit',
				posterAspect: 'portrait',
				posterHighlight: '',
				createdAt: plan.createdAt,
				source: 'Synthetic',
			}
		}),
		activities: [],
		comments: [],
		friendships: [],
		follows: [],
		states: [],
		behaviors: [],
		sessions: [],
	}
	const errors = validateSnapshot(snapshot)
	if (errors.length) throw Error(`ADS_SNAPSHOT_INVALID:${errors.join(',')}`)
	const batch: ContentImportBatch = {
		id: batchId,
		version: batchId,
		snapshot,
		media: [],
	}
	const personas: Array<AgentPersona & { id: string; source: 'Synthetic' }> =
		specs.map((spec) => {
			const p = profiles.find((row) => row.id === spec.id)!
			return {
				...p,
				actorId: spec.id,
				source: 'Synthetic',
				campus: spec.campus,
				className: '校园个人推广',
				grade: 2,
				interests: [spec.topic],
				activeHours: [11, 12, 17, 18, 19, 20, 21, 22],
				activityWeight: 0.45,
				cooldownMinutes: 60,
				relationships: [],
				recentEvents: [],
				profileAsOf: plan.createdAt,
			}
		})
	await writeSnapshotFile('ads.json', serialize(batch))
	await writeSnapshotFile('ads-personas.json', serialize(personas))
	await writeSnapshotFile(
		'ads-provenance.json',
		serialize({
			source: 'Synthetic',
			purpose: 'campus-promotion-demo',
			writer: 'deepseek-v4.1-flash-1017',
			batchId,
			createdAt: plan.createdAt,
			contentDigest: digest(batch),
			writingBatchIds: [`${batchId}-personas`, `${batchId}-posts`],
			runtimeLogsExcluded: true,
			titleCovers: true,
		}),
	)
	const contentBundle = await packContentCache()
	if (!contentBundle.cacheStateUpdated)
		throw Error('ADS_CONTENT_ARCHIVE_PUBLISHED_STATE_PENDING')
	await publishSnapshots()
}
const batch = await json<ContentImportBatch>(
	await resolveSnapshotFile('ads.json'),
)
const profiles = await json<WrittenPersona[]>(join(directory, 'personas.json'))
const posts = await json<WrittenPost[]>(join(directory, 'posts.json'))
checkProfiles(profiles)
checkPosts(posts)
const errors = validateSnapshot(batch.snapshot)
if (
	batch.id !== batchId ||
	batch.snapshot.users.length !== 3 ||
	batch.snapshot.posts.length !== 3 ||
	errors.length
)
	throw Error(`ADS_BATCH_INVALID:${errors.join(',')}`)
const { db } = await import('../../packages/domain/prisma.ts')
try {
	const receipt = await db.contentImportReceipt.findUnique({
		where: { id: batchId },
	})
	const userIds = batch.snapshot.users.map((row) => row.id)
	const postIds = batch.snapshot.posts.map((row) => row.id)
	const conflicts = {
		users: await db.user.count({
			where: {
				OR: [
					{ id: { in: userIds } },
					{ name: { in: profiles.map((row) => row.name) } },
				],
			},
		}),
		posts: await db.post.count({ where: { id: { in: postIds } } }),
	}
	if (!receipt && (conflicts.users || conflicts.posts))
		throw Error('ADS_APPEND_CONFLICT')
	console.log(
		JSON.stringify({
			preflight: true,
			batchId,
			digest: digest(batch),
			names: profiles.map((row) => row.name),
			posts: posts.map((row) => row.title),
			alreadyImported: !!receipt,
			appendOnly: true,
		}),
	)
	if (process.argv.includes('--apply')) {
		const { importContentBatch } =
			await import('../../packages/domain/import.ts')
		const result = await importContentBatch(batch)
		console.log(JSON.stringify({ applied: true, ...result }))
		await save('import-receipt.json', result)
		const bundle = await packContentCache()
		if (!bundle.cacheStateUpdated)
			throw Error('ADS_RECEIPT_ARCHIVE_PUBLISHED_STATE_PENDING')
	}
} finally {
	await db.$disconnect()
}
