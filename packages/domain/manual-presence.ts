import { db } from './prisma.ts'
/** Any valid browser login owns the account until that session expires or is explicitly logged out. Public online presence is independent. */
export async function isHumanControlled(userId: string) {
	return (
		(await db.authSession.count({
			where: { userId, expiresAt: { gt: new Date().toISOString() } },
		})) > 0
	)
}
export async function humanControlledActorIds() {
	const sessions = await db.authSession.findMany({
		where: { expiresAt: { gt: new Date().toISOString() } },
		distinct: ['userId'],
		select: { userId: true },
	})
	return sessions.map((session) => session.userId)
}
