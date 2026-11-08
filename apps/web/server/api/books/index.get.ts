import { getQuery } from 'h3'
import { db } from '@campus/domain/prisma'
import { bookView, readBookSnapshot } from '@campus/domain/books'
import { recommendBooks } from '@campus/recommendation/books'
import type { BookMode } from '@campus/contracts/books'
import { api, optionalActor, fail } from '../../utils/api'
export default api(async (event) => {
	const query = getQuery(event),
		user = await optionalActor(event)
	const mode = String(query.mode ?? 'hybrid'),
		search = String(query.q ?? '')
			.trim()
			.slice(0, 120),
		tag = String(query.tag ?? '')
	if (!['all', 'hybrid', 'user', 'item', 'content', 'mine'].includes(mode))
		fail('VALIDATION_FAILED', 422)
	const page = Number(query.page ?? 1),
		pageSize = 24
	if (!Number.isSafeInteger(page) || page < 1) fail('VALIDATION_FAILED', 422)
	const books = await db.book.findMany({
		orderBy: [{ title: 'asc' }, { id: 'asc' }],
	})
	const tags = [
		...new Set(books.flatMap((b) => JSON.parse(b.tags) as string[])),
	].sort()
	let filtered = books.filter(
		(b) =>
			(!search ||
				`${b.title} ${b.authors} ${b.publisher}`
					.toLowerCase()
					.includes(search.toLowerCase())) &&
			(!tag || (JSON.parse(b.tags) as string[]).includes(tag)) &&
			(query.academic !== '1' || b.academic),
	)
	if (mode === 'mine') {
		const states = user
			? await db.bookState.findMany({
					where: {
						userId: user.id,
						OR: [{ status: { not: 'NONE' } }, { favorite: true }],
					},
				})
			: []
		const loans = user
			? await db.bookLoan.findMany({
					where: { userId: user.id, returnedAt: null },
				})
			: []
		const ids = new Set([...states, ...loans].map((s) => s.bookId))
		filtered = filtered.filter((b) => ids.has(b.id))
	} else if (mode !== 'all') {
		const snapshot = await readBookSnapshot(db)
		const result = recommendBooks({
			snapshot,
			userId: user?.id ?? 'guest',
			now: new Date().toISOString(),
			mode: mode as BookMode,
			resultCount: books.length,
			crossDomain: query.crossDomain !== '0',
		})
		const index = new Map(result.items.map((b, i) => [b.id, i]))
		filtered = filtered
			.filter((b) => index.has(b.id))
			.sort((a, b) => index.get(a.id)! - index.get(b.id)!)
	}
	return {
		items: await Promise.all(
			filtered
				.slice((page - 1) * pageSize, page * pageSize)
				.map((b) => bookView(db, b, user?.id)),
		),
		total: filtered.length,
		hasMore: page * pageSize < filtered.length,
		tags,
	}
})
