import { defaultUserAvatar } from '@campus/contracts'
import { db } from '@campus/domain/prisma'
import { api } from '../utils/api'

export default api(async () => {
	const users = await db.user.findMany({ select: { id: true, name: true } })
	return users.map((user) => ({ ...user, avatar: defaultUserAvatar(user.id) }))
})
