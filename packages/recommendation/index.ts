import type {
	Activity,
	Post,
	Recommendation,
	RecommendationInput,
	RecommendationResult,
	ScoreParts,
	ScoreWeights,
	Snapshot,
} from '@campus/contracts'
import { selectTopK } from './heap.ts'
import type { TraceOptions, RecommendationTraceEvent } from './trace.ts'
export type {
	TraceOptions,
	RecommendationTraceEvent,
	TraceAction,
	HeapFrame,
} from './trace.ts'
export { MinHeap, selectTopK } from './heap.ts'

export const EXPLORATION_STRENGTH = 0.12

const DAY = 86_400_000
export const ACTIVITY_WEIGHTS: ScoreWeights = {
	interest: 0.55,
	social: 0.25,
	popularity: 0.1,
	context: 0.1,
}
export const POST_WEIGHTS: ScoreWeights = {
	interest: 0.55,
	social: 0.2,
	popularity: 0.1,
	context: 0.15,
}
type Target = 'post' | 'activity'
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const date = (value: string) => Date.parse(value)
const decay = (time: string, now: number) =>
	Math.pow(0.5, Math.max(0, now - date(time)) / (30 * DAY))
const key = (kind: Target, id: string) => `${kind}:${id}`

/** Deterministic per-candidate exploration. The caller owns session identity and randomness. */
function explorationDraw(
	seed: string,
	userId: string,
	target: Target,
	id: string,
): number {
	let hash = 2166136261
	for (const character of JSON.stringify([seed, userId, target, id])) {
		hash ^= character.codePointAt(0) ?? 0
		hash = Math.imul(hash, 16777619)
	}
	hash ^= hash >>> 16
	hash = Math.imul(hash, 0x85ebca6b)
	hash ^= hash >>> 13
	hash = Math.imul(hash, 0xc2b2ae35)
	hash ^= hash >>> 16
	return (hash >>> 0) / 4294967296
}

/** All ties are resolved by ascending code-point ID, independent of host locale. */
export function compareRecommendations(
	a: Recommendation,
	b: Recommendation,
): number {
	return a.score - b.score || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1)
}

export function cosineSimilarity(
	profile: Record<string, number>,
	tags: string[],
): number {
	const unique = new Set(tags)
	if (!unique.size) return 0
	const norm = Math.sqrt(
		Object.values(profile).reduce((sum, value) => sum + value * value, 0),
	)
	if (!norm) return 0
	return clamp(
		[...unique].reduce((sum, tag) => sum + (profile[tag] ?? 0), 0) /
			(norm * Math.sqrt(unique.size)),
	)
}

export function buildProfile(
	snapshot: Snapshot,
	userId: string,
	target: Target,
	now: string,
): Record<string, number> {
	const user = snapshot.users.find((item) => item.id === userId)
	if (!user) throw new RangeError('UNKNOWN_USER')
	const moment = date(now)
	if (!Number.isFinite(moment)) throw new RangeError('INVALID_TIME')
	const profile: Record<string, number> = Object.create(null)
	for (const [tag, weight] of Object.entries(user.interests))
		if (Number.isFinite(weight) && weight > 0) profile[tag] = clamp(weight)
	const entries: Array<Post | Activity> =
		target === 'post' ? snapshot.posts : snapshot.activities
	const tagsById = new Map(
		entries.map((entry) => [entry.id, entry.tags] as const),
	)
	const signals = new Map<string, number>()
	const add = (id: string, amount: number) =>
		signals.set(id, Math.min(0.8, (signals.get(id) ?? 0) + amount))
	// Current states, rather than historical LIKE/FAVORITE/REGISTER events, make undo reversible.
	const seen = new Set<string>()
	for (const state of snapshot.states) {
		const id = target === 'post' ? state.postId : state.activityId
		if (state.userId !== userId || !id || date(state.createdAt) > moment)
			continue
		const stateKey = `${state.kind}:${id}`
		if (seen.has(stateKey)) continue
		seen.add(stateKey)
		const strength =
			state.kind === 'REGISTER' ? 0.6 : state.kind === 'FAVORITE' ? 0.4 : 0.2
		add(id, strength * decay(state.createdAt, moment))
	}
	// Repeated views of a target share a daily cap. Session heartbeats never create independent evidence.
	const dailyViews = new Map<string, { id: string; ms: number; time: string }>()
	for (const event of snapshot.behaviors) {
		const id = target === 'post' ? event.postId : event.activityId
		if (
			event.userId !== userId ||
			event.kind !== 'VIEW' ||
			!id ||
			date(event.createdAt) > moment
		)
			continue
		const viewKey = `${id}:${event.createdAt.slice(0, 10)}`
		const current = dailyViews.get(viewKey) ?? {
			id,
			ms: 0,
			time: event.createdAt,
		}
		current.ms = Math.min(
			30_000,
			current.ms +
				Math.max(0, Number.isFinite(event.effectiveMs) ? event.effectiveMs : 0),
		)
		dailyViews.set(viewKey, current)
	}
	for (const view of dailyViews.values())
		if (view.ms >= 3000)
			add(view.id, 0.08 * (view.ms / 30_000) * decay(view.time, moment))
	const inferred: Record<string, number> = Object.create(null)
	for (const [id, strength] of signals) {
		const tags = [...new Set(tagsById.get(id) ?? [])]
		for (const tag of tags)
			inferred[tag] = (inferred[tag] ?? 0) + strength / Math.max(1, tags.length)
	}
	for (const [tag, strength] of Object.entries(inferred))
		profile[tag] = (profile[tag] ?? 0) + Math.min(0.8, strength)
	return profile
}

