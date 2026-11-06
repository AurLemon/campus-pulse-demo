import '../agents/environment.ts'
import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { db } from '../../packages/domain/prisma.ts'
interface Candidate {
	id: string
	title: string
	authors: string[]
	publisher: string
	description: string
	language: string
	isbn13: string | null
	workKey: string
	coverUrl: string
	tags: string[]
	academic: boolean
	source: string
	sourceUrl: string
	fetchedAt: string
	copies: number
	detailVerified?: boolean
}
interface Check {
	url: string
	valid: boolean
	width?: number
	height?: number
	sha256?: string
	checkedAt: string
}
const root = resolve(process.env.CAMPUS_DATA_DIR ?? '.data', 'books'),
	checks = JSON.parse(
		await readFile(resolve(root, 'cover-checks.json'), 'utf8'),
	) as Record<string, Check>
const catalogue = JSON.parse(
	await readFile(
		resolve(
			root,
			process.argv.includes('--from-bundle')
				? 'accepted.json'
				: 'catalogue.json',
		),
		'utf8',
	),
) as Candidate[]
let turing: Candidate[] = []
try {
	turing = JSON.parse(
		await readFile(resolve(root, 'turing-catalogue.json'), 'utf8'),
	) as Candidate[]
} catch {
	/* No optional source/checkpoint has been written yet. */
}
function validIsbn(value: string | null) {
	if (!value) return null
	const clean = value.replace(/[^0-9X]/g, '')
	if (!/^97[89]\d{10}$/.test(clean)) return null
	return [...clean].reduce(
		(sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1),
		0,
	) %
		10 ===
		0
		? clean
		: null
}
function workKey(book: Candidate) {
	const title = book.title
		.replace(
			/[（(][^）)]*(?:第[一二三四五六七八九十\d]+版|修订|增订|纪念|典藏|精装|平装|插图)[^）)]*[）)]/g,
			'',
		)
		.replace(/第[一二三四五六七八九十\d]+版/g, '')
	const author =
		book.authors[0]?.replace(/\[[^\]]+\]|【[^】]+】|（[^）]+）/g, '') ?? ''
	return `${title}${author}`.replace(/[\p{P}\p{S}\s_]+/gu, '').toLowerCase()
}
const works = new Set<string>(),
	isbns = new Set<string>(),
	accepted: Candidate[] = []
