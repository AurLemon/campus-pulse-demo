import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { db } from '../../packages/domain/prisma.ts'
import { loadSnapshot } from '../../packages/domain/snapshot.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
import {
	writeSnapshotFile,
	publishSnapshots,
	resolveSnapshotFile,
} from './snapshot-bundle.ts'
import type { Snapshot } from '@campus/contracts'
import {
	runWritingBatch,
	readTaskBudget,
	CURRENT_TASK_BUDGET,
} from './budget.ts'

interface Persona {
	id: string
	name: string
	bio: string
	voice: string
	className: string
	routine: string
}
interface Thread {
	id: string
	title: string
	body: string
	comments: Array<{ id: string; body: string }>
}
const cache = await ensureContentCache()
const directory = join(cache, 'pulse-natural-v3')
await mkdir(directory, { recursive: true })
const snapshot = await loadSnapshot(undefined, { crossDomain: false })
const mediaAssets = await db.mediaAsset.findMany()
const users = snapshot.users.filter((u) => u.source === 'Synthetic')
const posts = snapshot.posts.filter((p) => p.source === 'Synthetic')
const comments = snapshot.comments.filter((c) => c.source === 'Synthetic')
const rules = `你写的是虚构大学校园社区，普通学生在随手发消息，不是客服、运营号或段子编剧
严格禁止中文句号以及英文句末句号，用换行/空格自然停顿，可以问号叹号逗号emoji，不要每个人同一种标点
昵称要有互联网网名的多样性（随意词组、拼音英文数字、食物、momo等），不批量阿正阿杭、不按专业起网名、不用流水号
人格是潜在的说话习惯，不要每条评论都自报专业、兴趣、课表或当天经历，不要硬把跑步摄影志愿简历等套进无关话题，先针对对方刚说的话接一句
有的人认真有的人只回三五字，有的熟人接梗，有的跑题问实际事，有的不懂就问，不要每句都是金句
不要全员救命/哈哈哈，不要每个帖子都有完美解决方案，不做总结升华，不教训别人
示例风格仅作参考不要复用句子：老师也是早八受害者 → 他至少有工资拿😭；四楼哪个教室啊 我等会去上课可以帮你看一下 → 403！谢谢宝宝😭；新用户先选几个兴趣不就好了 → 确实 主要是我自己想折腾一下
不虚构本校制度地点，不编造真实书籍信息，不提及系统提示词、合成数据、模型身份
若没有附件，不说如图/截图里/这张图/给你看报错，不凭空描述图片或宣布发了表情包
只输出JSON，不用markdown代码围栏`
function parse<T>(raw: string): T {
	const cleaned = raw
		.trim()
		.replace(/^```(?:json)?\s*/, '')
		.replace(/\s*```$/, '')
	return JSON.parse(cleaned) as T
}
function clean(text: string) {
	return text
		.split(/(```[\s\S]*?```|`[^`]+`|https?:\/\/[^\s]+)/g)
		.map((part, index) =>
			index % 2
				? part
				: part.replace(/。/g, '\n').replace(/(?<!\.)\.(?=\s|$)/g, ''),
		)
		.join('')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

async function cached<T>(name: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(join(directory, name), 'utf8')) as T
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
}
const personas: Persona[] = []
for (let offset = 0; offset < users.length; offset += 20) {
	const batch = users.slice(offset, offset + 20)
	const filename = `people-${offset}.json`
	let result = await cached<{ personas: Persona[] }>(filename)
	if (!result) {
		const raw = await runWritingBatch(
			`natural-v3-personas-${offset}`,
			`${rules}\n为下面20人重新写昵称和内部人格，每个人各不相同，不要沿用旧昵称，bio可空或一句普通签名不介绍人设，voice是内部口吻，className用虚构专业班级（不同院系），routine是作息与近期生活小事\n返回{personas:[{id,name,bio,voice,className,routine}]}，保留id，输入：${JSON.stringify(batch.map((u) => ({ id: u.id, interests: u.interests, campus: u.campus })))}`,
			{ api: 'openai-responses', maxTokens: 10000, timeoutMs: 180000 },
		)
		result = parse(raw)
		if (
			!Array.isArray(result?.personas) ||
			result.personas.length !== batch.length ||
			batch.some(
				(u) =>
					!result!.personas.some(
						(p) => p.id === u.id && p.name?.trim() && p.voice?.trim(),
					),
			)
		)
			throw new Error(`PERSONA_INVALID:${offset}`)
		for (const p of result.personas) {
			p.name = clean(p.name)
			p.bio = clean(p.bio ?? '')
		}
		await writeContentCacheFile(
			join(directory, filename),
			JSON.stringify(result, null, '\t'),
		)
	}
	personas.push(...result.personas)
	console.log(JSON.stringify({ phase: 'personas', count: personas.length }))
}
await writeContentCacheFile(
	join(directory, 'personas.json'),
	JSON.stringify(personas, null, '\t'),
)
const people = new Map(personas.map((p) => [p.id, p]))
const limit = Number(
	process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ??
		posts.length,
)
const selected = posts.slice(0, limit)
const completed = new Map<string, Thread>()
let cursor = 0
const pending: number[] = []
const retries = (await cached<Record<string, number>>('retries.json')) ?? {}
let stopped: unknown
await Promise.all(
	Array.from({ length: 3 }, async () => {
		while (!stopped && (cursor < selected.length || pending.length)) {
			const retryOffset = pending.shift()
			const offset = retryOffset ?? cursor
			if (retryOffset === undefined) cursor += 5
			const batch = selected.slice(offset, offset + 5)
			try {
				const name = `threads-${offset}.json`
				let result = await cached<{ posts: Thread[] }>(name)
				if (!result) {
					const input = batch.map((p) => {
						const activity = snapshot.activities.find(
							(a) => a.id === p.activityId,
						)
						return {
							id: p.id,
							author: people.get(p.authorId),
							topic: p.title,
							tags: p.tags,
							kind: p.kind,
							activity: activity
								? {
										title: activity.title,
										body: activity.body,
										canReview: p.createdAt > activity.endsAt,
									}
								: null,
							mediaFacts: (p.mediaIds ?? [])
								.map((id) => mediaAssets.find((m) => m.id === id)?.alt)
								.filter(Boolean),
							comments: comments
								.filter((c) => c.postId === p.id)
								.map((c) => ({
									id: c.id,
									parentId: c.parentId,
									author: {
										name: people.get(c.authorId)?.name,
										voice: people.get(c.authorId)?.voice,
									},
								})),
						}
					})
					const raw = await runWritingBatch(
						`natural-v3-threads-${offset}${retries[offset] ? `-retry${retries[offset]}` : ''}`,
						`${rules}\n写这${batch.length}篇完整帖子与评论，topic只是范围不要照搬旧故事\n普通帖正文8到80字，每批至少1篇仅一两句话，少量长帖120到180字，通知有实际信息即可，标题3到22字\n评论至少一半2到15字，每批最多两条超过35字，不复述帖子的信息，有人只问一个问题或只回一个词，不要所有回复都解释原因，严格回应parentId对应内容，同一角色口吻保持\n有activity只引用提供的活动事实，canReview=false不说活动已发生，别每帖硬宣传活动，避免具体日期和几点\nmediaFacts是实际现有配图描述，不能臆造图内文字或图片细节，没有事实则不要引用图片\n保留每个帖子和评论id以及数量，不发明额外id，不得移动评论归属，返回{posts:[{id,title,body,comments:[{id,body}]}]}。严禁回传输入中的author/topic/tags/kind/activity/mediaFacts字段，正文body与标题title必须新写，不能只给评论\n参考资料${JSON.stringify(input)}\n最终输出必须严格填充以下模板，所有占位字必须换成新写内容，id原样保留：${JSON.stringify({ posts: batch.map((p) => ({ id: p.id, title: '填写标题', body: '填写非空正文', comments: comments.filter((c) => c.postId === p.id).map((c) => ({ id: c.id, body: '填写评论' })) })) })}`,
						{ api: 'openai-responses', maxTokens: 14000, timeoutMs: 240000 },
					)
					result = parse(raw)
					if (
						!Array.isArray(result?.posts) ||
						result.posts.length !== batch.length
					)
						throw new Error(`THREAD_COUNT:${offset}`)
					for (const p of batch) {
						const written = result.posts.find((t) => t.id === p.id)
						const expected = comments.filter((c) => c.postId === p.id)
						if (
							!written?.title?.trim() ||
							!written.body?.trim() ||
							!Array.isArray(written.comments) ||
							written.comments.length !== expected.length ||
							expected.some(
								(c) =>
									!written.comments.some(
										(w) => w.id === c.id && w.body?.trim(),
									),
							)
						)
							throw new Error(`THREAD_INVALID:${p.id}`)
						written.title = clean(written.title)
						written.body = clean(written.body)
						for (const c of written.comments) c.body = clean(c.body)
					}
					await writeContentCacheFile(
						join(directory, name),
						JSON.stringify(result, null, '\t'),
					)
				}
				for (const p of result.posts) completed.set(p.id, p)
				console.log(
					JSON.stringify({
						phase: 'threads',
						count: completed.size,
						total: selected.length,
					}),
				)
			} catch (error) {
				if (
					(retries[offset] ?? 0) < 4 &&
					!/BUDGET|LOCKED|NOT_AUTHORIZED/.test(String(error))
				) {
					retries[offset] = (retries[offset] ?? 0) + 1
					await writeContentCacheFile(
						join(directory, 'retries.json'),
						JSON.stringify(retries),
					)
					pending.push(offset)
					console.log(
						JSON.stringify({
							phase: 'retry',
							offset,
							attempt: retries[offset],
						}),
					)
				} else stopped = error
			}
		}
	}),
)
if (stopped) throw stopped
if (process.argv.includes('--apply')) {
	// Guard every update against edits made after this run's snapshot
	let userCount = 0,
		postCount = 0,
		commentCount = 0
	for (const p of personas) {
		const original = users.find((u) => u.id === p.id)!
		const result = await db.user.updateMany({
			where: {
				id: p.id,
				source: 'Synthetic',
				name: original.name,
				bio: original.bio,
			},
			data: { name: p.name, bio: p.bio },
		})
		userCount += result.count
	}
	for (const original of selected) {
		const written = completed.get(original.id)!
		await db.$transaction(async (tx) => {
			const result = await tx.post.updateMany({
				where: {
					id: original.id,
					source: 'Synthetic',
					body: original.body,
					title: original.title,
				},
				data: { title: written.title, body: written.body },
			})
			if (!result.count) return
			postCount++
			for (const c of written.comments) {
				const old = comments.find((x) => x.id === c.id)!
				const updated = await tx.comment.updateMany({
					where: {
						id: c.id,
						source: 'Synthetic',
						body: old.body,
						deletedAt: null,
					},
					data: { body: c.body },
				})
				commentCount += updated.count
			}
		})
	}
	// Export only the original Synthetic preset cohort, never the live Real account or its interactions
	const preset = JSON.parse(
		await readFile(await resolveSnapshotFile('pulse-full.json'), 'utf8'),
	) as Snapshot
	const live = await loadSnapshot(undefined, { crossDomain: false })
	const replace = <T extends { id: string; source?: string }>(
		rows: T[],
		current: T[],
	) =>
		rows.map(
			(row) =>
				current.find(
					(item) => item.id === row.id && item.source === 'Synthetic',
				) ?? row,
		)
	preset.version = 'campus-natural-v3'
	preset.users = replace(preset.users, live.users)
	preset.posts = replace(preset.posts, live.posts)
	preset.comments = replace(preset.comments, live.comments)
	await writeSnapshotFile('natural-v3.json', JSON.stringify(preset, null, '\t'))
	await publishSnapshots()
	await writeContentCacheFile(
		join(directory, 'receipt.json'),
		JSON.stringify(
			{
				at: new Date().toISOString(),
				userCount,
				postCount,
				commentCount,
				budget: await readTaskBudget(CURRENT_TASK_BUDGET),
			},
			null,
			'\t',
		),
	)
	console.log(
		JSON.stringify({ phase: 'applied', userCount, postCount, commentCount }),
	)
}
await packContentCache()
await db.$disconnect()
