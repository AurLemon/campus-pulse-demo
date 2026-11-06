import { addBookInterestSignals } from './book-interest-projection.ts'
import { PrismaClient } from '../../generated/prisma/client.ts'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { readSnapshot } from './snapshot-reader.ts'
/** The driver itself rejects writes and cannot create a missing database file. */
export async function loadReadOnlySnapshot(
	url: string,
	now = new Date().toISOString(),
	options: { crossDomain?: boolean } = {},
) {
	if (!url.startsWith('file:')) throw new Error('SQLITE_FILE_URL_REQUIRED')
	const db = new PrismaClient({
		adapter: new PrismaBetterSqlite3({
			url,
			readonly: true,
			fileMustExist: true,
			timeout: 1500,
		}),
	})
	try {
		const snapshot = await readSnapshot(db, now)
		return options.crossDomain === false
			? snapshot
			: await addBookInterestSignals(db, snapshot)
	} finally {
		await db.$disconnect()
	}
}
