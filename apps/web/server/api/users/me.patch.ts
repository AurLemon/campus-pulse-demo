import { readBody } from 'h3'
import { db } from '@campus/domain/prisma'
import { publicUser } from '@campus/domain/views'
import { api, actor, objectBody, text, campusName, fail } from '../../utils/api'
export default api(async (event) => {
	const user = await actor(event),
		body = objectBody(await readBody(event))
	const keys = Object.keys(body)
	if (
		!keys.length ||
		keys.some((key) => !['name', 'bio', 'campus'].includes(key))
	)
		fail('VALIDATION_FAILED', 422)
	const data: { name?: string; bio?: string; campus?: string } = {}
	if ('name' in body) data.name = text(body.name, 'name', 40)
	if ('bio' in body) data.bio = text(body.bio, 'bio', 300, 0)
	if ('campus' in body) data.campus = campusName(body.campus)
	return {
		user: publicUser(await db.user.update({ where: { id: user.id }, data })),
	}
})
