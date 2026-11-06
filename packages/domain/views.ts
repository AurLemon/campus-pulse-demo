import { db } from './prisma.ts'
import { defaultUserAvatar } from '@campus/contracts'
import type {
	PublicUser,
	ActivityView,
	PostView,
	MediaAsset,
	Recommendation,
} from '@campus/contracts'

type UserRow = Awaited<ReturnType<typeof db.user.findFirstOrThrow>>
type ActivityRow = Awaited<ReturnType<typeof db.activity.findFirstOrThrow>>
type PostRow = Awaited<ReturnType<typeof db.post.findFirstOrThrow>>
export function publicUser(
	u: UserRow & { avatar?: string | null },
): PublicUser {
	return {
		id: u.id,
		name: u.name,
		avatar: u.avatar || defaultUserAvatar(u.id),
		bio: u.bio,
		campus: u.campus,
		role: u.role as PublicUser['role'],
		interests: JSON.parse(u.interests),
		createdAt: u.createdAt,
	}
}
export async function activityView(
	a: ActivityRow,
	userId?: string,
): Promise<ActivityView> {
	const [organizer, cover, registrations, favorites, own] = await Promise.all([
		db.user.findUniqueOrThrow({ where: { id: a.organizerId } }),
		a.coverId ? db.mediaAsset.findUnique({ where: { id: a.coverId } }) : null,
		db.state.count({ where: { activityId: a.id, kind: 'REGISTER' } }),
		db.state.count({ where: { activityId: a.id, kind: 'FAVORITE' } }),
		userId ? db.state.findMany({ where: { activityId: a.id, userId } }) : [],
	])
	const now = new Date().toISOString()
	const availability =
		a.status === 'CANCELLED'
			? 'CANCELLED'
			: a.endsAt <= now
				? 'ENDED'
				: a.startsAt <= now || a.deadline <= now
					? 'CLOSED'
					: registrations >= a.capacity
						? 'FULL'
						: 'OPEN'
	const { source: _source, ...visible } = a
	return {
		...visible,
		status: a.status as ActivityView['status'],
		posterTemplate: a.posterTemplate as ActivityView['posterTemplate'],
		posterAspect: a.posterAspect as ActivityView['posterAspect'],
		tags: JSON.parse(a.tags),
		organizer: publicUser(organizer),
		cover: cover as MediaAsset | null,
		stats: { registrations, favorites },
		viewer: {
			registered: own.some((s) => s.kind === 'REGISTER'),
			favorited: own.some((s) => s.kind === 'FAVORITE'),
		},
		availability,
	}
}
export async function postView(
	p: PostRow,
	userId?: string,
	recommendation?: Recommendation,
): Promise<PostView> {
	const ids: string[] = JSON.parse(p.mediaIds)
	const [author, activity, assets, likes, favorites, comments, own] =
		await Promise.all([
			db.user.findUniqueOrThrow({ where: { id: p.authorId } }),
			p.activityId
				? db.activity.findUnique({ where: { id: p.activityId } })
				: null,
			db.mediaAsset.findMany({ where: { id: { in: ids } } }),
			db.state.count({ where: { postId: p.id, kind: 'LIKE' } }),
			db.state.count({ where: { postId: p.id, kind: 'FAVORITE' } }),
			db.comment.count({ where: { postId: p.id, deletedAt: null } }),
			userId ? db.state.findMany({ where: { postId: p.id, userId } }) : [],
		])
	const linked = activity ? await activityView(activity, userId) : null
	const media = ids.flatMap((id) => {
		const m = assets.find((a) => a.id === id)
		return m ? [m as MediaAsset] : []
	})
	const reason = recommendation?.matchedTags.length
		? `与你的兴趣有关`
		: recommendation?.friendIds.length
			? '好友也在关注'
			: undefined
	const { source: _source, ...visible } = p
	return {
		...visible,
		kind: p.kind as PostView['kind'],
		posterTemplate: p.posterTemplate as PostView['posterTemplate'],
		posterAspect: p.posterAspect as PostView['posterAspect'],
		purpose: p.purpose as PostView['purpose'],
		tags: JSON.parse(p.tags),
		mediaIds: ids,
		author: publicUser(author),
		activity: linked,
		media,
		stats: { likes, favorites, comments },
		viewer: {
			liked: own.some((s) => s.kind === 'LIKE'),
			favorited: own.some((s) => s.kind === 'FAVORITE'),
		},
		reason,
	}
}
