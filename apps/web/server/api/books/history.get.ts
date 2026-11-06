import { db } from '@campus/domain/prisma'
import { api, actor } from '../../utils/api'
export default api(async (event) => {
	const userId = (await actor(event)).id
	const [loans, records] = await Promise.all([
		db.bookLoan.findMany({
			where: { userId },
			orderBy: { borrowedAt: 'desc' },
			take: 200,
			include: {
				book: {
					select: { id: true, title: true, coverUrl: true, authors: true },
				},
			},
		}),
		db.bookReadingRecord.findMany({
			where: { userId },
			orderBy: { occurredAt: 'desc' },
			take: 200,
			include: {
				book: {
					select: { id: true, title: true, coverUrl: true, authors: true },
				},
			},
		}),
	])
	return {
		loans: loans.map(({ source: _source, activeKey: _activeKey, ...row }) => ({
			...row,
			book: { ...row.book, authors: JSON.parse(row.book.authors) as string[] },
		})),
		records: records.map(({ source: _source, ...row }) => ({
			...row,
			book: { ...row.book, authors: JSON.parse(row.book.authors) as string[] },
		})),
	}
})
