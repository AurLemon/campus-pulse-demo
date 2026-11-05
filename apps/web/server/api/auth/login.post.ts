import { readBody } from 'h3'
import { db } from '@campus/domain/prisma'
import { api, objectBody, fail } from '../../utils/api'
import {
	authLimit,
	accountName,
	passwordText,
	verifyPassword,
	hashPassword,
	establishSession,
	logout,
} from '@campus/domain/auth'
import { publicUser } from '@campus/domain/views'
export default api(async (event) => {
	authLimit(event)
	const b = objectBody(await readBody(event)),
		account = accountName(b.account),
		password = passwordText(b.password)
	const user = await db.user.findUnique({ where: { account } })
	const valid = user?.passwordHash
		? await verifyPassword(password, user.passwordHash)
		: await verifyPassword(password, await hashPassword('unavailable-account'))
	if (!user || !user.passwordHash || !valid) fail('UNAUTHORIZED', 401)
	await logout(event)
	await establishSession(event, user.id)
	return { user: publicUser(user) }
})
