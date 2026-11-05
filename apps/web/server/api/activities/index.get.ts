import { randomUUID } from 'node:crypto'
import { getQuery } from 'h3'
import { db } from '@campus/domain/prisma'
import { activityView } from '@campus/domain/views'
import { loadSnapshot } from '@campus/domain/snapshot'
import { withGuest } from '@campus/domain/feed'
import {
	recommendActivities,
	EXPLORATION_STRENGTH,
} from '@campus/recommendation'
import { api, optionalActor } from '../../utils/api'
export default api(async (event) => {
	const q = getQuery(event),
		user = await optionalActor(event),
		snapshot = await loadSnapshot(),
		userId = withGuest(snapshot, user?.id)
	const ranked = recommendActivities({
		snapshot,
		userId,
		k: snapshot.activities.length,
		exploration: { seed: randomUUID(), strength: EXPLORATION_STRENGTH },
		now: snapshot.now,
	})
	const rows = await db.activity.findMany({ orderBy: { startsAt: 'asc' } })
	const sorted =
		q.all === '1'
			? rows
			: ranked.items.flatMap((r) => {
					const a = rows.find((a) => a.id === r.id)
					return a ? [a] : []
				})
	const filtered = sorted.filter(
		(a) =>
			(!q.campus || a.campus === q.campus) &&
			(!q.tag || (JSON.parse(a.tags) as string[]).includes(String(q.tag))) &&
			(!q.q || `${a.title} ${a.body}`.includes(String(q.q))),
	)
	return {
		items: await Promise.all(filtered.map((a) => activityView(a, user?.id))),
	}
})
