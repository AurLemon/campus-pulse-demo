import type { PrismaClient } from '../../generated/prisma/client.ts'
import type { Snapshot } from '@campus/contracts'

/** Server-only algorithm input. Never return this to a product client. */
export async function readSnapshot(
	db: PrismaClient,
	now = new Date().toISOString(),
): Promise<Snapshot> {
	const [
		users,
		activities,
		posts,
		comments,
		friendships,
		follows,
		states,
		behaviors,
		sessions,
	] = await db.$transaction([
		db.user.findMany(),
		db.activity.findMany(),
		db.post.findMany(),
		db.comment.findMany({ where: { deletedAt: null } }),
		db.friendship.findMany(),
		db.follow.findMany(),
		db.state.findMany(),
		db.behavior.findMany(),
		db.viewSession.findMany(),
	])
	return {
		version: 'campus-product-v1',
		source: 'Real',
		seed: 0,
		now,
		users: users.map(
			({ account: _account, passwordHash: _passwordHash, ...u }) => ({
				...u,
				interests: JSON.parse(u.interests),
			}),
		),
		activities: activities.map((a) => ({ ...a, tags: JSON.parse(a.tags) })),
		posts: posts.map((p) => ({
			...p,
			tags: JSON.parse(p.tags),
			mediaIds: JSON.parse(p.mediaIds),
		})),
		comments: comments.map((c) => ({ ...c, mediaIds: JSON.parse(c.mediaIds) })),
		friendships,
		follows,
		states,
		behaviors,
		sessions,
	} as Snapshot
}
