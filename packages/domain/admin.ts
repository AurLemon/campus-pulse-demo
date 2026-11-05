import { randomUUID } from 'node:crypto'
import { db } from './prisma.ts'
import { accountName, passwordText, hashPassword } from './auth.ts'
import { publicUser } from './views.ts'
import { text, campusName } from './validation.ts'

/** Local provisioning only. Never imported by a public registration endpoint. */
export async function provisionAdministrator(input: {
	account: string
	password: string
	name: string
	campus: string
}) {
	const account = accountName(input.account),
		passwordHash = await hashPassword(passwordText(input.password))
	if (await db.user.findUnique({ where: { account } }))
		throw new Error('ACCOUNT_ALREADY_EXISTS')
	return publicUser(
		await db.user.create({
			data: {
				id: randomUUID(),
				account,
				passwordHash,
				name: text(input.name, 'name', 40),
				campus: campusName(input.campus),
				bio: '',
				role: 'ADMIN',
				interests: '{}',
				createdAt: new Date().toISOString(),
				source: 'Real',
			},
		}),
	)
}
export async function assignRole(
	account: string,
	role: 'STUDENT' | 'ORGANIZER' | 'ADMIN',
) {
	if (!['STUDENT', 'ORGANIZER', 'ADMIN'].includes(role))
		throw new Error('INVALID_ROLE')
	return publicUser(
		await db.user.update({
			where: { account: accountName(account) },
			data: { role },
		}),
	)
}
