import { runWritingBatch } from './budget.ts'
export interface WrittenActivity {
	id: string
	title: string
	body: string
}
export interface WrittenPost {
	id: string
	title: string
	body: string
	comments: Array<{ body: string; reply: string | null }>
}
export function parseJson<T>(text: string): T {
	const clean = text
		.trim()
		.replace(/^```(?:json)?\s*/, '')
		.replace(/\s*```$/, '')
	return JSON.parse(clean) as T
}
export async function parseWritingJson<T>(
	id: string,
	text: string,
): Promise<T> {
	try {
		return parseJson<T>(text)
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		const repaired = await runWritingBatch(
			`${id}-json-repair-v1`,
			`只输出原文中的完整JSON，不要代码围栏、解释或任何前后缀。仅修复JSON语法或移除解释，不新增、删减、改写数据字段和文字。原文：${text}`,
		)
		return parseJson<T>(repaired)
	}
}
export async function writeActivities(
	id: string,
	plans: Array<{ id: string; topic: string; location: string; voice: string }>,
) {
	const text = await runWritingBatch(
		id,
		`输出严格JSON数组，不加解释。为虚构校园社区生成Synthetic活动文案，不使用真实组织/学校背书，不含电话二维码。每条保留id，仅输出{id,title,body}。title最多22汉字，body50-100字，提供具体活动方式、参加条件和注意事项，地点按计划，不编造时间名额，结构化字段另由程序提供。每个活动说话方式不同，禁止运营套话、·、省略号。计划：${JSON.stringify(plans)}`,
	)
	const items = await parseWritingJson<WrittenActivity[]>(id, text)
	if (
		!Array.isArray(items) ||
		items.length !== plans.length ||
		items.some(
			(a, i) =>
				a.id !== plans[i]?.id ||
				typeof a.title !== 'string' ||
				!a.title ||
				typeof a.body !== 'string' ||
				a.body.length < 25,
		)
	)
		throw new Error('ACTIVITY_CONTENT_INVALID')
	return items
}
export async function writePosts(
	id: string,
	plans: Array<{
		id: string
		topic: string
		intent: string
		voice: string
		activity?: string
		comments: number
		replies: number
	}>,
) {
	const text = await runWritingBatch(
		id,
		`只输出严格JSON数组。为Synthetic虚构校园社区写${plans.length}条有差异的帖子和上下文评论。保留id，输出每条{id,title,body,comments:[{body,reply}]}。帖子title8-22字，body40-100汉字，comments数量严格按计划，评论body8-25字。reply为8-25字的作者回复或null，每帖非null的reply数量必须等于计划replies，仅第一条评论可有reply，其余reply=null，保留追问和未答复。评论必须针对本帖具体内容，不能全是赞同。所有人不必文笔流畅，不照抄模板，不用真实组织电话，不编造活动的具体时间地点名额，不用·或省略号。人物voice务必稳定，评论者按commentVoices顺序表达，作者回复沿用作者voice。计划：${JSON.stringify(plans)}`,
	)
	const items = await parseWritingJson<WrittenPost[]>(id, text)
	// Omitted optional replies mean no reply, not extra generated content.
	if (Array.isArray(items))
		for (const post of items)
			if (Array.isArray(post.comments))
				for (const [index, comment] of post.comments.entries())
					if (comment.reply === undefined || index > 0) comment.reply = null
	// 仅对缺失的计划回复进行一次有上下文的补写，不重写整批合格正文。
	if (Array.isArray(items) && items.length === plans.length) {
		const missing = items.filter(
			(post, index) =>
				post.id === plans[index]?.id &&
				Array.isArray(post.comments) &&
				post.comments.length === plans[index]?.comments &&
				plans[index]?.replies === 1 &&
				post.comments.length > 0 &&
				post.comments.every((comment) => comment.reply === null),
		)
		if (missing.length) {
			const patches = await parseWritingJson<
				Array<{ id: string; reply: string }>
			>(
				`${id}-missing-replies-v1`,
				await runWritingBatch(
					`${id}-missing-replies-v1`,
					`只输出JSON数组[{id,reply}]，为以下Synthetic帖子各补一条8-25汉字作者回复，明确回应第一条评论，保留作者voice，不重复空话，不用·或省略号。不得更改id。${JSON.stringify(missing.map((post) => ({ id: post.id, title: post.title, body: post.body, comment: post.comments[0]!.body, voice: plans.find((plan) => plan.id === post.id)?.voice })))}`,
				),
			)
			if (!Array.isArray(patches) || patches.length !== missing.length)
				throw new Error('REPLY_REPAIR_INVALID')
			for (const post of missing) {
				const patch = patches.find((patch) => patch.id === post.id)
				if (
					!patch ||
					typeof patch.reply !== 'string' ||
					patch.reply.length < 2 ||
					patch.reply.length > 100
				)
					throw new Error('REPLY_REPAIR_INVALID')
				post.comments[0]!.reply = patch.reply
			}
		}
	}
	if (
		!Array.isArray(items) ||
		items.length !== plans.length ||
		items.some(
			(p, i) =>
				p.id !== plans[i]?.id ||
				!p.title ||
				typeof p.body !== 'string' ||
				p.body.length < 20 ||
				!Array.isArray(p.comments) ||
				p.comments.length !== plans[i]?.comments ||
				p.comments.filter((c) => c.reply !== null).length !==
					plans[i]?.replies ||
				p.comments.some(
					(c) =>
						typeof c.body !== 'string' ||
						c.body.length < 2 ||
						(c.reply !== null && typeof c.reply !== 'string'),
				),
		)
	)
		throw new Error('POST_CONTENT_INVALID')
	return items
}
