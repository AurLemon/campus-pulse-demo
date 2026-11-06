import type {
	BookRecommendationInput,
	BookRecommendationResult,
	BookScore,
	BookContribution,
} from '@campus/contracts/books'
import { selectTopK } from './heap.ts'

type Vector = Map<string, number>
const kindWeights: Record<string, number> = {
	BORROW: 3,
	RETURN: 1,
	READING: 2,
	READ: 4,
	WANT: 0.8,
	FAVORITE: 1.2,
	UNFAVORITE: -1.2,
	NONE: -0.8,
}
function norm(vector: Vector) {
	return Math.sqrt([...vector.values()].reduce((sum, v) => sum + v * v, 0))
}
function similarity(a: Vector, b: Vector) {
	let dot = 0,
		overlap = 0
	for (const [id, value] of a)
		if (b.has(id)) {
			dot += value * b.get(id)!
			overlap++
		}
	const denominator = norm(a) * norm(b)
	return { similarity: denominator ? dot / denominator : 0, overlap }
}
/** Borrow/read history remains the sole source for the collaborative matrix. */
export function recommendBooks(
	input: BookRecommendationInput,
): BookRecommendationResult {
	const { snapshot, userId } = input
	const now = Date.parse(input.now),
		resultCount = Math.max(0, Math.floor(input.resultCount ?? 20)),
		neighborCount = Math.max(0, Math.floor(input.neighborCount ?? 15))
	const matrix = new Map<string, Vector>(),
		owned = new Set<string>()
	const validRecords = snapshot.records.filter(
		(record) =>
			Number.isFinite(Date.parse(record.occurredAt)) &&
			Date.parse(record.occurredAt) <= now,
	)
	const latestStatus = new Map<string, (typeof snapshot.records)[number]>()
	const latestFavorite = new Map<string, (typeof snapshot.records)[number]>()
	for (const record of validRecords) {
		const key = `${record.userId}:${record.bookId}`
		const map = ['NONE', 'WANT', 'READING', 'READ'].includes(record.kind)
			? latestStatus
			: ['FAVORITE', 'UNFAVORITE'].includes(record.kind)
				? latestFavorite
				: null
		if (map && (!map.has(key) || record.occurredAt >= map.get(key)!.occurredAt))
			map.set(key, record)
	}
	// Current state disambiguates same-millisecond status events without treating a favorite timestamp as a new reading event.
	for (const state of snapshot.states ?? []) {
		if (
			!Number.isFinite(Date.parse(state.updatedAt)) ||
			Date.parse(state.updatedAt) > now
		)
			continue
		const matching = validRecords
			.filter(
				(record) =>
					record.userId === state.userId &&
					record.bookId === state.bookId &&
					record.kind === state.status,
			)
			.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
		if (matching) latestStatus.set(`${state.userId}:${state.bookId}`, matching)
	}
	const effective = validRecords.filter((record) =>
		['BORROW', 'RETURN'].includes(record.kind),
	)
	effective.push(
		...[...latestStatus.values()].filter((record) =>
			['READING', 'READ'].includes(record.kind),
		),
	)
	for (const record of effective) {
		const age = (now - Date.parse(record.occurredAt)) / 86400000,
			weight = (kindWeights[record.kind] ?? 0) * Math.pow(0.5, age / 180)
		const row = matrix.get(record.userId) ?? new Map<string, number>()
		row.set(record.bookId, (row.get(record.bookId) ?? 0) + weight)
		matrix.set(record.userId, row)
		if (
			record.userId === userId &&
			['BORROW', 'READING', 'READ'].includes(record.kind)
		)
			owned.add(record.bookId)
	}
	for (const row of matrix.values())
		for (const [id, value] of row) if (value <= 0) row.delete(id)
	const target = matrix.get(userId) ?? new Map<string, number>()
	const neighbors = [...matrix]
		.filter(([id]) => id !== userId)
		.map(([id, row]) => ({ userId: id, ...similarity(target, row) }))
		.filter((n) => n.similarity > 0)
		.sort(
			(a, b) => b.similarity - a.similarity || a.userId.localeCompare(b.userId),
		)
		.slice(0, neighborCount)
	const inverted = new Map<string, Vector>()
	for (const [id, row] of matrix)
		for (const [book, value] of row) {
			const v = inverted.get(book) ?? new Map<string, number>()
			v.set(id, value / (norm(row) || 1))
			inverted.set(book, v)
		}
	const profile: Record<string, number> = {}
	for (const [tag, value] of Object.entries(
		snapshot.users.find((u) => u.id === userId)?.interests ?? {},
	))
		profile[tag] = (profile[tag] ?? 0) + value
	const documentFrequency = new Map<string, number>()
	for (const book of snapshot.books)
		for (const tag of new Set(book.tags))
			documentFrequency.set(tag, (documentFrequency.get(tag) ?? 0) + 1)
	const bookVectors = new Map(
		snapshot.books.map((book) => [
			book.id,
			new Map(
				book.tags.map((tag) => [
					tag,
					1 +
						Math.log(
							(snapshot.books.length + 1) /
								((documentFrequency.get(tag) ?? 0) + 1),
						),
				]),
			),
		]),
	)
	const contentRecords = validRecords.filter(
		(record) =>
			record.userId === userId && ['BORROW', 'RETURN'].includes(record.kind),
	)
	const currentStates = snapshot.states?.filter(
		(state) => state.userId === userId && Date.parse(state.updatedAt) <= now,
	)
	if (currentStates) {
		for (const state of currentStates) {
			const key = `${userId}:${state.bookId}`
			const statusEvent = latestStatus.get(key)
			const favoriteEvent = latestFavorite.get(key)
			if (statusEvent?.kind === state.status)
				contentRecords.push({
					id: `state:${state.bookId}`,
					userId,
					bookId: state.bookId,
					kind: state.status,
					occurredAt: statusEvent.occurredAt,
				})
			if (state.favorite && favoriteEvent)
				contentRecords.push({
					id: `favorite:${state.bookId}`,
					userId,
					bookId: state.bookId,
					kind: 'FAVORITE',
					occurredAt: favoriteEvent.occurredAt,
				})
		}
	} else {
		contentRecords.push(
			...[...latestStatus.values()].filter(
				(r) => r.userId === userId && r.kind !== 'NONE',
			),
			...[...latestFavorite.values()].filter(
				(r) => r.userId === userId && r.kind === 'FAVORITE',
			),
		)
	}
	for (const record of contentRecords) {
		const age = (now - Date.parse(record.occurredAt)) / 86400000,
			value =
				Math.max(0, kindWeights[record.kind] ?? 0) * Math.pow(0.5, age / 180)
		for (const [tag, tfidf] of bookVectors.get(record.bookId) ?? [])
			profile[tag] = (profile[tag] ?? 0) + value * tfidf
	}
	if (input.crossDomain !== false)
		for (const [tag, value] of Object.entries(
			snapshot.crossDomain[userId] ?? {},
		))
			profile[tag] =
				(profile[tag] ?? 0) + Math.min(1.5, Math.max(0, value)) * 0.25
	const profileVector = new Map(Object.entries(profile))
	const raw: BookScore[] = snapshot.books
		.filter((book) => !owned.has(book.id))
		.map((book) => {
			const userContributions: BookContribution[] = neighbors.flatMap((n) => {
				const value = matrix.get(n.userId)?.get(book.id) ?? 0
				return value
					? [
							{
								id: n.userId,
								similarity: n.similarity,
								overlap: n.overlap,
								contribution:
									(n.similarity * value) / (norm(matrix.get(n.userId)!) || 1),
							},
						]
					: []
			})
			const itemContributions: BookContribution[] = []
			for (const [id, value] of target) {
				const sim = similarity(
					inverted.get(id) ?? new Map(),
					inverted.get(book.id) ?? new Map(),
				)
				if (sim.similarity > 0)
					itemContributions.push({
						id,
						...sim,
						contribution:
							(sim.similarity * (sim.overlap / (sim.overlap + 2)) * value) /
							(norm(target) || 1),
					})
			}
			itemContributions.sort((a, b) => b.contribution - a.contribution)
			const selected = itemContributions.slice(0, neighborCount)
			return {
				id: book.id,
				score: 0,
				user: userContributions.reduce((s, c) => s + c.contribution, 0),
				item: selected.reduce((s, c) => s + c.contribution, 0),
				content: similarity(profileVector, bookVectors.get(book.id)!)
					.similarity,
				matchedTags: book.tags.filter((t) => (profile[t] ?? 0) > 0),
				userContributions,
				itemContributions: selected,
			}
		})
	const channels = {
		user: raw.some((r) => r.user > 0),
		item: raw.some((r) => r.item > 0),
		content: raw.some((r) => r.content > 0),
	}
	const weights = input.weights ?? { user: 0.35, item: 0.35, content: 0.3 }
	const maxima = {
		user: Math.max(0, ...raw.map((r) => r.user)),
		item: Math.max(0, ...raw.map((r) => r.item)),
		content: Math.max(0, ...raw.map((r) => r.content)),
	}
	const mode = input.mode ?? 'hybrid'
	for (const row of raw) {
		if (mode !== 'hybrid')
			row.score = maxima[mode] ? row[mode] / maxima[mode] : 0
		else {
			let sum = 0,
				total = 0
			for (const channel of ['user', 'item', 'content'] as const)
				if (channels[channel]) {
					const w = Math.max(0, weights[channel])
					sum += (row[channel] / maxima[channel]) * w
					total += w
				}
			row.score = total ? sum / total : 0
		}
	}
	const heapSteps: BookRecommendationResult['heapSteps'] = []
	const items = selectTopK(
		raw,
		resultCount,
		(a, b) => a.score - b.score || b.id.localeCompare(a.id),
		(action, row, size) => heapSteps.push({ action, bookId: row.id, size }),
	)
	return {
		items,
		matrix: [...matrix].map(([id, row]) => ({
			userId: id,
			entries: [...row].map(([bookId, value]) => ({
				bookId,
				value,
				normalized: value / (norm(row) || 1),
			})),
		})),
		neighbors,
		profile,
		channels,
		candidateCount: raw.length,
		heapSteps,
	}
}
