import { getQuery } from 'h3'
import { api, optionalActor, fail } from '../utils/api'
import { feed } from '@campus/domain/feed'
export default api(async (event) => {
	const q = getQuery(event),
		user = await optionalActor(event),
		tab = String(q.tab ?? 'recommended'),
		limit = Number(q.limit ?? 18)
	if (
		!['recommended', 'following'].includes(tab) ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 36 ||
		String(q.q ?? '').length > 120 ||
		String(q.cursor ?? '').length > 500
	)
		fail('VALIDATION_FAILED', 422)
	return feed({
		userId: user?.id,
		tab,
		q: String(q.q ?? ''),
		tag: String(q.tag ?? ''),
		cursor: q.cursor ? String(q.cursor) : undefined,
		limit,
	})
})
