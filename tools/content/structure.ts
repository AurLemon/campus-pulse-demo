import type { Snapshot, Behavior, State, Post } from '@campus/contracts'
import { topics, voices } from './catalog.ts'
import { assignSnapshotPosters } from './poster.ts'
import { replayStates } from './validate.ts'
import { linkedActivityIndex, isActivityReview } from './plans.ts'
import type { WrittenActivity, WrittenPost } from './model-content.ts'
export const NOW = '2026-11-03T12:00:00.000Z'
const DAY = 86400000
const base = Date.parse(NOW)
const iso = (time: number) => new Date(time).toISOString()
export function randomGenerator(seed: number) {
	let n = seed >>> 0
	return () => {
		n = (Math.imul(n, 1664525) + 1013904223) >>> 0
		return n / 4294967296
	}
}
export interface ContentBundle {
	activities: WrittenActivity[]
	posts: WrittenPost[]
}
export function buildSnapshot(
	size: 'small' | 'full',
	content: ContentBundle,
): Snapshot {
	const full = size === 'full',
		total = full ? 200 : 20,
		activityTotal = full ? 120 : 6,
		postTotal = full ? 1200 : 12
	const random = randomGenerator(6192026),
		pick = (n: number) => Math.floor(random() * n)
	const snapshot: Snapshot = {
		version: `campus-synthetic-v1-${size}`,
		source: 'Synthetic',
		seed: 6192026,
		now: NOW,
		users: [],
		activities: [],
		posts: [],
		comments: [],
		friendships: [],
		follows: [],
		states: [],
		behaviors: [],
		sessions: [],
	}
	const names = [
		'沿岸',
		'阿槐',
		'小满',
		'纸盒',
		'木星',
		'一叶',
		'南窗',
		'蓝鲸',
		'树梢',
		'方糖',
		'星禾',
		'石榴',
		'清野',
		'禾苗',
		'迟雨',
		'沐风',
		'云边',
		'安岚',
		'白露',
		'明川',
	]
	const organizerCount = full ? 24 : 6,
		activeUsers = full ? 180 : 17,
		authors = full ? 70 : 12
	for (let i = 0; i < total; i++) {
		const topic = topics[i % topics.length]!,
			second = topics[(i + 3) % topics.length]!
		snapshot.users.push({
			id: `u${i + 1}`,
			name: `${names[i % names.length]}${i >= names.length ? Math.floor(i / names.length) + 1 : ''}`,
			bio: i % 7 === 0 ? '' : `${topic.topic}。${voices[i % voices.length]}。`,
			campus: i % 2 === 0 ? '铜盘' : '旗山',
			role: i < organizerCount ? 'ORGANIZER' : 'STUDENT',
			interests:
				i >= Math.floor(total * (full ? 0.95 : 0.9))
					? {}
					: { [topic.tag]: 1, ...(i % 3 === 0 ? { [second.tag]: 0.35 } : {}) },
			createdAt: iso(i >= activeUsers ? base : base - DAY * 90),
			source: 'Synthetic',
		})
	}
	for (let i = 0; i < activityTotal; i++) {
		const t = topics[i % topics.length]!,
			word = content.activities.find((a) => a.id === `a${i + 1}`)
		if (!word) throw new Error(`MISSING_ACTIVITY_TEXT:a${i + 1}`)
		const historical = i % 3 === 2,
			starts =
				base +
				(full ? -12 * 3600000 : 0) +
				DAY * (historical ? -(4 + pick(70)) : 2 + pick(25)) +
				(full ? [8, 6, 8, 7, 2, 11, 10, 7][i % 8]! : pick(8)) * 3600000
		snapshot.activities.push({
			id: `a${i + 1}`,
			organizerId: `u${(i % organizerCount) + 1}`,
			title: word.title,
			body: word.body,
			tags: [t.tag],
			campus: i % 2 === 0 ? '铜盘' : '旗山',
			location: t.place,
			startsAt: iso(starts),
			endsAt: iso(starts + 7200000),
			deadline: iso(starts - 3600000),
			capacity: 24 + pick(65),
			status: i > 5 && i % 29 === 0 ? 'CANCELLED' : 'PUBLISHED',
			createdAt: iso(
				Math.min(starts - DAY * (8 + pick(7)), base - DAY * (2 + pick(8))),
			),
			source: 'Synthetic',
		})
	}
	for (let i = 0; i < postTotal; i++) {
		const word = content.posts.find((p) => p.id === `p${i + 1}`)
		if (!word) throw new Error(`MISSING_POST_TEXT:p${i + 1}`)
		const activityIndex = linkedActivityIndex(i, activityTotal),
			activity =
				activityIndex === null ? undefined : snapshot.activities[activityIndex]
		const created = activity
			? isActivityReview(i, activityTotal) ||
				(full && i >= activityTotal && Date.parse(activity.endsAt) < base)
				? Date.parse(activity.endsAt) + 86400000
				: Date.parse(activity.createdAt) + 3600000
			: base - DAY * (1 + pick(83)) - pick(20) * 3600000
		const post: Post = {
			id: `p${i + 1}`,
			authorId:
				full && i < activityTotal
					? activity!.organizerId
					: `u${(i % authors) + 1}`,
			activityId: activity?.id ?? null,
			title: word.title,
			body: word.body,
			tags: [topics[(activityIndex ?? i) % topics.length]!.tag],
			kind: word.body.length >= 300 ? 'ARTICLE' : 'TEXT',
			createdAt: iso(created),
			source: 'Synthetic',
		}
		snapshot.posts.push(post)
		for (let j = 0; j < word.comments.length; j++) {
			// A historical recruitment thread can keep later participant discussion.
			const discussionCreated =
				full &&
				i < activityTotal &&
				activity &&
				Date.parse(activity.endsAt) < base
					? Date.parse(activity.endsAt) + DAY
					: created
			const rootId = `c${snapshot.comments.length + 1}`,
				time = Math.min(base - 120000, discussionCreated + 3600000 * (j + 2)),
				author = `u${((i + j + 3) % activeUsers) + 1}`
			snapshot.comments.push({
				id: rootId,
				postId: post.id,
				authorId: author,
				parentId: null,
				body: word.comments[j]!.body,
				createdAt: iso(time),
				source: 'Synthetic',
			})
			if (word.comments[j]!.reply)
				snapshot.comments.push({
					id: `c${snapshot.comments.length + 1}`,
					postId: post.id,
					authorId: post.authorId,
					parentId: rootId,
					body: word.comments[j]!.reply!,
					createdAt: iso(time + 60000),
					source: 'Synthetic',
				})
		}
	}
	const friendPairs = new Set<string>(),
		friendTarget = full ? 600 : 24
	while (snapshot.friendships.length < friendTarget) {
		const a = pick(activeUsers - 2),
			b =
				random() < 0.75
					? (a + 1 + pick(12)) % (activeUsers - 2)
					: pick(activeUsers - 2)
		if (a === b) continue
		const pair = [a + 1, b + 1].sort((x, y) => x - y).join('-')
		if (friendPairs.has(pair)) continue
		friendPairs.add(pair)
		snapshot.friendships.push({
			id: `f${snapshot.friendships.length + 1}`,
			requesterId: `u${a + 1}`,
			recipientId: `u${b + 1}`,
			status: 'ACCEPTED',
			createdAt: iso(base - DAY * (5 + pick(70))),
		})
	}
	snapshot.friendships.push({
		id: 'f-pending',
		requesterId: `u${activeUsers - 1}`,
		recipientId: 'u1',
		status: 'PENDING',
		createdAt: iso(base - DAY),
	})
	const follows = new Set<string>(),
		followTarget = full ? 1000 : 35
	while (snapshot.follows.length < followTarget) {
		const a = pick(activeUsers),
			b = random() < 0.7 ? pick(authors) : pick(activeUsers)
		const pair = `${a}-${b}`
		if (a === b || follows.has(pair)) continue
		follows.add(pair)
		snapshot.follows.push({
			id: `follow${snapshot.follows.length + 1}`,
			followerId: `u${a + 1}`,
			followingId: `u${b + 1}`,
			createdAt: iso(base - DAY * (3 + pick(75))),
		})
	}
	const current = new Map<string, State>()
	const event = (
		userId: string,
		postId: string | null,
		activityId: string | null,
		kind: Behavior['kind'],
		createdAt: string,
		effectiveMs = 0,
	) =>
		snapshot.behaviors.push({
			id: `b${snapshot.behaviors.length + 1}`,
			userId,
			postId,
			activityId,
			kind,
			createdAt,
			effectiveMs,
		})
	const state = (
		userId: string,
		postId: string | null,
		activityId: string | null,
		kind: State['kind'],
		createdAt: string,
		cancel: boolean,
	) => {
		const key = `${userId}:${postId ?? activityId}:${kind}`
		if (current.has(key)) return
		current.set(key, {
			id: `state${current.size + snapshot.behaviors.length + 1}`,
			userId,
			postId,
			activityId,
			kind,
			createdAt,
		})
		event(userId, postId, activityId, kind, createdAt)
		if (cancel) {
			current.delete(key)
			event(
				userId,
				postId,
				activityId,
				kind === 'LIKE'
					? 'UNLIKE'
					: kind === 'FAVORITE'
						? 'UNFAVORITE'
						: 'UNREGISTER',
				iso(Math.min(base - 1, Date.parse(createdAt) + 3600000)),
			)
		}
	}
	const count = full ? 16000 : 90
	for (let i = 0; i < count; i++) {
		const userId = `u${Math.floor(random() * random() * activeUsers) + 1}`,
			p =
				snapshot.posts[
					Math.floor(random() * random() * snapshot.posts.length)
				]!,
			t =
				Date.parse(p.createdAt) +
				random() * (base - Date.parse(p.createdAt) - 60000)
		const effectiveMs = Math.min(
				Math.max(0, Math.floor(base - t)),
				random() < 0.24 ? pick(2500) : 4000 + pick(115000),
			),
			sessionId = `v${i + 1}`
		snapshot.sessions.push({
			id: sessionId,
			userId,
			postId: p.id,
			activityId: null,
			startedAt: iso(t),
			updatedAt: iso(Math.min(base, t + effectiveMs + pick(5000))),
			effectiveMs,
			closed: true,
		})
		event(userId, p.id, null, 'VIEW', iso(t), effectiveMs)
		if (random() < 0.19)
			state(userId, p.id, null, 'LIKE', iso(t + 1000), random() < 0.13)
		if (random() < 0.065)
			state(userId, p.id, null, 'FAVORITE', iso(t + 1500), random() < 0.18)
	}
	for (const activity of snapshot.activities) {
		if (activity.status === 'CANCELLED') continue
		const registrants = new Set<number>(),
			amount = full ? 3 + pick(13) : 2 + pick(4)
		for (let j = 0; j < amount; j++) {
			const uid = pick(activeUsers)
			if (registrants.has(uid)) continue
			registrants.add(uid)
			const t =
				Date.parse(activity.createdAt) +
				1000 +
				random() *
					(Math.min(base - 7200000, Date.parse(activity.deadline) - 7200000) -
						Date.parse(activity.createdAt))
			state(
				`u${uid + 1}`,
				null,
				activity.id,
				'REGISTER',
				iso(t),
				random() < 0.19,
			)
		}
	}
	for (const c of snapshot.comments)
		event(c.authorId, c.postId, null, 'COMMENT', c.createdAt)
	snapshot.states = replayStates(snapshot)
	snapshot.behaviors.sort(
		(a, b) =>
			a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
	)
	return assignSnapshotPosters(snapshot)
}
