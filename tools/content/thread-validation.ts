/** Shared structural validation for the offline DS writer and reviewed publication. */
import { validateAgentText } from '../../packages/domain/agent-access.ts'
export interface WrittenThread {
	postId: string
	title: string
	body: string
	comments: Array<{ id: string; body: string }>
}
export interface ThreadAssignmentLike {
	post: { id: string }
	comments: Array<{ id: string }>
	factId: string | null
}
function normalizePunctuation(value: string) {
	return value
		.split(/(```[\s\S]*?```|`[^`]*`|https?:\/\/[^\s。！？]+)/g)
		.map((part) =>
			part.startsWith('`')
				? part
				: part.startsWith('http')
					? part.replace(/\.+$/, '')
					: part.replace(/。/g, '\n').replace(/\.+(?=\s|$)/g, ''),
		)
		.join('')
		.trim()
}
export function validateWrittenThread(
	assignment: ThreadAssignmentLike,
	input: unknown,
): WrittenThread {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw new Error('STRUCTURE: expected one JSON object')
	const value = input as Record<string, unknown>
	if (
		Object.keys(value).some(
			(key) => !['postId', 'title', 'body', 'comments'].includes(key),
		)
	)
		throw new Error(
			'STRUCTURE: return only postId/title/body/comments, never author/topic/attachment/original or other input metadata',
		)
	if (value.postId !== assignment.post.id)
		throw new Error(`STRUCTURE: postId must equal ${assignment.post.id}`)
	const text = (body: unknown, field: string, max: number) => {
		if (typeof body !== 'string' || !body.trim())
			throw new Error(`STRUCTURE: ${field} must be a non-empty string`)
		const normalized = normalizePunctuation(body)
		if (!normalized || normalized.length > max)
			throw new Error(`STRUCTURE: ${field} must contain 1-${max} characters`)
		return validateAgentText(normalized, max)
	}
	const title = text(value.title, 'title', 120),
		body = text(value.body, 'body', 20000)
	if (
		!Array.isArray(value.comments) ||
		value.comments.length !== assignment.comments.length
	)
		throw new Error(
			`STRUCTURE: comments must contain exactly ${assignment.comments.length} entries`,
		)
	const comments = value.comments.map((comment: unknown) => {
		if (!comment || typeof comment !== 'object' || Array.isArray(comment))
			throw new Error('STRUCTURE: each comment must be {id,body}')
		const row = comment as Record<string, unknown>
		if (
			Object.keys(row).some((key) => !['id', 'body'].includes(key)) ||
			typeof row.id !== 'string'
		)
			throw new Error(
				'STRUCTURE: each comment contains only string id and non-empty string body',
			)
		return {
			id: row.id,
			body: text(row.body, `comments[${row.id}].body`, 2000),
		}
	})
	if (
		new Set(comments.map((c) => c.id)).size !== assignment.comments.length ||
		assignment.comments.some((c) => !comments.some((v) => v.id === c.id))
	)
		throw new Error(
			`STRUCTURE: comment ids must appear exactly once: ${assignment.comments.map((c) => c.id).join(',')}`,
		)
	if (
		!assignment.factId &&
		/如图|截图里|这张图|图片里|图中|看图|见图|附图|报错截图|照片里/.test(
			title + '\n' + body + '\n' + comments.map((c) => c.body).join('\n'),
		)
	)
		throw new Error(
			'CONTENT: no attachment is present, remove claims referring to an attached image or screenshot',
		)
	const prose = [title, body, ...comments.map((comment) => comment.body)]
		.join('\n')
		.replace(/```[\s\S]*?```|`[^`]*`/g, '')
	if (
		/合成演示图|不是真实校园实拍|非真实校园实拍|(?:这(?:张|幅|组|些)?|本)(?:照片|图片|配图|图|截图).{0,12}(?:AI生成|AI合成|模型生成|合成素材)|(?:照片|图片|配图)(?:是|为)(?:合成|AI生成)|(?:按照|根据|遵循)(?:给定的|上述|内部)?(?:人物设定|角色设定|系统提示词|verifiedFacts)|(?:来源|source)[：:]?\s*(?:Synthetic|Generated)/i.test(
			prose,
		)
	)
		throw new Error(
			'CONTENT: remove internal image provenance or generation/prompt metadata from public text; do not append a synthetic/AI-generated disclaimer',
		)
	return { postId: assignment.post.id, title, body, comments }
}
