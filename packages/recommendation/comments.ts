import type { CommentView } from '@campus/contracts'

export interface CommentRank {
	comment: CommentView
	score: number
}

/** Rank roots by diminishing social evidence and age. Replies retain thread order. */
export function rankComments(
	comments: CommentView[],
	now: number,
	sort: 'popular' | 'latest' = 'popular',
): CommentView[] {
	const replies = new Map<string, CommentView[]>()
	for (const comment of comments) {
		if (!comment.parentId) continue
		const group = replies.get(comment.parentId) ?? []
		group.push(comment)
		replies.set(comment.parentId, group)
	}
	const ranked: CommentRank[] = comments
		.filter((comment) => !comment.parentId)
		.map((comment) => {
			const group = (replies.get(comment.id) ?? []).filter(
				(reply) => !reply.deleted,
			)
			const people = new Set(
				group
					.filter((reply) => reply.authorId !== comment.authorId)
					.map((reply) => reply.authorId),
			).size
			const likes =
				(comment.stats?.likes ?? 0) +
				group.reduce((sum, reply) => sum + (reply.stats?.likes ?? 0), 0) * 0.25
			const ageHours = Math.max(
				0,
				(now - Date.parse(comment.createdAt)) / 3_600_000,
			)
			const score =
				(1 +
					2 * Math.log1p(likes) +
					0.5 * Math.log1p(group.length) +
					2 * Math.log1p(people)) /
				Math.pow(2 + ageHours, 0.35)
			return { comment, score: comment.deleted ? 0 : score }
		})
	return ranked
		.sort(
			(a, b) =>
				(sort === 'popular' ? b.score - a.score : 0) ||
				b.comment.createdAt.localeCompare(a.comment.createdAt) ||
				a.comment.id.localeCompare(b.comment.id),
		)
		.map(({ comment }) => comment)
}
