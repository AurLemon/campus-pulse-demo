import type { Snapshot, ScoreWeights } from '@campus/contracts'
import { ACTIVITY_WEIGHTS, POST_WEIGHTS } from '@campus/recommendation'
export interface StudioRouteSettings {
	userId: string
	type: 'activity' | 'post'
	k: number
	now: string
	live: boolean
	weights: ScoreWeights
	stage: number
}
export function readStudioRoute(
	query: Record<string, unknown>,
	snapshot?: Snapshot,
): StudioRouteSettings {
	const text = (key: string) =>
		typeof query[key] === 'string' ? (query[key] as string) : ''
	const type = text('target') === 'post' ? 'post' : 'activity'
	const defaults = type === 'post' ? POST_WEIGHTS : ACTIVITY_WEIGHTS
	const keys = ['interest', 'social', 'popularity', 'context'] as const
	const weights = { ...defaults }
	for (const key of keys) {
		const value = text(key) ? Number(text(key)) : NaN
		weights[key] =
			Number.isFinite(value) && value >= 0 && value <= 100
				? value
				: Math.round(defaults[key] * 100)
	}
	if (!keys.some((key) => weights[key] > 0))
		for (const key of keys) weights[key] = Math.round(defaults[key] * 100)
	const requestedK = text('k') ? Number(text('k')) : NaN,
		stage = Number(text('stage'))
	const now = text('time')
	return {
		userId:
			snapshot?.users.find((user) => user.id === text('user'))?.id ??
			snapshot?.users[0]?.id ??
			'',
		type,
		k:
			Number.isInteger(requestedK) && requestedK >= 0 && requestedK <= 50
				? requestedK
				: 3,
		now: now && Number.isFinite(Date.parse(now)) ? now : (snapshot?.now ?? ''),
		live: text('clock') !== 'fixed',
		weights,
		stage: Number.isInteger(stage) && stage >= 1 && stage <= 5 ? stage - 1 : 0,
	}
}
export function studioRouteFields(
	settings: StudioRouteSettings,
): Record<string, string> {
	return {
		stage: String(settings.stage + 1),
		user: settings.userId,
		target: settings.type,
		k: String(settings.k),
		clock: settings.live ? 'live' : 'fixed',
		time: settings.live ? '' : settings.now,
		interest: String(settings.weights.interest),
		social: String(settings.weights.social),
		popularity: String(settings.weights.popularity),
		context: String(settings.weights.context),
	}
}
