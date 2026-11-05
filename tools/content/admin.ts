import { provisionAdministrator, assignRole } from '@campus/domain/admin'
import { db } from '@campus/domain/prisma'

const command = process.argv[2] ?? 'create'
try {
	const account = process.env.CAMPUS_ADMIN_ACCOUNT
	if (!account) throw new Error('CAMPUS_ADMIN_ACCOUNT_REQUIRED')
	if (command === 'create') {
		const password = process.env.CAMPUS_ADMIN_PASSWORD,
			name = process.env.CAMPUS_ADMIN_NAME,
			campus = process.env.CAMPUS_ADMIN_CAMPUS
		if (!password || !name || !campus)
			throw new Error('CAMPUS_ADMIN_PASSWORD_NAME_CAMPUS_REQUIRED')
		const user = await provisionAdministrator({
			account,
			password,
			name,
			campus,
		})
		console.log(JSON.stringify({ id: user.id, account, role: user.role }))
	} else if (command === 'role') {
		const role = process.env.CAMPUS_ACCOUNT_ROLE
		if (role !== 'STUDENT' && role !== 'ORGANIZER' && role !== 'ADMIN')
			throw new Error('CAMPUS_ACCOUNT_ROLE_INVALID')
		const user = await assignRole(account, role)
		console.log(JSON.stringify({ id: user.id, account, role: user.role }))
	} else throw new Error('COMMAND_MUST_BE_CREATE_OR_ROLE')
} catch (error) {
	console.error(
		error instanceof Error ? error.message : 'ADMIN_OPERATION_FAILED',
	)
	process.exitCode = 1
} finally {
	await db.$disconnect()
}
