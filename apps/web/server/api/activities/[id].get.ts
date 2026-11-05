import { getRouterParam } from 'h3'
import { db } from '@campus/domain/prisma'
import { activityView, postView } from '@campus/domain/views'
import { api, optionalActor, fail } from '../../utils/api'
export default api(async (event) => {
	const id = getRouterParam(event, 'id'),
		user = await optionalActor(event),
		a = await db.activity.findUnique({ where: { id } })
	if (!a) fail('NOT_FOUND', 404)
	const posts = await db.post.findMany({
		where: { activityId: id },
		orderBy: { createdAt: 'desc' },
		take: 30,
	})
	return {
		activity: await activityView(a, user?.id),
		posts: await Promise.all(posts.map((p) => postView(p, user?.id))),
	}
})