const rejected: { id: string; reason: string }[] = []
// Complete publisher metadata takes precedence over list excerpts for overlapping works.
for (const book of process.argv.includes('--from-bundle')
	? catalogue
	: [...turing, ...catalogue]) {
	const check = checks[book.id]
	if (!check?.valid || check.url !== book.coverUrl) {
		rejected.push({ id: book.id, reason: 'COVER_NOT_VERIFIED' })
		continue
	}
	try {
		await access(resolve(root, 'covers', `${book.id}.webp`))
	} catch {
		rejected.push({ id: book.id, reason: 'COVER_FILE_MISSING' })
		continue
	}
	if (
		!book.title ||
		!book.authors.length ||
		!book.publisher ||
		book.description.length < 20
	) {
		rejected.push({ id: book.id, reason: 'MISSING_METADATA' })
		continue
	}
	const key = workKey(book),
		isbn = validIsbn(book.isbn13)
	if (works.has(key) || (isbn && isbns.has(isbn))) {
		rejected.push({ id: book.id, reason: 'DUPLICATE_WORK_OR_ISBN' })
		continue
	}
	works.add(key)
	if (isbn) isbns.add(isbn)
	// School exercise books and language readers are not counted as university material.
	const academic =
		book.academic &&
		!/小学|初中|高中|高考|中考|幼儿|儿童|少儿|绘本|新概念英语|书虫|英语900句|英语口语|雅思|托福|考研英语|英语词汇|新东方/.test(
			book.title,
		)
	accepted.push({ ...book, isbn13: isbn, workKey: key, academic })
}
const limit = process.argv.includes('--sample') ? 30 : 1000
const academicBooks = accepted.filter((book) => book.academic).slice(0, 160)
const generalBooks = accepted.filter((book) => !book.academic)
const selected = (
	process.argv.includes('--from-bundle')
		? accepted
		: [...generalBooks, ...academicBooks]
).slice(0, limit)
for (const row of selected) {
	const { detailVerified: _verified, ...book } = row
	const existing = await db.book.findFirst({
		where: {
			OR: [
				{ workKey: book.workKey },
				...(book.isbn13 ? [{ isbn13: book.isbn13 }] : []),
			],
		},
	})
	if (existing && existing.id !== book.id) {
		rejected.push({ id: book.id, reason: `EXISTING_WORK:${existing.id}` })
		continue
	}
	await db.book.upsert({
		where: { id: book.id },
		create: {
			...book,
			authors: JSON.stringify(book.authors),
			tags: JSON.stringify(book.tags),
			coverUrl: `/api/books/${book.id}/cover`,
		},
		update: {
			...book,
			authors: JSON.stringify(book.authors),
			tags: JSON.stringify(book.tags),
			coverUrl: `/api/books/${book.id}/cover`,
		},
	})
}
const stored = await db.book.findMany({
	select: { id: true, academic: true, isbn13: true, source: true, tags: true },
})
const report = {
	selected: selected.length,
	imported: stored.length,
	total: await db.book.count(),
	academic: stored.filter((b) => b.academic).length,
	isbn: stored.filter((b) => b.isbn13).length,
	detailVerified: stored.filter(
		(row) =>
			[...turing, ...catalogue].find((book) => book.id === row.id)
				?.detailVerified,
	).length,
	sources: Object.fromEntries(
		[...new Set(stored.map((b) => b.source))].map((source) => [
			source,
			stored.filter((b) => b.source === source).length,
		]),
	),
	tags: Object.fromEntries(
		[...new Set(stored.flatMap((b) => JSON.parse(b.tags) as string[]))].map(
			(tag) => [
				tag,
				stored.filter((b) => (JSON.parse(b.tags) as string[]).includes(tag))
					.length,
			],
		),
	),
	rejected,
	importedAt: new Date().toISOString(),
}
await writeFile(
	resolve(root, 'import-report.json'),
	JSON.stringify(report, null, 2) + '\n',
)
// The archive keeps source material and image checks independently from product DTOs.
const acceptedStored = stored.flatMap((row) => {
	const original = [...turing, ...catalogue].find((book) => book.id === row.id)
	return original ? [{ ...original, academic: row.academic }] : []
})
await writeFile(
	resolve(root, 'accepted.json'),
	JSON.stringify(acceptedStored, null, 2) + '\n',
)
if (process.argv.includes('--seed-demo')) {
	const users = await db.user.findMany({
		where: { source: 'Synthetic' },
		select: { id: true, interests: true },
	})
	const batch = 'Synthetic:books-reading-demo-v1',
		now = Date.now()
	let count = 0,
		loanCount = 0
	for (const user of users) {
		const interests = JSON.parse(user.interests) as Record<string, number>
		const ranked = selected
			.filter((book) => stored.some((row) => row.id === book.id))
			.map((book) => ({
				book,
				score: book.tags.reduce((sum, tag) => sum + (interests[tag] ?? 0), 0),
				tie: createHash('sha256').update(`${user.id}:${book.id}`).digest('hex'),
			}))
			.sort((a, b) => b.score - a.score || a.tie.localeCompare(b.tie))
		// Shared interest choices and a bounded broad exploration segment create overlap without touching real accounts.
		const chosen = [...ranked.slice(0, 6), ...ranked.slice(12, 16)]
		for (let index = 0; index < chosen.length; index++) {
			const book = chosen[index]!.book,
				id = `books-demo:${user.id}:${book.id}`
			if (await db.bookReadingRecord.findUnique({ where: { id } })) continue
			const occurredAt = new Date(
				now - (7 + index * 11) * 86400000,
			).toISOString()
			await db.$transaction(async (tx) => {
				await tx.bookReadingRecord.create({
					data: {
						id,
						userId: user.id,
						bookId: book.id,
						kind: 'READ',
						occurredAt,
						source: batch,
					},
				})
				const state = await tx.bookState.findUnique({
					where: { userId_bookId: { userId: user.id, bookId: book.id } },
				})

				if (index < 3) {
					const borrowedAt = new Date(
							Date.parse(occurredAt) - 14 * 86400000,
						).toISOString(),
						returnedAt = new Date(
							Date.parse(occurredAt) - 7 * 86400000,
						).toISOString()
					await tx.bookLoan.create({
						data: {
							id: `${id}:loan`,
							userId: user.id,
							bookId: book.id,
							borrowedAt,
							dueAt: new Date(
								Date.parse(borrowedAt) + 30 * 86400000,
							).toISOString(),
							returnedAt,
							activeKey: null,
							source: batch,
						},
					})
					await tx.bookReadingRecord.createMany({
						data: [
							{
								id: `${id}:borrow`,
								userId: user.id,
								bookId: book.id,
								kind: 'BORROW',
								occurredAt: borrowedAt,
								source: batch,
							},
							{
								id: `${id}:return`,
								userId: user.id,
								bookId: book.id,
								kind: 'RETURN',
								occurredAt: returnedAt,
								source: batch,
							},
						],
					})
				}
				if (!state)
					await tx.bookState.create({
						data: {
							id: randomUUID(),
							userId: user.id,
							bookId: book.id,
							status: 'READ',
							favorite: false,
							updatedAt: occurredAt,
						},
					})
			})
			count++
			if (index < 3) loanCount++
		}
	}
	await writeFile(
		resolve(root, 'demo-reading-report.json'),
		JSON.stringify(
			{
				batch,
				users: users.length,
				records: count + 2 * loanCount,
				readingRecords: count,
				returnedLoans: loanCount,
				createdAt: new Date().toISOString(),
				notice:
					'Synthetic demonstration records. Not university library circulation or real-user evaluation.',
			},
			null,
			2,
		) + '\n',
	)
	console.log(
		JSON.stringify({
			syntheticDemoRecordsAdded: count + 2 * loanCount,
			syntheticReturnedLoansAdded: loanCount,
			syntheticUsers: users.length,
		}),
	)
}
console.log(JSON.stringify({ ...report, rejected: rejected.length }))
await db.$disconnect()
