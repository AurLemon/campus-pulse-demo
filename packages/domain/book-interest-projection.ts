import type { Snapshot } from '@campus/contracts'
import type { PrismaClient } from '../../generated/prisma/client.ts'

const communityTags = new Set([
	'reading',
	'technology',
	'art',
	'photography',
	'music',
	'sports',
	'volunteer',
	'career',
	'daily',
	'gaming',
	'anime',
	'entertainment',
])

interface BookEvidence {
	userId: string
	bookId: string
	tags: string[]
	status: { value: string; at: number | null; order: string } | null
	favorite: { value: boolean; at: number | null; order: string } | null
	borrowedAt: number | null
}
/** Project each original user/book signal once, without replaying cancelled preferences. */
export async function addBookInterestSignals(
	client: PrismaClient,
	snapshot: Snapshot,
) {
	const now = Date.parse(snapshot.now)
	if (!Number.isFinite(now)) return snapshot
	const [states, records] = await client.$transaction([
		client.bookState.findMany({ include: { book: true } }),
		client.bookReadingRecord.findMany({ include: { book: true } }),
	])
	const evidence = new Map<string, BookEvidence>()
	const eventTimes = new Map<string, number[]>()
	const fieldKey = (userId: string, bookId: string, kind: string) =>
		JSON.stringify([userId, bookId, kind])
	const atOrBeforeNow = (value: string) => {
		const at = Date.parse(value)
		return Number.isFinite(at) && at <= now ? at : null
	}
	function item(userId: string, bookId: string, rawTags: string) {
		const key = JSON.stringify([userId, bookId])
		let value = evidence.get(key)
		if (!value) {
			const tags: unknown = JSON.parse(rawTags)
			value = {
				userId,
				bookId,
				tags: Array.isArray(tags)
					? [
							...new Set(
								tags.filter(
									(t): t is string =>
										typeof t === 'string' && communityTags.has(t),
								),
							),
						]
					: [],
				status: null,
				favorite: null,
				borrowedAt: null,
			}
			evidence.set(key, value)
		}
		return value
	}
	function later(
		at: number,
		order: string,
		current: { at: number | null; order: string } | null,
	) {
		return (
			!current ||
			current.at === null ||
			at > current.at ||
			(at === current.at && order > current.order)
		)
	}
	for (const record of records) {
		const at = atOrBeforeNow(record.occurredAt)
		if (at === null) continue
		const value = item(record.userId, record.bookId, record.book.tags)
		const key = fieldKey(record.userId, record.bookId, record.kind)
		const times = eventTimes.get(key) ?? []
		times.push(at)
		eventTimes.set(key, times)
		if (record.kind === 'BORROW')
			value.borrowedAt = Math.max(value.borrowedAt ?? -Infinity, at)
		else if (
			['NONE', 'WANT', 'READING', 'READ'].includes(record.kind) &&
			later(at, record.id, value.status)
		)
			value.status = { value: record.kind, at, order: record.id }
		else if (
			['FAVORITE', 'UNFAVORITE'].includes(record.kind) &&
			later(at, record.id, value.favorite)
		)
			value.favorite = {
				value: record.kind === 'FAVORITE',
				at,
				order: record.id,
			}
	}
	// Persisted values resolve equal-time events. Each field keeps its own event time; another field's update must not refresh its decay.
	for (const state of states) {
		const at = atOrBeforeNow(state.updatedAt)
		if (at === null) continue
		const value = item(state.userId, state.bookId, state.book.tags)
		const matchingTime = (kind: string) => {
			const times = (
				eventTimes.get(fieldKey(state.userId, state.bookId, kind)) ?? []
			).filter((time) => time <= at)
			return times.length ? Math.max(...times) : null
		}
		if (!value.status || value.status.at === null || at >= value.status.at)
			value.status = {
				value: state.status,
				at: matchingTime(state.status),
				order: state.id,
			}
		if (
			!value.favorite ||
			value.favorite.at === null ||
			at >= value.favorite.at
		)
			value.favorite = {
				value: state.favorite,
				at: matchingTime(state.favorite ? 'FAVORITE' : 'UNFAVORITE'),
				order: state.id,
			}
	}
	const decay = (strength: number, at: number) =>
		strength * Math.pow(0.5, (now - at) / (30 * 86400000))
	const totals = new Map<string, Record<string, number>>()
	for (const value of evidence.values()) {
		const statusWeight =
			value.status?.value === 'READ'
				? 0.25
				: value.status?.value === 'READING'
					? 0.2
					: value.status?.value === 'WANT'
						? 0.1
						: 0
		const strength = Math.max(
			value.status?.at !== null && value.status?.at !== undefined
				? decay(statusWeight, value.status.at)
				: 0,
			value.favorite?.value && value.favorite.at !== null
				? decay(0.2, value.favorite.at)
				: 0,
			value.borrowedAt === null ? 0 : decay(0.2, value.borrowedAt),
		)
		if (strength <= 0) continue
		const profile = totals.get(value.userId) ?? {}
		for (const tag of value.tags)
			profile[tag] = Math.min(0.5, (profile[tag] ?? 0) + strength)
		totals.set(value.userId, profile)
	}
	for (const user of snapshot.users)
		for (const [tag, weight] of Object.entries(totals.get(user.id) ?? {}))
			user.interests[tag] = Math.min(1, (user.interests[tag] ?? 0) + weight)
	return snapshot
}
