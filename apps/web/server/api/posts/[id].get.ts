import { getRouterParam } from 'h3'
import { db } from '@campus/domain/prisma'
import { postView, publicUser } from '@campus/domain/views'
import { api, optionalActor, fail } from '../../utils/api'
export default api(async (event) => {
	const id = getRouterParam(event, 'id'),
		user = await optionalActor(event),
		p = await db.post.findUnique({ where: { id } })
	if (!p) fail('NOT_FOUND', 404)
	const comments = await db.comment.findMany({
		where: { postId: id },
		orderBy: { createdAt: 'asc' },
		take: 300,
	})
	const related = p.activityId
		? await db.post.findMany({
				where: { activityId: p.activityId, id: { not: id } },
				take: 6,
				orderBy: { createdAt: 'desc' },
			})
		: []
	return {
		post: await postView(p, user?.id),
		comments: await Promise.all(
			comments.map(async ({ source: _source, deletedAt, ...c }) => ({
				...c,
				body: deletedAt ? '' : c.body,
				mediaIds: deletedAt ? [] : JSON.parse(c.mediaIds),
				media: deletedAt
					? []
					: await db.mediaAsset.findMany({
							where: { id: { in: JSON.parse(c.mediaIds) } },
						}),
				deleted: !!deletedAt,
				author: publicUser(
					await db.user.findUniqueOrThrow({ where: { id: c.authorId } }),
				),
			})),
		),
		related: await Promise.all(related.map((r) => postView(r, user?.id))),
	}
})
