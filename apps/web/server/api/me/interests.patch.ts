import { readBody } from 'h3'
import { db } from '@campus/domain/prisma'
import { publicUser } from '@campus/domain/views'
import { api, actor, objectBody, fail } from '../../utils/api'
export default api(async (event) => {
	const user = await actor(event),
		b = objectBody(await readBody(event)),
		interests = objectBody(b.interests)
	if (
		Object.keys(interests).length > 30 ||
		Object.entries(interests).some(
			([k, v]) =>
				!k ||
				k.length > 24 ||
				typeof v !== 'number' ||
				!Number.isFinite(v) ||
				v < 0 ||
				v > 1,
		)
	)
		fail('VALIDATION_FAILED', 422, { interests: 'INVALID_FIELD' })
	return {
		user: publicUser(
			await db.user.update({
				where: { id: user.id },
				data: { interests: JSON.stringify(interests) },
			}),
		),
	}
})
