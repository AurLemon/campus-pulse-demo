import { getRouterParam } from 'h3'
import { db } from '@campus/domain/prisma'
import { bookView } from '@campus/domain/books'
import { api, optionalActor, fail } from '../../utils/api'
export default api(async (event) => {
	const book = await db.book.findUnique({
		where: { id: getRouterParam(event, 'id') },
	})
	if (!book) fail('NOT_FOUND', 404)
	return bookView(db, book, (await optionalActor(event))?.id)
})
