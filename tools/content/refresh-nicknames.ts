import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
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
import { runWritingBatch, readTaskBudget } from './budget.ts'
import type { Snapshot } from '@campus/contracts'

/** Defaults to a separate checkpoint. Apply only after the full natural-v3 refresh has finished. */
interface Persona {
	id: string
	name: string
	[key: string]: unknown
}
interface NameAssignment {
	id: string
	name: string
}
interface Quality {
	count: number
	unique: number
	han: number
	latin: number
	digits: number
	emoji: number
	momo: number
	interestTerms: string[]
	repeatedPrefixes: Array<[string, number]>
	repeatedSuffixes: Array<[string, number]>
	issues: string[]
}
interface Checkpoint {
	version: 1
	seed: string
	createdAt: string
	pool: string[]
	assignments: NameAssignment[]
	quality: Quality
	attempt: 'initial' | 'repair'
	jobId: string
	appliedAt?: string
	selection?: {
		inputCount: number
		uniqueCandidates: number
		filteredCandidates: number
		rules: string[]
	}
}
const cache = await ensureContentCache()
const directory = join(cache, 'pulse-natural-v3')
const checkpointPath = join(directory, 'nickname-pool.json')
const seed = 'campus-natural-v3-independent-nicknames-2026-11-06'
const personas = JSON.parse(
	await readFile(join(directory, 'personas.json'), 'utf8'),
) as Persona[]
if (
	personas.length !== 200 ||
	new Set(personas.map((row) => row.id)).size !== 200
)
	throw Error('NICKNAME_COHORT_REQUIRES_200_DISTINCT_IDS')
