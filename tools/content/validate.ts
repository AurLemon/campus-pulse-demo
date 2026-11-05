import type { Snapshot, State } from '@campus/contracts'
import { topics } from './catalog.ts'
import { validPosterOptions } from './poster.ts'
import { linkedActivityIndex, isActivityReview } from './plans.ts'
export function validateSnapshot(s: Snapshot): string[] {
	const errors: string[] = [],
		fail = (condition: unknown, code: string) => {
			if (!condition) errors.push(code)
		}
	fail(s.source === 'Synthetic', 'SOURCE')
	fail(Number.isFinite(Date.parse(s.now)), 'CLOCK')
	const now = Date.parse(s.now),
		window = now - 90 * 86400000,
		allowedTags = new Set(topics.map((t) => t.tag))
	const arrays = [
		'users',
		'activities',
		'posts',
		'comments',
		'friendships',
		'follows',
		'states',
		'behaviors',
		'sessions',
	] as const
	for (const name of arrays) {
		const records = s[name]
		fail(
			new Set(records.map((x) => x.id)).size === records.length,
			`DUPLICATE_ID:${name}`,
		)
	}
	const users = new Map(s.users.map((x) => [x.id, x])),
		activities = new Map(s.activities.map((x) => [x.id, x])),
		posts = new Map(s.posts.map((x) => [x.id, x])),
		comments = new Map(s.comments.map((x) => [x.id, x]))
	const time = (value: string, label: string, after = window, before = now) => {
		const t = Date.parse(value)
		fail(Number.isFinite(t) && t >= after && t <= before, `TIME:${label}`)
	}
	const target = (
		v: { postId: string | null; activityId: string | null },
		label: string,
	) => {
		fail(
			Boolean(v.postId) !== Boolean(v.activityId),
			`TARGET_EXCLUSIVE:${label}`,
		)
		if (v.postId) fail(posts.has(v.postId), `POST_FK:${label}`)
		if (v.activityId) fail(activities.has(v.activityId), `ACTIVITY_FK:${label}`)
	}
	for (const u of s.users) {
		fail(u.source === 'Synthetic', `USER_SOURCE:${u.id}`)
		time(u.createdAt, u.id)
		fail(
			Object.keys(u.interests).every((tag) => allowedTags.has(tag)),
			`USER_TAGS:${u.id}`,
		)
		for (const weight of Object.values(u.interests))
			fail(
				Number.isFinite(weight) && weight >= 0 && weight <= 1,
				`INTEREST_RANGE:${u.id}`,
			)
	}
	for (const a of s.activities) {
		fail(validPosterOptions(a), `POSTER:${a.id}`)
		fail(users.get(a.organizerId)?.role === 'ORGANIZER', `ORGANIZER:${a.id}`)
		fail(
			a.source === 'Synthetic' && a.title.length > 0 && a.body.length > 0,
			`ACTIVITY_CONTENT:${a.id}`,
		)
		fail(Number.isInteger(a.capacity) && a.capacity > 0, `CAPACITY:${a.id}`)
		time(a.createdAt, a.id)
		time(a.deadline, a.id, Date.parse(a.createdAt), Infinity)
		time(a.startsAt, a.id, Date.parse(a.deadline), Infinity)
		time(a.endsAt, a.id, Date.parse(a.startsAt) + 1, Infinity)
		fail(
			a.tags.length > 0 && a.tags.every((tag) => allowedTags.has(tag)),
			`TAGS:${a.id}`,
		)
	}
	for (const p of s.posts) {
		fail(validPosterOptions(p), `POSTER:${p.id}`)
		fail(users.has(p.authorId), `AUTHOR:${p.id}`)
		if (p.activityId)
			fail(activities.has(p.activityId), `POST_ACTIVITY:${p.id}`)
		time(
			p.createdAt,
			p.id,
			Math.max(
				window,
				Date.parse(users.get(p.authorId)?.createdAt ?? ''),
				p.activityId
					? Date.parse(activities.get(p.activityId)?.createdAt ?? '')
					: window,
			),
		)
		fail(
			p.source === 'Synthetic' && p.title.length > 0 && p.body.length > 0,
			`POST_CONTENT:${p.id}`,
		)
		fail(
			p.tags.length > 0 && p.tags.every((tag) => allowedTags.has(tag)),
			`POST_TAGS:${p.id}`,
		)
		const index = Number(p.id.slice(1)) - 1
		if (s.version.endsWith('-full') && index < s.activities.length) {
			const activity = activities.get(p.activityId ?? '')
			fail(activity?.organizerId === p.authorId, `OFFICIAL_AUTHOR:${p.id}`)
			fail(p.createdAt < (activity?.startsAt ?? ''), `OFFICIAL_TIME:${p.id}`)
		}
		if (s.version.endsWith('-full') && p.activityId)
			fail(
				p.tags.every((tag) =>
					activities.get(p.activityId!)?.tags.includes(tag),
				),
				`LINKED_TAGS:${p.id}`,
			)
		if (
			s.version.endsWith('-full') &&
			isActivityReview(index, s.activities.length) &&
			linkedActivityIndex(index, s.activities.length) !== null
		)
			fail(
				p.activityId &&
					p.createdAt > (activities.get(p.activityId)?.endsAt ?? ''),
				`REVIEW_TIME:${p.id}`,
			)
	}
	for (const c of s.comments) {
		const p = posts.get(c.postId)
		fail(Boolean(p) && users.has(c.authorId), `COMMENT_FK:${c.id}`)
		time(
			c.createdAt,
			c.id,
			Math.max(
				Date.parse(p?.createdAt ?? ''),
				Date.parse(users.get(c.authorId)?.createdAt ?? ''),
			),
		)
		if (c.parentId) {
			const parent = comments.get(c.parentId)
			fail(
				parent && parent.postId === c.postId && parent.parentId === null,
				`REPLY_DEPTH:${c.id}`,
			)
			time(c.createdAt, c.id, Date.parse(parent?.createdAt ?? '') + 1)
		}
		fail(
			c.source === 'Synthetic' && c.body.length > 0,
			`COMMENT_CONTENT:${c.id}`,
		)
	}
	const friendKeys = new Set<string>(),
		followKeys = new Set<string>(),
		stateKeys = new Set<string>()
	for (const f of s.friendships) {
		const key = [f.requesterId, f.recipientId].sort().join('|')
		fail(
			users.has(f.requesterId) &&
				users.has(f.recipientId) &&
				f.requesterId !== f.recipientId,
			`FRIEND_FK:${f.id}`,
		)
		fail(!friendKeys.has(key), `FRIEND_DUPLICATE:${f.id}`)
		friendKeys.add(key)
		time(
			f.createdAt,
			f.id,
			Math.max(
				Date.parse(users.get(f.requesterId)?.createdAt ?? ''),
				Date.parse(users.get(f.recipientId)?.createdAt ?? ''),
			),
		)
	}
	for (const f of s.follows) {
		const key = `${f.followerId}|${f.followingId}`
		fail(
			users.has(f.followerId) &&
				users.has(f.followingId) &&
				f.followerId !== f.followingId,
			`FOLLOW_FK:${f.id}`,
		)
		fail(!followKeys.has(key), `FOLLOW_DUPLICATE:${f.id}`)
		followKeys.add(key)
		time(
			f.createdAt,
			f.id,
			Math.max(
				Date.parse(users.get(f.followerId)?.createdAt ?? ''),
				Date.parse(users.get(f.followingId)?.createdAt ?? ''),
			),
		)
	}
	for (const state of s.states) {
		target(state, state.id)
		fail(users.has(state.userId), `STATE_USER:${state.id}`)
		fail(
			state.kind !== 'REGISTER' || Boolean(state.activityId),
			`REGISTER_TARGET:${state.id}`,
		)
		const key = `${state.userId}|${state.postId ?? state.activityId}|${state.kind}`
		fail(!stateKeys.has(key), `STATE_DUPLICATE:${state.id}`)
		stateKeys.add(key)
		time(state.createdAt, state.id)
	}
	for (const b of s.behaviors) {
		target(b, b.id)
		fail(users.has(b.userId), `BEHAVIOR_USER:${b.id}`)
		time(
			b.createdAt,
			b.id,
			Math.max(
				Date.parse(users.get(b.userId)?.createdAt ?? ''),
				Date.parse(
					(b.postId ? posts.get(b.postId) : activities.get(b.activityId!))
						?.createdAt ?? '',
				),
			),
		)
		fail(
			Number.isFinite(b.effectiveMs) &&
				b.effectiveMs >= 0 &&
				b.effectiveMs <= 120000,
			`DWELL:${b.id}`,
		)
		if (b.kind === 'REGISTER') {
			const a = activities.get(b.activityId!)
			fail(
				a && a.status !== 'CANCELLED' && b.createdAt <= a.deadline,
				`REGISTER_DEADLINE:${b.id}`,
			)
		}
	}
	const views = s.behaviors.filter((behavior) => behavior.kind === 'VIEW')
	fail(views.length === s.sessions.length, 'VIEW_SESSION_COUNT')
	const viewCounts = new Map<string, number>()
	const viewKey = (
		value: {
			userId: string
			postId: string | null
			activityId: string | null
			effectiveMs: number
		},
		at: string,
	) =>
		`${value.userId}|${value.postId ?? value.activityId}|${at}|${value.effectiveMs}`
	for (const view of views) {
		const key = viewKey(view, view.createdAt)
		viewCounts.set(key, (viewCounts.get(key) ?? 0) + 1)
	}
	for (const session of s.sessions) {
		target(session, session.id)
		fail(users.has(session.userId), `SESSION_USER:${session.id}`)
		time(session.startedAt, session.id)
		time(session.updatedAt, session.id, Date.parse(session.startedAt))
		fail(
			session.effectiveMs >= 0 &&
				session.effectiveMs <= 120000 &&
				session.effectiveMs <=
					Date.parse(session.updatedAt) - Date.parse(session.startedAt) + 1,
			`SESSION_DURATION:${session.id}`,
		)
		const key = viewKey(session, session.startedAt)
		const matchingViews = viewCounts.get(key) ?? 0
		fail(matchingViews > 0, `SESSION_VIEW:${session.id}`)
		viewCounts.set(key, matchingViews - 1)
	}
	for (const a of s.activities)
		fail(
			s.states.filter((v) => v.activityId === a.id && v.kind === 'REGISTER')
				.length <= a.capacity,
			`FULL:${a.id}`,
		)
	const replay = new Set<string>()
	for (const b of [...s.behaviors].sort(
		(a, b) =>
			a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
	)) {
		const positive = {
			LIKE: 'LIKE',
			FAVORITE: 'FAVORITE',
			REGISTER: 'REGISTER',
			UNLIKE: 'LIKE',
			UNFAVORITE: 'FAVORITE',
			UNREGISTER: 'REGISTER',
		}[b.kind as string]
		if (!positive) continue
		const key = `${b.userId}|${b.postId ?? b.activityId}|${positive}`
		if (b.kind.startsWith('UN')) replay.delete(key)
		else replay.add(key)
	}
	fail(
		replay.size === stateKeys.size &&
			[...replay].every((key) => stateKeys.has(key)),
		'STATE_REPLAY_MISMATCH',
	)
	const replayedStates = replayStates(s)
	const actualStateTimes = new Map(
		s.states.map((state) => [
			`${state.userId}|${state.postId ?? state.activityId}|${state.kind}`,
			state.createdAt,
		]),
	)
	fail(
		replayedStates.every(
			(state) =>
				actualStateTimes.get(
					`${state.userId}|${state.postId ?? state.activityId}|${state.kind}`,
				) === state.createdAt,
		),
		'STATE_REPLAY_TIME_MISMATCH',
	)
	return errors
}
export function summarizeSnapshot(s: Snapshot) {
	const degrees = new Map(s.users.map((u) => [u.id, 0]))
	for (const f of s.friendships.filter((f) => f.status === 'ACCEPTED')) {
		degrees.set(f.requesterId, (degrees.get(f.requesterId) ?? 0) + 1)
		degrees.set(f.recipientId, (degrees.get(f.recipientId) ?? 0) + 1)
	}
	const counts = Object.fromEntries(
		[
			'users',
			'activities',
			'posts',
			'comments',
			'friendships',
			'follows',
			'states',
			'behaviors',
			'sessions',
		].map((key) => [
			key,
			s[key as keyof Snapshot] instanceof Array
				? (s[key as keyof Snapshot] as unknown[]).length
				: 0,
		]),
	)
	const countsOf = (values: string[]) => {
		const m = new Map<string, number>()
		for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
		return [...m].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
	}
	const duplicateTitles = countsOf(s.posts.map((p) => p.title)),
		duplicatePostBodies = countsOf(s.posts.map((p) => p.body)),
		duplicateComments = countsOf(s.comments.map((c) => c.body))
	return {
		source: s.source,
		version: s.version,
		now: s.now,
		counts,
		logicalInteractions: s.behaviors.length,
		sessionCount: s.sessions.length,
		entityRows: Object.values(counts).reduce((a, b) => a + b, 0),
		metadataRows: 1,
		databaseRows: Object.values(counts).reduce((a, b) => a + b, 0) + 1,
		differentUsers: s.users.length,
		acceptedFriendships: s.friendships.filter((x) => x.status === 'ACCEPTED')
			.length,
		rootComments: s.comments.filter((x) => !x.parentId).length,
		replies: s.comments.filter((x) => x.parentId).length,
		authors: new Set(s.posts.map((x) => x.authorId)).size,
		coldPosts: s.posts.filter((p) => !s.comments.some((c) => c.postId === p.id))
			.length,
		emptyProfiles: s.users.filter((u) => !Object.keys(u.interests).length)
			.length,
		isolatedFriendUsers: [...degrees.values()].filter((n) => n === 0).length,
		friendDegreeMax: Math.max(...degrees.values()),
		viewUsers: new Set(s.sessions.map((x) => x.userId)).size,
		longArticles: s.posts.filter(
			(p) => p.kind === 'ARTICLE' && p.body.length >= 300,
		).length,
		linkedPosts: s.posts.filter((p) => p.activityId).length,
		duplicatePostTitles: duplicateTitles.length,
		duplicatePostBodies: duplicatePostBodies.length,
		mostRepeatedComments: duplicateComments.slice(0, 5),
		behaviorKinds: Object.fromEntries(
			[...new Set(s.behaviors.map((b) => b.kind))].map((k) => [
				k,
				s.behaviors.filter((b) => b.kind === k).length,
			]),
		),
		validationErrors: validateSnapshot(s),
	}
}
export function replayStates(s: Snapshot): State[] {
	const map = new Map<string, State>()
	for (const b of [...s.behaviors].sort(
		(a, b) =>
			a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
	)) {
		const positive = (
			{
				LIKE: 'LIKE',
				FAVORITE: 'FAVORITE',
				REGISTER: 'REGISTER',
				UNLIKE: 'LIKE',
				UNFAVORITE: 'FAVORITE',
				UNREGISTER: 'REGISTER',
			} as Record<string, State['kind']>
		)[b.kind]
		if (!positive) continue
		const key = `${b.userId}|${b.postId ?? b.activityId}|${positive}`
		if (b.kind.startsWith('UN')) map.delete(key)
		else
			map.set(key, {
				id: `state-${b.id}`,
				userId: b.userId,
				postId: b.postId,
				activityId: b.activityId,
				kind: positive,
				createdAt: b.createdAt,
			})
	}
	return [...map.values()]
}
