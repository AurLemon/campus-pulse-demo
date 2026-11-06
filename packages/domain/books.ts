import { randomUUID } from 'node:crypto'
import {
	PrismaClient,
	type Prisma,
	type Book,
} from '../../generated/prisma/client.ts'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import type {
	BookView,
	BookStatus,
	BookSnapshot,
} from '@campus/contracts/books'
import { createError } from 'h3'
function fail(code: string, statusCode = 400): never {
	throw createError({ statusCode, statusMessage: code, data: { code } })
}

type Client = PrismaClient | Prisma.TransactionClient
function strings(raw: string): string[] {
	const value: unknown = JSON.parse(raw)
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === 'string')
		: []
}
export async function bookView(
	client: Client,
	book: Book,
	userId?: string,
): Promise<BookView> {
	const [state, loans] = await Promise.all([
		userId
			? client.bookState.findUnique({
					where: { userId_bookId: { userId, bookId: book.id } },
				})
			: null,
		client.bookLoan.findMany({ where: { bookId: book.id, returnedAt: null } }),
	])
	const loan = loans.find((row) => row.userId === userId)
	return {
		id: book.id,
		title: book.title,
		authors: strings(book.authors),
		publisher: book.publisher,
		description: book.description,
		language: book.language,
		isbn13: book.isbn13,
		coverUrl: book.coverUrl,
		tags: strings(book.tags),
		academic: book.academic,
		copies: book.copies,
		available: Math.max(0, book.copies - loans.length),
		status: (state?.status ?? 'NONE') as BookStatus,
		favorite: state?.favorite ?? false,
		loan: loan
			? {
					id: loan.id,
					borrowedAt: loan.borrowedAt,
					dueAt: loan.dueAt,
					returnedAt: loan.returnedAt,
				}
			: null,
	}
}
export async function readBookSnapshot(
	client: PrismaClient,
	now = new Date().toISOString(),
): Promise<BookSnapshot> {
	const [books, users, records, states, posts, behaviors, bookStates] =
		await client.$transaction([
			client.book.findMany(),
			client.user.findMany({
				select: { id: true, name: true, interests: true },
			}),
			client.bookReadingRecord.findMany(),
			client.state.findMany({
				where: { postId: { not: null }, kind: { in: ['FAVORITE', 'LIKE'] } },
			}),
			client.post.findMany({ select: { id: true, tags: true } }),
			client.behavior.findMany({
				where: { postId: { not: null }, kind: 'VIEW', createdAt: { lte: now } },
			}),
			client.bookState.findMany(),
		])
	const tags = new Map(posts.map((p) => [p.id, strings(p.tags)])),
		crossDomain: Record<string, Record<string, number>> = {}
	const signals = new Map<
		string,
		{ userId: string; postId: string; value: number }
	>()
	for (const state of states) {
		if (!state.postId || state.createdAt > now) continue
		const key = `${state.userId}:${state.postId}`,
			signal = signals.get(key) ?? {
				userId: state.userId,
				postId: state.postId,
				value: 0,
			}
		signal.value = Math.min(
			0.6,
			signal.value + (state.kind === 'FAVORITE' ? 0.4 : 0.2),
		)
		signals.set(key, signal)
	}
	for (const behavior of behaviors) {
		if (!behavior.postId) continue
		const age = (Date.parse(now) - Date.parse(behavior.createdAt)) / 86400000
		if (!Number.isFinite(age) || age < 0) continue
		const key = `${behavior.userId}:${behavior.postId}`,
			signal = signals.get(key) ?? {
				userId: behavior.userId,
				postId: behavior.postId,
				value: 0,
			}
		signal.value = Math.min(
			0.7,
			signal.value +
				Math.min(1, Math.max(0, behavior.effectiveMs) / 30000) *
					0.1 *
					Math.pow(0.5, age / 30),
		)
		signals.set(key, signal)
	}
	for (const signal of signals.values()) {
		const row = crossDomain[signal.userId] ?? {}
		for (const tag of tags.get(signal.postId) ?? [])
			row[tag] = Math.min(1.5, (row[tag] ?? 0) + signal.value)
		crossDomain[signal.userId] = row
	}
	return {
		books: books.map((b) => ({
			id: b.id,
			title: b.title,
			tags: strings(b.tags),
		})),
		users: users.map((u) => ({
			id: u.id,
			name: u.name,
			interests: JSON.parse(u.interests) as Record<string, number>,
		})),
		records: records.map(({ id, userId, bookId, kind, occurredAt }) => ({
			id,
			userId,
			bookId,
			kind,
			occurredAt,
		})),
		states: bookStates.map(
			({ userId, bookId, status, favorite, updatedAt }) => ({
				userId,
				bookId,
				status,
				favorite,
				updatedAt,
			}),
		),
		crossDomain,
	}
}
/** A separate driver enforces Studio's read-only database boundary. */
export async function readOnlyBookSnapshot(url: string) {
	if (!url.startsWith('file:')) throw new Error('SQLITE_FILE_URL_REQUIRED')
	const client = new PrismaClient({
		adapter: new PrismaBetterSqlite3({
			url,
			readonly: true,
			fileMustExist: true,
			timeout: 1500,
		}),
	})
	try {
		return await readBookSnapshot(client)
	} finally {
		await client.$disconnect()
	}
}
export async function setBookState(
	client: PrismaClient,
	userId: string,
	bookId: string,
	input: { status?: unknown; favorite?: unknown },
	now = new Date().toISOString(),
) {
	if (
		input.status !== undefined &&
		!['NONE', 'WANT', 'READING', 'READ'].includes(String(input.status))
	)
		fail('VALIDATION_FAILED', 422)
	if (input.favorite !== undefined && typeof input.favorite !== 'boolean')
		fail('VALIDATION_FAILED', 422)
	if (input.status === undefined && input.favorite === undefined)
		fail('VALIDATION_FAILED', 422)
	await client.$transaction(async (tx) => {
		if (!(await tx.book.findUnique({ where: { id: bookId } })))
			fail('NOT_FOUND', 404)
		const previous = await tx.bookState.findUnique({
			where: { userId_bookId: { userId, bookId } },
		})
		const status = String(input.status ?? previous?.status ?? 'NONE'),
			favorite = (input.favorite ?? previous?.favorite ?? false) as boolean
		if (
			status === (previous?.status ?? 'NONE') &&
			favorite === (previous?.favorite ?? false)
		)
			return
		await tx.bookState.upsert({
			where: { userId_bookId: { userId, bookId } },
			create: {
				id: randomUUID(),
				userId,
				bookId,
				status,
				favorite,
				updatedAt: now,
			},
			update: { status, favorite, updatedAt: now },
		})
		const kinds: string[] = []
		if (input.status !== undefined && status !== (previous?.status ?? 'NONE'))
			kinds.push(status)
		if (
			input.favorite !== undefined &&
			favorite !== (previous?.favorite ?? false)
		)
			kinds.push(favorite ? 'FAVORITE' : 'UNFAVORITE')
		for (const kind of kinds)
			await tx.bookReadingRecord.create({
				data: {
					id: randomUUID(),
					userId,
					bookId,
					kind,
					occurredAt: now,
					source: (
						await tx.user.findUniqueOrThrow({
							where: { id: userId },
							select: { source: true },
						})
					).source,
				},
			})
	})
	return { ok: true }
}
export async function changeBookLoan(
	client: PrismaClient,
	userId: string,
	bookId: string,
	action: 'borrow' | 'return',
	now = new Date().toISOString(),
) {
	const { enqueueCommunityEvent } = await import('./messages.ts')
	return client.$transaction(async (tx) => {
		const book = await tx.book.findUnique({ where: { id: bookId } })
		if (!book) fail('NOT_FOUND', 404)
		const activeKey = `${userId}:${bookId}`
		const existing = await tx.bookLoan.findUnique({ where: { activeKey } })
		if (action === 'borrow') {
			if (existing) return { ok: true, loanId: existing.id }
			const active = await tx.bookLoan.count({
				where: { bookId, returnedAt: null },
			})
			if (active >= book.copies) fail('BOOK_UNAVAILABLE', 409)
			const count = await tx.bookLoan.count({
				where: { userId, returnedAt: null },
			})
			if (count >= 5) fail('BOOK_LOAN_LIMIT', 409)
			const id = randomUUID(),
				dueAt = new Date(Date.parse(now) + 30 * 86400000).toISOString()
			await tx.bookLoan.create({
				data: {
					id,
					userId,
					bookId,
					activeKey,
					borrowedAt: now,
					dueAt,
					source: (
						await tx.user.findUniqueOrThrow({
							where: { id: userId },
							select: { source: true },
						})
					).source,
				},
			})
			await tx.bookReadingRecord.create({
				data: {
					id: randomUUID(),
					userId,
					bookId,
					kind: 'BORROW',
					occurredAt: now,
					source: (
						await tx.user.findUniqueOrThrow({
							where: { id: userId },
							select: { source: true },
						})
					).source,
				},
			})
			await enqueueCommunityEvent(tx, {
				id,
				kind: 'BookLoanChanged',
				actorId: userId,
				recipientId: userId,
				targetType: 'book',
				targetId: bookId,
				occurredAt: now,
			})
			return { ok: true, loanId: id }
		}
		if (!existing) return { ok: true }
		await tx.bookLoan.update({
			where: { id: existing.id },
			data: { returnedAt: now, activeKey: null },
		})
		await tx.bookReadingRecord.create({
			data: {
				id: randomUUID(),
				userId,
				bookId,
				kind: 'RETURN',
				occurredAt: now,
				source: (
					await tx.user.findUniqueOrThrow({
						where: { id: userId },
						select: { source: true },
					})
				).source,
			},
		})
		await enqueueCommunityEvent(tx, {
			id: `${existing.id}:return`,
			kind: 'BookLoanChanged',
			actorId: userId,
			recipientId: userId,
			targetType: 'book',
			targetId: bookId,
			occurredAt: now,
		})
		return { ok: true, loanId: existing.id }
	})
}
/** Bounded projection for post/activity recommenders, never written back as behaviors. */
export async function projectBookInterests(
	client: PrismaClient,
	userId: string,
) {
	const rows = await client.bookState.findMany({
			where: { userId },
			include: { book: true },
		}),
		profile: Record<string, number> = {}
	for (const row of rows)
		for (const tag of strings(row.book.tags))
			profile[tag] = Math.min(
				0.5,
				(profile[tag] ?? 0) +
					(row.status === 'READ'
						? 0.15
						: row.status === 'READING'
							? 0.1
							: 0.04) +
					(row.favorite ? 0.05 : 0),
			)
	return profile
}