const normalize = (name: string) => name.normalize('NFKC').toLowerCase()
function quality(pool: unknown): Quality {
	const q: Quality = {
		count: Array.isArray(pool) ? pool.length : 0,
		unique: 0,
		han: 0,
		latin: 0,
		digits: 0,
		emoji: 0,
		momo: 0,
		interestTerms: [],
		repeatedPrefixes: [],
		repeatedSuffixes: [],
		issues: [],
	}
	if (!Array.isArray(pool) || pool.some((name) => typeof name !== 'string')) {
		q.issues.push('必须是字符串数组')
		return q
	}
	const names = pool as string[]
	q.unique = new Set(names.map(normalize)).size
	q.han = names.filter((name) => /\p{Script=Han}/u.test(name)).length
	q.latin = names.filter((name) => /[a-z]/i.test(name)).length
	q.digits = names.filter((name) => /\d/.test(name)).length
	q.emoji = names.filter((name) =>
		/\p{Extended_Pictographic}/u.test(name),
	).length
	q.momo = names.filter((name) => /momo/i.test(name)).length
	const interest =
		/胶片|焦距|快门|摄影|三分线|投篮|夜跑|配速|跑者|篮球|羽球|羽毛球|琴弦|吉他|颜料|画笔|画板|画布|简历|offer|程序员|算法|debug|kernel|志愿者|简历/i
	q.interestTerms = names.filter((name) => interest.test(name))
	const frequencies = (side: 'first' | 'last') => {
		const result = new Map<string, number>()
		for (const name of names) {
			const chars = Array.from(normalize(name))
			if (chars.length < 4) continue
			const part = (
				side === 'first' ? chars.slice(0, 2) : chars.slice(-2)
			).join('')
			result.set(part, (result.get(part) ?? 0) + 1)
		}
		return [...result.entries()]
			.filter(([, count]) => count >= 5)
			.sort((a, b) => b[1] - a[1])
	}
	q.repeatedPrefixes = frequencies('first')
	q.repeatedSuffixes = frequencies('last')
	if (q.count !== 200) q.issues.push('数量必须恰好200')
	if (q.unique !== 200) q.issues.push('NFKC及大小写折叠后昵称必须唯一')
	if (
		names.some(
			(name) =>
				name !== name.trim() ||
				Array.from(name).length < 2 ||
				Array.from(name).length > 18 ||
				/[\p{Cc}。；;·\n]/u.test(name) ||
				/https?:|www\.|@/.test(name),
		)
	)
		q.issues.push('昵称长度2至18码点，无控制符、链接、中点或分号')
	if (q.momo > 3) q.issues.push('momo仅少量出现')
	if (q.interestTerms.length > 8)
		q.issues.push('兴趣职业线索昵称超过8个，应回到普通网名')
	if (
		q.repeatedPrefixes.some(([, count]) => count > 8) ||
		q.repeatedSuffixes.some(([, count]) => count > 8)
	)
		q.issues.push('相同双字前后缀出现超过8次，存在循环模板')
	return q
}
function selectPool(sources: unknown[]) {
	const input = sources.flatMap((value) =>
		Array.isArray(value)
			? value.filter((name): name is string => typeof name === 'string')
			: [],
	)
	const unique = new Map(input.map((name) => [normalize(name), name]))
	const produce = new Set([
		'芹菜',
		'韭菜',
		'菠菜',
		'生菜',
		'白菜',
		'青菜',
		'黄瓜',
		'南瓜',
		'冬瓜',
		'丝瓜',
		'苦瓜',
		'木瓜',
		'番茄',
		'香蕉',
		'菠萝',
		'火龙果',
		'杨梅',
		'椰子',
		'山竹',
		'榴莲',
		'蓝莓',
		'樱桃',
	])
	const rank = (name: string) =>
		createHash('sha256').update(`${seed}:selection:${name}`).digest('hex')
	const allowedProduce = new Set(
		[...produce]
			.filter((name) => unique.has(normalize(name)))
			.sort((a, b) => rank(a).localeCompare(rank(b)))
			.slice(0, 12),
	)
	const candidates = [...unique.values()]
		.filter(
			(name) =>
				!/^阿[\p{Script=Han}]{1,3}$/u.test(name) &&
				!/^小([吴杨苏梁谢许邓冯蒋韩唐袁范褚卫沈吕施孔曹严金魏姜戚邹喻柏陶])\1{0,2}$/u.test(
					name,
				) &&
				(!produce.has(name) || allowedProduce.has(name)) &&
				!['柠檬', '随机昵称', '胖虎他哥', '海边的卡夫卡'].includes(name) &&
				!(
					/^[A-Za-z]+[A-Z_]$/.test(name) &&
					unique.has(name.slice(0, -1).toLowerCase())
				),
		)
		.sort((a, b) => rank(a).localeCompare(rank(b)))
	return {
		pool: candidates.slice(0, 200),
		selection: {
			inputCount: input.length,
			uniqueCandidates: unique.size,
			filteredCandidates: candidates.length,
			rules: [
				'两次DS原文候选机械去重，不自写或拼接昵称',
				'过滤成批阿X、小姓氏和重复英文尾缀变体',
				'压缩模型首批中的果蔬枚举片段，其他口语、普通物件和食物名保留',
				'固定seed排序选200，数字与emoji仅统计，不设置配额',
			],
		},
	}
}
function parse(raw: string) {
	const value = JSON.parse(
		raw
			.trim()
			.replace(/^```(?:json)?\s*/, '')
			.replace(/\s*```$/, ''),
	) as { names?: unknown }
	return value.names
}
const prompt = `生成一个独立的200个互联网昵称候选池，只返回JSON对象{"names":[200个字符串]}，不解释，不编号
这是与具体人物完全解耦的网名池，没有任何兴趣、职业、专业、身份或人格输入，不要自行给名字配职业
整体像普通中文互联网用户：短词、随意词组、并不完整的口语、食物、拼音、大小写英文混合、少量数字和极少量emoji均可自然出现
中文昵称为主，拼音、英文、数字、emoji自然分布即可，不设置数量配额，momo可少量出现。不要按类别排成整齐的分组
不要批量使用摄影胶片跑步三分线offer颜料程序员等兴趣或职业词，不让网名像兴趣标签、社团成员名册或专业自我介绍
不要批量阿X、小X、一只X、X不想上班、X今天X等前后缀套壳，不按数字递增，不用同几个词轮流拼接
不要追求段子、金句、文艺意象堆砌或每个名字都有故事，有的普通甚至没意义也自然
名字之间要有明显差异，读起来不全员一个命名作者，不用真实姓名，不使用知名人物或知名IP角色名
每个名字2至18个Unicode码点，唯一且不带首尾空格，不含链接、控制字符、中点、分号，不写昵称释义`
let checkpoint: Checkpoint | undefined
try {
	checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as Checkpoint
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
if (
	checkpoint &&
	(checkpoint.seed !== seed ||
		checkpoint.quality.issues.length ||
		quality(checkpoint.pool).issues.length)
)
	throw Error('NICKNAME_CHECKPOINT_INVALID_STOP')
if (!checkpoint) {
	let pool: unknown
	const sources: unknown[] = []
	let selection: Checkpoint['selection']
	let attempt: Checkpoint['attempt'] = 'initial'
	let jobId = 'natural-v3-independent-nicknames-v1'
	try {
		const raw = await runWritingBatch(jobId, prompt, {
			api: 'openai-responses',
			maxTokens: 6500,
			timeoutMs: 180000,
		})
		pool = parse(raw)
		sources.push(pool)
	} catch (error) {
		const message = error instanceof Error ? error.message : ''
		if (/BUDGET|PRICING/.test(message)) throw error
	}
	let q = quality(pool)
	if (q.issues.length) {
		attempt = 'repair'
		jobId += '-repair'
		const repair = await runWritingBatch(
			jobId,
			`${prompt}\n上次候选未通过，仅允许这一次整体修复\n问题：${q.issues.join('，')}\n已有候选（仍需恰好200且完整输出）：${JSON.stringify(pool ?? []).slice(0, 18000)}`,
			{ api: 'openai-responses', maxTokens: 6500, timeoutMs: 180000 },
		)
		pool = parse(repair)
		sources.push(pool)
		q = quality(pool)
	}
	if (q.issues.length) {
		const selected = selectPool(sources)
		pool = selected.pool
		selection = selected.selection
		q = quality(pool)
	}
	if (q.issues.length) {
		const failure = join(directory, 'nickname-pool-rejected.json')
		await writeContentCacheFile(
			failure,
			JSON.stringify({ pool, quality: q, jobId }, null, '\t'),
		)
		throw Error('NICKNAME_QUALITY_FAILED_AFTER_ONE_REPAIR')
	}
	const names = pool as string[]
	const shuffled = names
		.map((name, index) => ({
			name,
			key: createHash('sha256').update(`${seed}:${index}`).digest('hex'),
		}))
		.sort((a, b) => a.key.localeCompare(b.key))
		.map((row) => row.name)
	const ids = personas
		.map((row) => row.id)
		.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
	checkpoint = {
		version: 1,
		seed,
		createdAt: new Date().toISOString(),
		pool: names,
		assignments: ids.map((id, index) => ({ id, name: shuffled[index]! })),
		quality: q,
		attempt,
		jobId,
		selection,
	}
	await writeContentCacheFile(
		checkpointPath,
		JSON.stringify(checkpoint, null, '\t') + '\n',
	)
}
if (process.argv.includes('--apply')) {
	const { db } = await import('../../packages/domain/prisma.ts')
	try {
		const mapping = new Map(
			checkpoint.assignments.map((row) => [row.id, row.name]),
		)
		const rows = await db.user.findMany({
			where: { id: { in: [...mapping.keys()] } },
			select: { id: true, name: true, source: true },
		})
		if (rows.length !== 200 || rows.some((row) => row.source !== 'Synthetic'))
			throw Error('NICKNAME_APPLY_COHORT_SOURCE_CHANGED')
		const snapshotFile = await resolveSnapshotFile('natural-v3.json')
		const preset = JSON.parse(await readFile(snapshotFile, 'utf8')) as Snapshot
		if (
			preset.users.some(
				(row) => mapping.has(row.id) && row.source !== 'Synthetic',
			)
		)
			throw Error('NICKNAME_SEED_CONTAINS_NON_SYNTHETIC_ASSIGNMENT')
		const freshPersonas = JSON.parse(
			await readFile(join(directory, 'personas.json'), 'utf8'),
		) as Persona[]
		const files = (await readdir(directory)).filter((name) =>
			/^people-\d+\.json$/.test(name),
		)
		const payloads = new Map<string, string>()
		payloads.set(
			'personas.json',
			JSON.stringify(
				freshPersonas.map((row) =>
					mapping.has(row.id) ? { ...row, name: mapping.get(row.id) } : row,
				),
				null,
				'\t',
			) + '\n',
		)
		for (const file of files) {
			const content = JSON.parse(
				await readFile(join(directory, file), 'utf8'),
			) as { personas: Persona[] }
			content.personas = content.personas.map((row) =>
				mapping.has(row.id) ? { ...row, name: mapping.get(row.id)! } : row,
			)
			payloads.set(file, JSON.stringify(content, null, '\t') + '\n')
		}
		const backup = resolve('.data/nickname-refresh', String(Date.now()))
		await mkdir(backup, { recursive: true, mode: 0o700 })
		await writeFile(
			join(backup, 'database-user-names.json'),
			JSON.stringify(rows, null, '\t'),
			{ mode: 0o600 },
		)
		for (const file of payloads.keys())
			await writeFile(
				join(backup, file),
				await readFile(join(directory, file)),
				{ mode: 0o600 },
			)
		await writeFile(
			join(backup, 'natural-v3-before.json'),
			await readFile(snapshotFile),
			{ mode: 0o600 },
		)
		await db.$transaction(async (tx) => {
			for (const row of checkpoint.assignments) {
				const result = await tx.user.updateMany({
					where: { id: row.id, source: 'Synthetic' },
					data: { name: row.name },
				})
				if (result.count !== 1) throw Error('NICKNAME_APPLY_COHORT_CHANGED')
			}
		})
		for (const [file, content] of payloads)
			await writeContentCacheFile(join(directory, file), content)
		preset.users = preset.users.map((row) =>
			row.source === 'Synthetic' && mapping.has(row.id)
				? { ...row, name: mapping.get(row.id)! }
				: row,
		)
		await writeSnapshotFile(
			'natural-v3.json',
			JSON.stringify(preset, null, '\t') + '\n',
		)
		await publishSnapshots()
		checkpoint.appliedAt = new Date().toISOString()
		await writeContentCacheFile(
			checkpointPath,
			JSON.stringify(checkpoint, null, '\t') + '\n',
		)
		const receipt = {
			at: checkpoint.appliedAt,
			changedSyntheticUsers: 200,
			realUsersChanged: 0,
			personaFiles: payloads.size,
			snapshot: 'natural-v3.json',
			backup,
			budget: await readTaskBudget(),
		}
		await writeContentCacheFile(
			join(directory, 'nickname-receipt.json'),
			JSON.stringify(receipt, null, '\t') + '\n',
		)
		const result = await packContentCache()
		if (!result.cacheStateUpdated)
			throw Error('NICKNAME_ARCHIVE_COMMITTED_CACHE_STATE_PENDING_STOP')
		console.log(
			JSON.stringify({
				phase: 'applied',
				users: 200,
				realUsersChanged: 0,
				backup,
			}),
		)
	} finally {
		await db.$disconnect()
	}
} else
	console.log(
		JSON.stringify({
			phase: 'checkpoint-only',
			path: checkpointPath,
			quality: checkpoint.quality,
			attempt: checkpoint.attempt,
			budget: await readTaskBudget(),
		}),
	)
