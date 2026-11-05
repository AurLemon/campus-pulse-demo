import { readBody } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '@campus/domain/prisma'
import { api, objectBody, text, fail, campusName } from '../../utils/api'
import {
	authLimit,
	accountName,
	passwordText,
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
	const name = text(b.name, 'name', 40),
		campus = campusName(b.campus ?? '铜盘校区')
	if (await db.user.findUnique({ where: { account } }))
		fail('CONFLICT', 409, { account: 'ALREADY_EXISTS' })
	const passwordHash = await hashPassword(password)
	const u = await db.user
		.create({
			data: {
				id: randomUUID(),
				account,
				passwordHash,
				name,
				campus,
				bio: '',
				role: 'STUDENT',
				interests: '{}',
				source: 'Real',
				createdAt: new Date().toISOString(),
			},
		})
		.catch(() => fail('CONFLICT', 409, { account: 'ALREADY_EXISTS' }))
	await logout(event)
	await establishSession(event, u.id)
	return { user: publicUser(u) }
})