interface Evidence {
	friends: Set<string>
	follows: Set<string>
	engaged: Map<string, Set<string>>
	counts: Map<string, number>
}
function indexEvidence(
	snapshot: Snapshot,
	userId: string,
	now: number,
): Evidence {
	const friends = new Set<string>()
	for (const edge of snapshot.friendships) {
		if (edge.status !== 'ACCEPTED' || date(edge.createdAt) > now) continue
		if (edge.requesterId === userId) friends.add(edge.recipientId)
		if (edge.recipientId === userId) friends.add(edge.requesterId)
	}
	const follows = new Set(
		snapshot.follows
			.filter(
				(edge) => edge.followerId === userId && date(edge.createdAt) <= now,
			)
			.map((edge) => edge.followingId),
	)
	const engaged = new Map<string, Set<string>>()
	const counts = new Map<string, number>()
	const add = (targetKey: string, actor: string) => {
		const users = engaged.get(targetKey) ?? new Set<string>()
		users.add(actor)
		engaged.set(targetKey, users)
	}
	for (const state of snapshot.states) {
		if (date(state.createdAt) > now) continue
		if (state.postId) add(key('post', state.postId), state.userId)
		if (state.activityId) add(key('activity', state.activityId), state.userId)
		if (state.kind === 'REGISTER' && state.activityId)
			counts.set(state.activityId, (counts.get(state.activityId) ?? 0) + 1)
	}
	for (const comment of snapshot.comments)
		if (date(comment.createdAt) <= now)
			add(key('post', comment.postId), comment.authorId)
	return { friends, follows, engaged, counts }
}

function normalizeWeights(weights: ScoreWeights): ScoreWeights {
	const values = [
		weights.interest,
		weights.social,
		weights.popularity,
		weights.context,
	]
	if (values.some((value) => !Number.isFinite(value) || value < 0))
		throw new RangeError('INVALID_WEIGHTS')
	const total = values.reduce((sum, value) => sum + value, 0)
	if (!Number.isFinite(total) || !total) throw new RangeError('INVALID_WEIGHTS')
	return {
		interest: weights.interest / total,
		social: weights.social / total,
		popularity: weights.popularity / total,
		context: weights.context / total,
	}
}

