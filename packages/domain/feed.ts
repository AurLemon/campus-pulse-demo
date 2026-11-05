import { randomBytes } from 'node:crypto'
import { db } from './prisma.ts'
import { loadSnapshot } from './snapshot.ts'
import { postView } from './views.ts'
import { fail } from './validation.ts'
import { recommendPosts, EXPLORATION_STRENGTH } from '@campus/recommendation'
import type { Snapshot, FeedPage, Recommendation } from '@campus/contracts'
interface FeedSession {
	owner: string
	key: string
	expires: number
	ids: string[]
	reasons: Map<string, Recommendation>
	newestAt: string | null
}
const sessions = new Map<string, FeedSession>()
const sessionLifetime = 30 * 60000
const anonymous = {
	id: 'guest',
	name: '',
	bio: '',
	campus: '',
	role: 'STUDENT' as const,
	interests: {},
	createdAt: new Date(0).toISOString(),
	source: 'Real' as const,
}
export function withGuest(snapshot: Snapshot, userId?: string) {
	if (!userId) snapshot.users.push(anonymous)
	return userId ?? anonymous.id
}
export async function feed(input: {
	userId?: string
	tab: string
	q: string
	tag: string
	cursor?: string
	limit: number
}): Promise<FeedPage> {
	const owner = input.userId ?? 'guest',
		key = JSON.stringify([input.tab, input.q, input.tag]),
		now = Date.now()
	for (const [id, s] of sessions) if (s.expires < now) sessions.delete(id)
	let id: string,
		offset = 0,
		session: FeedSession | undefined
	if (input.cursor) {
		let cursor: unknown
		try {
			cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString())
		} catch {
			fail('VALIDATION_FAILED', 422)
		}
		if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor))
			fail('VALIDATION_FAILED', 422)
		const c = cursor as { id?: unknown; offset?: unknown }
		if (
			typeof c.id !== 'string' ||
			!Number.isInteger(c.offset) ||
			Number(c.offset) < 0
		)
			fail('VALIDATION_FAILED', 422)
		id = c.id
		offset = Number(c.offset)
		session = sessions.get(id)
		if (
			!session ||
			session.owner !== owner ||
			session.key !== key ||
			session.expires < now
		)
			fail('FEED_EXPIRED', 409)
		session.expires = now + sessionLifetime
	} else {
		if (input.tab === 'following' && !input.userId) fail('UNAUTHORIZED', 401)
		const snapshot = await loadSnapshot(),
			actorId = withGuest(snapshot, input.userId)
		const reasons = new Map<string, Recommendation>()
		let ids: string[]
		if (input.tab === 'following') {
			const following = new Set(
				snapshot.follows
					.filter((f) => f.followerId === input.userId)
					.map((f) => f.followingId),
			)
			ids = snapshot.posts
				.filter((p) => following.has(p.authorId))
				.sort(
					(a, b) =>
						b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
				)
				.map((p) => p.id)
		} else {
			const ranking = recommendPosts({
				snapshot,
				userId: actorId,
				k: snapshot.posts.length,
				exploration: {
					seed: randomBytes(16).toString('hex'),
					strength: EXPLORATION_STRENGTH,
				},
				now: snapshot.now,
			})
			ids = ranking.items.map((r) => {
				reasons.set(r.id, r)
				return r.id
			})
		}
		const included = new Set(
			snapshot.posts
				.filter(
					(p) =>
						(!input.q ||
							`${p.title} ${p.body} ${p.tags.join(' ')}`
								.toLowerCase()
								.includes(input.q.toLowerCase())) &&
						(!input.tag || p.tags.includes(input.tag)),
				)
				.map((p) => p.id),
		)
		ids = ids.filter((id) => included.has(id))
		id = randomBytes(24).toString('hex')
		session = {
			owner,
			key,
			expires: now + sessionLifetime,
			ids,
			reasons,
			newestAt: snapshot.posts.reduce<string | null>(
				(v, p) => (!v || p.createdAt > v ? p.createdAt : v),
				null,
			),
		}
		if (sessions.size >= 200) {
			const oldest = [...sessions].reduce((a, b) =>
				a[1].expires <= b[1].expires ? a : b,
			)
			sessions.delete(oldest[0])
		}
		sessions.set(id, session)
	}
	const selected: Awaited<ReturnType<typeof db.post.findMany>> = []
	while (offset < session.ids.length && selected.length < input.limit) {
		const p = await db.post.findUnique({ where: { id: session.ids[offset++] } })
		if (p) selected.push(p)
	}
	let hasMore = false
	while (offset < session.ids.length) {
		if (
			await db.post.findUnique({
				where: { id: session.ids[offset] },
				select: { id: true },
			})
		) {
			hasMore = true
			break
		}
		offset++
	}

	return {
		items: await Promise.all(
			selected.map((p) => postView(p, input.userId, session.reasons.get(p.id))),
		),
		nextCursor: hasMore
			? Buffer.from(JSON.stringify({ id, offset })).toString('base64url')
			: null,
		hasMore,
		sessionId: id,
		newestAt: session.newestAt,
	}
}
