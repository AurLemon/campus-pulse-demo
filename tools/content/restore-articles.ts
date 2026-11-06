import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { db } from '../../packages/domain/prisma.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { Snapshot } from '@campus/contracts'
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
interface Written {
	id: string
	body: string
	comments: Array<{ id: string; body: string }>
}
type PostRow = Awaited<ReturnType<typeof db.post.findFirstOrThrow>>
type CommentRow = Awaited<ReturnType<typeof db.comment.findFirstOrThrow>>
interface Input {
	post: PostRow
	comments: CommentRow[]
	author: { name: string; voice: string }
	mediaFacts: string[]
}
interface Checkpoint {
	version: 1
	createdAt: string
	input: Input[]
	written: Written[]
	skipped: Array<{ id: string; reason: string }>
	appliedAt?: string
}
const targetIds = ['p122', 'p363', 'p596', 'p846']
const cache = await ensureContentCache(),
	directory = join(cache, 'pulse-natural-v3'),
	path = join(directory, 'long-articles.json')
const personas = JSON.parse(
	await readFile(join(directory, 'personas.json'), 'utf8'),
) as Array<{ id: string; name: string; voice: string }>
async function hasRealParticipation(
	tx: Prisma.TransactionClient,
	postId: string,
) {
	const counts = await Promise.all([
		tx.comment.count({
			where: {
				postId,
				OR: [{ source: 'Real' }, { author: { source: 'Real' } }],
			},
		}),
		tx.state.count({ where: { postId, user: { source: 'Real' } } }),
		tx.behavior.count({ where: { postId, user: { source: 'Real' } } }),
		tx.viewSession.count({ where: { postId, user: { source: 'Real' } } }),
	])
	return counts.some((count) => count > 0)
}
function parse(raw: string) {
	return (
		JSON.parse(
			raw
				.trim()
				.replace(/^```(?:json)?\s*/, '')
				.replace(/\s*```$/, ''),
		) as { posts: Written[] }
	).posts
}
function validate(input: Input[], written: Written[]) {
	const issues: string[] = []
	if (!Array.isArray(written) || written.length !== input.length)
		return ['帖子数量必须与输入完全一致']
	if (new Set(written.map((row) => row.id)).size !== input.length)
		issues.push('帖子id重复')
	for (const original of input) {
		const row = written.find((value) => value.id === original.post.id)
		if (!row || typeof row.body !== 'string') {
			issues.push(`${original.post.id}:缺少正文`)
			continue
		}
		const length = Array.from(row.body.replace(/\s/g, '')).length
		if (
			length < (process.argv.includes('--accept-shorter') ? 220 : 300) ||
			length > 650
		)
			issues.push(`${row.id}:正文${length}字，要求审核允许的长文范围`)
		if (row.body.split(/\n+/).filter((value) => value.trim()).length < 3)
			issues.push(`${row.id}:至少三个自然段`)
		if (
			!Array.isArray(row.comments) ||
			row.comments.length !== original.comments.length ||
			new Set(row.comments.map((c) => c.id)).size !==
				original.comments.length ||
			original.comments.some(
				(c) => !row.comments.some((value) => value.id === c.id),
			)
		)
			issues.push(`${row.id}:评论id或数量不匹配`)
		for (const text of [row.body, ...(row.comments ?? []).map((c) => c.body)]) {
			if (
				typeof text !== 'string' ||
				!text.trim() ||
				/[。；;·]/u.test(text) ||
				/(?<!\.)\.(?=\s|$)/u.test(text) ||
				/如图|截图里|附图|看图|发个表情包|作为AI|语言模型|合成数据|填写正文|填写评论|\.\.\.|…/u.test(
					text,
				)
			)
				issues.push(`${row.id}:空文、禁用标点或无附件的图片声明`)
		}
		if ((row.comments ?? []).some((c) => Array.from(c.body).length > 300))
			issues.push(`${row.id}:评论不超过300字`)
	}
	return issues
}
let checkpoint: Checkpoint | undefined
try {
	checkpoint = JSON.parse(await readFile(path, 'utf8')) as Checkpoint
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
if (!checkpoint) {
	const input: Input[] = [],
		skipped: Checkpoint['skipped'] = []
	for (const id of targetIds) {
		const post = await db.post.findUnique({ where: { id } })
		if (!post || post.kind !== 'ARTICLE' || post.source !== 'Synthetic') {
			skipped.push({ id, reason: 'not-existing-synthetic-article' })
			continue
		}
		const author = await db.user.findUnique({ where: { id: post.authorId } })
		if (
			author?.source !== 'Synthetic' ||
			(await hasRealParticipation(db, id))
		) {
			skipped.push({ id, reason: 'real-participation' })
			continue
		}
		const comments = await db.comment.findMany({
			where: { postId: id, deletedAt: null },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		})
		if (comments.some((row) => row.source !== 'Synthetic')) {
			skipped.push({ id, reason: 'non-synthetic-comment' })
			continue
		}
		const ids = JSON.parse(post.mediaIds) as string[]
		const media = await db.mediaAsset.findMany({ where: { id: { in: ids } } })
		const persona = personas.find((row) => row.id === post.authorId)
		input.push({
			post,
			comments,
			author: {
				name: author.name,
				voice: persona?.voice ?? '普通学生自然讲述',
			},
			mediaFacts: media.map((row) => row.alt),
		})
	}
	if (!input.length) throw Error('NO_UNPROTECTED_ARTICLES')
	const context = input.map((row) => ({
		id: row.post.id,
		title: row.post.title,
		currentBody: row.post.body,
		tags: JSON.parse(row.post.tags),
		createdAt: row.post.createdAt,
		author: row.author,
		activity: null,
		mediaFacts: row.mediaFacts,
		comments: row.comments.map((c) => ({
			id: c.id,
			parentId: c.parentId,
			body: c.body,
		})),
	}))
	const prompt = `为下面${input.length}篇虚构学生校园社区ARTICLE恢复少量长文，只处理这些id，不增加帖子或评论
每篇正文300至650字，建议380至520字，分3至6个自然段，用换行或空行停顿，不用中文句号、英文句末句号、分号、中点和省略号
保留当前标题及主题，写成普通人愿意多说几句的自然经历或具体讨论，语气允许碎念、不确定、补充细节，不要作文，不要课程报告、客服教程、运营号、总结升华或每篇都得出完整结论
保留author的表达习惯，但不强迫每段自报兴趣、专业或作息，不把所有作者写成同一位长文博主
Git那篇写具体一次merge冲突后的排查经历，允许git status、git diff、编辑冲突文件、git add标记已解决这些真实步骤，git add不代表逻辑正确，需要自行检查最终代码与原有功能，勿捏造截图、仓库地址、提交或执行日志，勿推荐强推或盲选一方
慢跑那篇写个人被即时与整公里配速干扰的真实感体验与疑问，不提供医学判断、不制定训练计划，不把心率当绝对标准
画面留白那篇写具体一页作品从塞满到删改的犹豫过程，没有图片，不说如图，不编造成展览或比赛获奖
慢读那篇写读一页走神又翻回去的细节，不虚构真实书名、作者、引语，不把慢读说成人人应遵循的方法
mediaFacts只允许引用已提供的事实，空数组表示无附件，不能宣称已上传图片、截图或表情，activity=null不编造活动已经发生
同步每篇提供的所有评论，保留id、数量与parentId关系，只针对新正文或其父评论自然接话，不全员解释，不硬套兴趣，不补写缺失评论
返回严格JSON {posts:[{id,body,comments:[{id,body}]}]}，不要输出title，不返回解释或输入字段
输入：${JSON.stringify(context)}`
	let written: Written[] = []
	let issues: string[]
	try {
		written = parse(
			await runWritingBatch('natural-v3-restore-four-articles-v1', prompt, {
				api: 'openai-responses',
				maxTokens: 14000,
				timeoutMs: 240000,
			}),
		)
		issues = validate(input, written)
	} catch (error) {
		if (error instanceof Error && /BUDGET|PRICING/.test(error.message))
			throw error
		issues = ['首批JSON或生成未完成']
	}
	if (issues.length) {
		written = parse(
			await runWritingBatch(
				'natural-v3-restore-four-articles-v1-repair',
				`${prompt}\n只允许这一次修复，问题：${issues.join('，')}\n前次输出：${JSON.stringify(written)}`,
				{ api: 'openai-responses', maxTokens: 14000, timeoutMs: 240000 },
			),
		)
		issues = validate(input, written)
	}
	if (issues.length) {
		await writeContentCacheFile(
			join(directory, 'long-articles-rejected.json'),
			JSON.stringify({ issues, written }, null, '\t'),
		)
		throw Error('ARTICLE_QUALITY_FAILED_AFTER_REPAIR')
	}
	checkpoint = {
		version: 1,
		createdAt: new Date().toISOString(),
		input,
		written,
		skipped,
	}
	await writeContentCacheFile(
		path,
		JSON.stringify(checkpoint, null, '\t') + '\n',
	)
}
if (validate(checkpoint.input, checkpoint.written).length)
	throw Error('ARTICLE_CHECKPOINT_INVALID')
if (process.argv.includes('--apply')) {
	const ready = checkpoint
	const backup = resolve('.data/article-restoration', String(Date.now()))
	await mkdir(backup, { recursive: true, mode: 0o700 })
	await writeFile(
		join(backup, 'original-threads.json'),
		JSON.stringify(ready.input, null, '\t'),
		{ mode: 0o600 },
	)
	const applied: string[] = [],
		skipped = [...ready.skipped]
	await db.$transaction(
		async (tx) => {
			for (const original of ready.input) {
				const current = await tx.post.findUnique({
					where: { id: original.post.id },
				})
				const changed =
					!current ||
					current.kind !== 'ARTICLE' ||
					current.source !== 'Synthetic' ||
					current.title !== original.post.title ||
					(current.body !== original.post.body &&
						current.body !==
							ready.written.find((row) => row.id === current.id)?.body) ||
					current.mediaIds !== original.post.mediaIds ||
					current.activityId !== original.post.activityId
				if (changed || (await hasRealParticipation(tx, original.post.id))) {
					skipped.push({
						id: original.post.id,
						reason: changed
							? 'post-changed-since-checkpoint'
							: 'real-participation-before-apply',
					})
					continue
				}
				const live = await tx.comment.findMany({
					where: { postId: original.post.id, deletedAt: null },
				})
				const written = ready.written.find(
					(row) => row.id === original.post.id,
				)!
				if (
					live.length !== original.comments.length ||
					live.some((row) => {
						const before = original.comments.find((c) => c.id === row.id),
							after = written.comments.find((c) => c.id === row.id)
						return (
							row.source !== 'Synthetic' ||
							!before ||
							row.parentId !== before.parentId ||
							(row.body !== before.body && row.body !== after?.body)
						)
					})
				) {
					skipped.push({
						id: original.post.id,
						reason: 'comments-changed-since-checkpoint',
					})
					continue
				}
				await tx.post.update({
					where: { id: current!.id },
					data: { body: written.body },
				})
				for (const row of written.comments)
					await tx.comment.updateMany({
						where: {
							id: row.id,
							postId: original.post.id,
							source: 'Synthetic',
							deletedAt: null,
						},
						data: { body: row.body },
					})
				applied.push(original.post.id)
			}
		},
		{ timeout: 15000 },
	)
	const replacements = new Map(
		ready.written
			.filter((row) => applied.includes(row.id))
			.map((row) => [row.id, row]),
	)
	for (const file of (await readdir(directory)).filter((name) =>
		/^threads-\d+\.json$/.test(name),
	)) {
		const value = JSON.parse(await readFile(join(directory, file), 'utf8')) as {
			posts: Array<{
				id: string
				body: string
				comments: Array<{ id: string; body: string }>
			}>
		}
		let changed = false
		for (const row of value.posts) {
			const replacement = replacements.get(row.id)
			if (replacement) {
				row.body = replacement.body
				row.comments = replacement.comments
				changed = true
			}
		}
		if (changed)
			await writeContentCacheFile(
				join(directory, file),
				JSON.stringify(value, null, '\t') + '\n',
			)
	}
	const preset = JSON.parse(
		await readFile(await resolveSnapshotFile('natural-v3.json'), 'utf8'),
	) as Snapshot
	for (const post of preset.posts) {
		const replacement = replacements.get(post.id)
		if (replacement && post.source === 'Synthetic' && post.kind === 'ARTICLE')
			post.body = replacement.body
	}
	const commentMap = new Map(
		[...replacements.values()].flatMap((row) =>
			row.comments.map((c) => [c.id, c.body] as const),
		),
	)
	for (const comment of preset.comments)
		if (comment.source === 'Synthetic' && commentMap.has(comment.id))
			comment.body = commentMap.get(comment.id)!
	await writeSnapshotFile(
		'natural-v3.json',
		JSON.stringify(preset, null, '\t') + '\n',
	)
	await publishSnapshots()
	ready.appliedAt = new Date().toISOString()
	await writeContentCacheFile(path, JSON.stringify(ready, null, '\t') + '\n')
	const receipt = {
		at: ready.appliedAt,
		applied,
		skipped,
		commentCount: [...replacements.values()].reduce(
			(n, row) => n + row.comments.length,
			0,
		),
		lengths: [...replacements.values()].map((row) => ({
			id: row.id,
			length: Array.from(row.body.replace(/\s/g, '')).length,
		})),
		backup,
		budget: await readTaskBudget(),
		technicalSources: [
			'https://git-scm.com/docs/git-merge',
			'https://git-scm.com/docs/git-status',
		],
	}
	await writeContentCacheFile(
		join(directory, 'long-articles-receipt.json'),
		JSON.stringify(receipt, null, '\t') + '\n',
	)
	const bundle = await packContentCache()
	if (!bundle.cacheStateUpdated)
		throw Error('ARTICLE_ARCHIVE_COMMITTED_STATE_PENDING_STOP')
	console.log(JSON.stringify(receipt))
} else
	console.log(
		JSON.stringify({
			phase: 'checkpoint-only',
			path,
			posts: checkpoint.written.map((row) => ({
				id: row.id,
				length: Array.from(row.body.replace(/\s/g, '')).length,
			})),
			skipped: checkpoint.skipped,
		}),
	)
await db.$disconnect()
