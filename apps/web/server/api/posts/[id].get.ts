import { getRouterParam } from 'h3'
import { db } from '@campus/domain/prisma'
import { postView } from '@campus/domain/views'
import { api, optionalActor, fail } from '../../utils/api'
import { listPostComments } from '@campus/domain/services/comment.service'
export default api(async (event) => {
	const id = getRouterParam(event, 'id'),
		user = await optionalActor(event),
		p = await db.post.findUnique({ where: { id } })
	if (!p) fail('NOT_FOUND', 404)
	const related = p.activityId
		? await db.post.findMany({
				where: { activityId: p.activityId, id: { not: id } },
				take: 6,
				orderBy: { createdAt: 'desc' },
			})
		: []
	return {
		post: await postView(p, user?.id),
		comments: await listPostComments(p.id, user?.id),
		related: await Promise.all(related.map((r) => postView(r, user?.id))),
	}
})
