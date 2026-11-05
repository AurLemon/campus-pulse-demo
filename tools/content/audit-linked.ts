import { join } from 'node:path'
import { ensureContentCache } from './bundle.ts'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { runWritingBatch } from './budget.ts'
import { parseWritingJson } from './model-content.ts'
import type { WrittenPost, WrittenActivity } from './model-content.ts'
import { linkedActivityIndex } from './plans.ts'

interface Patch extends WrittenPost {
	reason: string
}
if (process.argv.includes('--dry-run') || !process.argv.includes('--run')) {
	console.log(
		JSON.stringify({
			mode: 'dry-run',
			action: 'audit-linked',
			cacheOpened: false,
		}),
	)
	process.exit(0)
}
const contentCache = await ensureContentCache()
const files = (await readdir(contentCache)).filter((file) =>
	/^full-posts-.*\.json$/.test(file),
)
const batches = await Promise.all(
	files.map(async (file) => ({
		file,
		posts: JSON.parse(
			await readFile(join(contentCache, file), 'utf8'),
		) as WrittenPost[],
	})),
)
const activities = (
	await Promise.all(
		Array.from({ length: 20 }, (_, index) =>
			readFile(
				join(contentCache, `full-activities-${index * 6}.json`),
				'utf8',
			).then((text) => JSON.parse(text) as WrittenActivity[]),
		),
	)
).flat()
const linked = batches
	.flatMap((batch) => batch.posts.map((post) => ({ batch, post })))
	.filter(
		({ post }) =>
			linkedActivityIndex(Number(post.id.slice(1)) - 1, 120) !== null,
	)
	.sort((a, b) => Number(a.post.id.slice(1)) - Number(b.post.id.slice(1)))

if (linked.length !== 480) throw new Error('FULL_LINKED_CONTENT_REQUIRED')
const findings: Patch[] = []
for (let offset = 0; offset < linked.length; offset += 12) {
	const group = linked.slice(offset, offset + 12)
	const id = `full-linked-semantic-audit-${offset}-v1`
	const plans = group.map(({ post }) => {
		const index = Number(post.id.slice(1)) - 1
		const activityIndex = linkedActivityIndex(index, 120)!
		return {
			post,
			activity: activities[activityIndex],
			authorRole:
				index < 120
					? '本场组织者，正式招募通知，发帖在举办前'
					: '普通参与者/关注者，不能代替主办方决定本场流程',
			phase:
				activityIndex > 5 && activityIndex % 29 === 0
					? '本场已取消，不得声称参加过本场'
					: activityIndex % 3 === 2
						? index < 120
							? '历史正式通知，但发帖时未举办。评论可发生在举办后。'
							: '本场已结束，关联讨论在结束后发布。'
						: '本场尚未举办，不得声称参加过本场。',
			knownIssue:
				post.id === 'p62'
					? '活动要求每人带自己不满意的文章并静读15分钟。原帖同一本书读完再来及回复第8次是同一本书读8次均错误，修正相关评论。'
					: post.id === 'p208'
						? '本场a30已取消，原文却称上次举办且评论说参加过，需改成取消前准备或替代读写搭子，保留无冲突评论。'
						: undefined,
		}
	})
	const text = await runWritingBatch(
		id,
		`只输出严格JSON数组。审查下面Synthetic关联讨论与活动要求的一致性，仅返回明确有问题的帖子完整修订[{id,title,body,comments:[{body,reply}],reason}]，无问题返回[]，不要强行修改用词、文风或普通举例。明确问题仅限：与activity.body的参与条件/方式/时长冲突，正式通知把本场写成已举办，未来/取消活动冒称参加过本场，普通参与者宣布本场主办流程或代替主办者定条件。参与者可以分享个人经验、提出建议/疑问、另找私人搭子，但不能冒充本场组织者。活动时间地点容量有确定结构字段，不得写未定/不设名额/人齐再商量，具体数值不用编，必要时提示见关联活动详情。修订尽量保留原正文及无冲突评论，只有明确冲突评论才修改，不准改id，不准增加删除评论，非null回复数量和位置保持原样。reason简述实际冲突。不要用分号、·、省略号，不出现真实联系方式。${JSON.stringify(plans)}`,
	)
	const patches = await parseWritingJson<Patch[]>(id, text)
	if (
		!Array.isArray(patches) ||
		new Set(patches.map((patch) => patch.id)).size !== patches.length
	)
		throw new Error('SEMANTIC_AUDIT_INVALID')
	const missingReplies = patches.flatMap((patch) => {
		const original = group.find(({ post }) => post.id === patch.id)?.post
		if (
			!original ||
			!Array.isArray(patch.comments) ||
			patch.comments.length !== original.comments.length
		)
			return []
		for (const [index, comment] of patch.comments.entries())
			if (index > 0 || comment.reply === undefined) comment.reply = null
		return original.comments[0]?.reply && patch.comments[0]?.reply === null
			? [
					{
						id: patch.id,
						body: patch.body,
						comment: patch.comments[0].body,
						activity: plans.find((plan) => plan.post.id === patch.id)?.activity,
					},
				]
			: []
	})
	if (missingReplies.length) {
		const replyId = `${id}-missing-replies-v1`
		const replies = await parseWritingJson<
			Array<{ id: string; reply: string }>
		>(
			replyId,
			await runWritingBatch(
				replyId,
				`只输出JSON数组[{id,reply}]。为以下Synthetic修订帖子补作者对第一条评论的8-40字回复，以修订后正文和活动要求为准，不能违反到场条件或越权宣布本场规则。保留id，不输出其他解释。${JSON.stringify(missingReplies)}`,
			),
		)
		for (const missing of missingReplies) {
			const reply = replies.find((reply) => reply.id === missing.id)?.reply
			if (typeof reply !== 'string' || reply.length < 2)
				throw new Error('SEMANTIC_REPLY_INVALID')
			patches.find((patch) => patch.id === missing.id)!.comments[0]!.reply =
				reply
		}
	}
	for (const patch of patches) {
		const item = group.find(({ post }) => post.id === patch.id)
		if (
			!item ||
			typeof patch.reason !== 'string' ||
			!patch.reason ||
			typeof patch.title !== 'string' ||
			!patch.title ||
			typeof patch.body !== 'string' ||
			patch.body.length < 20 ||
			!Array.isArray(patch.comments) ||
			patch.comments.length !== item.post.comments.length ||
			patch.comments.some(
				(comment, index) =>
					typeof comment.body !== 'string' ||
					comment.body.length < 2 ||
					(item.post.comments[index]!.reply === null
						? comment.reply !== null
						: typeof comment.reply !== 'string'),
			)
		)
			throw new Error(`SEMANTIC_PATCH_INVALID:${patch.id}`)
		findings.push(patch)
	}
	await writeFile(
		'.data/data-generation/semantic-audit-findings.json',
		JSON.stringify(
			{ examinedPosts: Math.min(linked.length, offset + 12), findings },
			null,
			'\t',
		),
		{ mode: 0o600 },
	)
	console.log(
		JSON.stringify({
			phase: 'semantic-audit',
			examined: Math.min(linked.length, offset + 12),
			total: linked.length,
			proposed: findings.length,
		}),
	)
}
