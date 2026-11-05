import { randomUUID } from 'node:crypto'
import { db } from '@campus/domain/prisma'
import { loadSnapshot } from '@campus/domain/snapshot'
import { publicUser, activityView } from '@campus/domain/views'
import { withGuest } from '@campus/domain/feed'
import {
	recommendActivities,
	EXPLORATION_STRENGTH,
} from '@campus/recommendation'
import { api, optionalActor } from '../utils/api'
export default api(async (event) => {
	const user = await optionalActor(event),
		now = new Date().toISOString(),
		snapshot = await loadSnapshot(now),
		userId = withGuest(snapshot, user?.id)
	const recommendations = recommendActivities({
		snapshot,
		userId,
		k: 3,
		now,
		exploration: { seed: randomUUID(), strength: EXPLORATION_STRENGTH },
	})
	const rows = await db.activity.findMany({
		where: { id: { in: recommendations.items.map((i) => i.id) } },
	})
	const own = user
		? await db.state.findMany({ where: { userId: user.id } })
		: []
	const schedule = user
		? await db.activity.findMany({
				where: {
					State_activityId: { some: { userId: user.id, kind: 'REGISTER' } },
					status: 'PUBLISHED',
					endsAt: { gt: now },
				},
				orderBy: { startsAt: 'asc' },
				take: 3,
			})
		: []
	return {
		user: user ? publicUser(user) : null,
		counts: {
			registrations: own.filter((s) => s.kind === 'REGISTER').length,
			favorites: own.filter((s) => s.kind === 'FAVORITE').length,
			posts: user ? await db.post.count({ where: { authorId: user.id } }) : 0,
		},
		schedule: await Promise.all(schedule.map((a) => activityView(a, user?.id))),
		recommendations: await Promise.all(
			recommendations.items.flatMap((r) => {
				const a = rows.find((a) => a.id === r.id)
				return a ? [activityView(a, user?.id)] : []
			}),
		),
		interests: user ? JSON.parse(user.interests) : {},
	}
})
