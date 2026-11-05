import { PrismaClient } from '../../generated/prisma/client.ts'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { readSnapshot } from './snapshot-reader.ts'
/** The driver itself rejects writes and cannot create a missing database file. */
export async function loadReadOnlySnapshot(
	url: string,
	now = new Date().toISOString(),
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
		return await readSnapshot(db, now)
	} finally {
		await db.$disconnect()
	}
}