function recommend(
	input: RecommendationInput,
	target: Target,
	options?: TraceOptions,
): RecommendationResult {
	const start = performance.now()
	let sequence = 0
	let truncated = false
	const requestedLimit = options?.maxEvents ?? 4000
	const maximum = Number.isFinite(requestedLimit)
		? Math.max(1, Math.min(10000, Math.floor(requestedLimit)))
		: 4000
	const emit = (event: Omit<RecommendationTraceEvent, 'sequence'>) => {
		if (!options) return
		if (sequence >= maximum) {
			if (!truncated) {
				truncated = true
				options.onTrace({ sequence: sequence++, action: 'truncated' })
			}
			return
		}
		options.onTrace({ ...event, sequence: sequence++ })
	}
	const { snapshot, userId, exploration } = input
	if (
		exploration &&
		(typeof exploration.seed !== 'string' ||
			!exploration.seed ||
			exploration.seed.length > 128 ||
			!Number.isFinite(exploration.strength) ||
			exploration.strength < 0 ||
			exploration.strength > 0.2)
	)
		throw new RangeError('INVALID_EXPLORATION')
	const now = date(input.now)
	const profile = buildProfile(snapshot, userId, target, input.now)
	const user = snapshot.users.find((entry) => entry.id === userId)!
	const evidence = indexEvidence(snapshot, userId, now)
	const weights = normalizeWeights(
		input.weights ?? (target === 'post' ? POST_WEIGHTS : ACTIVITY_WEIGHTS),
	)
	const registered = new Set(
		snapshot.states
			.filter(
				(state) =>
					state.userId === userId &&
					state.kind === 'REGISTER' &&
					date(state.createdAt) <= now,
			)
			.map((state) => state.activityId),
	)
	if (options) emit({ action: 'profile', profile, weights })
	const all: Array<Post | Activity> =
		target === 'post' ? snapshot.posts : snapshot.activities
	const candidates = all.filter((candidate) => {
		let reason: string | undefined
		if (!Number.isFinite(date(candidate.createdAt))) reason = 'invalid-time'
		else if (date(candidate.createdAt) > now) reason = 'not-published'
		else if (target === 'activity') {
			const activity = candidate as Activity
			if (
				![activity.startsAt, activity.endsAt, activity.deadline].every(
					(value) => Number.isFinite(date(value)),
				)
			)
				reason = 'invalid-time'
			else if (activity.status !== 'PUBLISHED') reason = 'cancelled'
			else if (date(activity.endsAt) <= now) reason = 'ended'
			else if (date(activity.startsAt) <= now) reason = 'started'
			else if (date(activity.deadline) <= now) reason = 'deadline'
			else if (registered.has(activity.id)) reason = 'registered'
			else if ((evidence.counts.get(activity.id) ?? 0) >= activity.capacity)
				reason = 'full'
		}
		if (options)
			emit({ action: 'filter', id: candidate.id, accepted: !reason, reason })
		return !reason
	})
	const fallback =
		Object.values(profile).every((value) => !value) &&
		!evidence.friends.size &&
		!evidence.follows.size
	const trace: string[] = []
	const scored = function* (): Generator<Recommendation> {
		for (const candidate of candidates) {
			const engagedActors =
				evidence.engaged.get(key(target, candidate.id)) ?? new Set<string>()
			const actors = new Set(engagedActors)
			const authorId =
				'authorId' in candidate ? candidate.authorId : candidate.organizerId
			// Publishing is evidence for a post, not participation in an activity.
			if (target === 'post') actors.add(authorId)
			const friendIds = [...evidence.friends]
				.filter((id) => actors.has(id))
				.sort()
			const followIds = [...evidence.follows]
				.filter((id) => actors.has(id))
				.sort()
			const social =
				(0.65 * friendIds.length) / Math.max(1, evidence.friends.size) +
				(0.35 * followIds.length) / Math.max(1, evidence.follows.size)
			const popularity =
				target === 'post'
					? Math.min(1, engagedActors.size / 20)
					: Math.min(
							1,
							(evidence.counts.get(candidate.id) ?? 0) /
								(candidate as Activity).capacity,
						)
			const context =
				target === 'post'
					? Math.pow(
							0.5,
							Math.max(0, now - date(candidate.createdAt)) / (14 * DAY),
						)
					: fallback
						? 0
						: Number((candidate as Activity).campus === user.campus)
			const parts: ScoreParts = {
				interest: cosineSimilarity(profile, candidate.tags),
				social: clamp(social),
				popularity: clamp(popularity),
				context: clamp(context),
			}
			const contributions: ScoreParts = {
				interest: parts.interest * weights.interest,
				social: parts.social * weights.social,
				popularity: parts.popularity * weights.popularity,
				context: parts.context * weights.context,
			}
			const relevanceScore =
				contributions.interest +
				contributions.social +
				contributions.popularity +
				contributions.context
			const draw = exploration
				? explorationDraw(exploration.seed, userId, target, candidate.id)
				: 0
			const item: Recommendation = {
				id: candidate.id,
				score: exploration
					? relevanceScore * (1 - exploration.strength) +
						draw * exploration.strength
					: relevanceScore,
				...(exploration
					? {
							relevanceScore,
							explorationDraw: draw,
							explorationStrength: exploration.strength,
						}
					: {}),
				parts,
				contributions,
				friendIds,
				followIds,
				matchedTags: [...new Set(candidate.tags)].filter(
					(tag) => (profile[tag] ?? 0) > 0,
				),
				fallback,
			}
			if (options) emit({ action: 'score', id: item.id, item })
			yield item
		}
	}
	const items = selectTopK(
		scored(),
		input.k,
		compareRecommendations,
		options
			? (action, item, size) => {
					// Legacy summaries are only collected for an explicitly traced run.
					if (trace.length < 200)
						trace.push(`${action}:${item.id}:${item.score.toFixed(6)}:${size}`)
					emit({ action, id: item.id, item })
				}
			: undefined,
		options
			? (event) =>
					emit({
						action: event.action,
						indices: event.indices,
						id: event.item?.id,
						heap: event.values.map(({ id, score }) => ({ id, score })),
					})
			: undefined,
		options
			? (item, values) =>
					emit({
						action: 'candidate',
						id: item.id,
						item,
						heap: values.map(({ id, score }) => ({ id, score })),
					})
			: undefined,
	)
	if (options)
		emit({ action: 'output', resultIds: items.map((item) => item.id) })
	return {
		items,
		candidateCount: candidates.length,
		profile,
		weights,
		elapsedMs: performance.now() - start,
		...(exploration ? { exploration: { ...exploration } } : {}),
		trace,
	}
}
export function recommendPosts(
	input: RecommendationInput,
	options?: TraceOptions,
): RecommendationResult {
	return recommend(input, 'post', options)
}
export function recommendActivities(
	input: RecommendationInput,
	options?: TraceOptions,
): RecommendationResult {
	return recommend(input, 'activity', options)
}
