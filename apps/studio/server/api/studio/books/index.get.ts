import { readOnlyBookSnapshot } from '@campus/domain/books'
import { studioDatabaseUrl } from '../../../utils/snapshot'
export default defineEventHandler(async () => {
	const snapshot = await readOnlyBookSnapshot(studioDatabaseUrl())
	return {
		users: snapshot.users.map((u) => ({ id: u.id, name: u.name })),
		books: snapshot.books,
		recordCount: snapshot.records.length,
	}
})
