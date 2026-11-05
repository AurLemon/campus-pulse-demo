import { getRouterParam, getQuery } from 'h3'
import { db } from '@campus/domain/prisma'
import { publicUser, postView, activityView } from '@campus/domain/views'
import { api, optionalActor, fail } from '../../utils/api'
export default api(async (event) => {
	const id = getRouterParam(event, 'id'),
		viewer = await optionalActor(event),
		user = await db.user.findUnique({ where: { id } }),
		q = getQuery(event)
	if (!user) fail('NOT_FOUND', 404)
	const own = viewer?.id === id
	if (q.tab && q.tab !== 'posts' && !own) fail('FORBIDDEN', 403)
	const posts = await db.post.findMany({
		where:
			q.tab === 'favorites'
				? { State_postId: { some: { userId: id, kind: 'FAVORITE' } } }
				: { authorId: id },
		orderBy: { createdAt: 'desc' },
		take: 100,
	})
	const activities = own
		? await db.activity.findMany({
				where: {
					State_activityId: {
						some: {
							userId: id,
							kind: q.tab === 'favorites' ? 'FAVORITE' : 'REGISTER',
						},
					},
				},
				orderBy: { startsAt: 'asc' },
			})
		: []

	const friendship = viewer
		? await db.friendship.findFirst({
				where: {
					OR: [
						{ requesterId: viewer.id, recipientId: id },
						{ requesterId: id, recipientId: viewer.id },
					],
				},
			})
		: null
	const following = viewer
		? !!(await db.follow.findFirst({
				where: { followerId: viewer.id, followingId: id },
			}))
		: false
	const requests = own
		? await db.friendship.findMany({
				where: { recipientId: id, status: 'PENDING' },
			})
		: []
	return {
		user: publicUser(user),
		posts: await Promise.all(posts.map((p) => postView(p, viewer?.id))),
		activities: await Promise.all(
			activities.map((a) => activityView(a, viewer?.id)),
		),
		relationship: { following, friendship },
		requests: await Promise.all(
			requests.map(async (r) => ({
				...r,
				requester: publicUser(
					await db.user.findUniqueOrThrow({ where: { id: r.requesterId } }),
				),
			})),
		),
	}
})
