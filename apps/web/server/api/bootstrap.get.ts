import { CAMPUSES } from '@campus/contracts'
import { db } from '@campus/domain/prisma'
import { api, optionalActor } from '../utils/api'
import { publicUser } from '@campus/domain/views'
export default api(async (event) => {
	const user = await optionalActor(event)
	const [activities, posts] = await Promise.all([
		db.activity.findMany({ select: { tags: true, campus: true } }),
		db.post.findMany({ select: { tags: true } }),
	])
	return {
		user: user ? publicUser(user) : null,
		topics: [
			...new Set(
				[...activities, ...posts].flatMap(
					(p) => JSON.parse(p.tags) as string[],
				),
			),
		].sort(),
		campuses: [...CAMPUSES],
	}
})
