import Database from 'better-sqlite3'
import { PrismaClient } from '../../generated/prisma/client.ts'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
export const dataDirectory = process.env.CAMPUS_DATA_DIR ?? resolve('.data')
mkdirSync(dataDirectory, { recursive: true })
export const databaseUrl =
	process.env.DATABASE_URL ?? `file:${resolve(dataDirectory, 'pulse.db')}`
if (databaseUrl.startsWith('file:')) {
	const settings = new Database(databaseUrl.slice(5), { timeout: 3000 })
	try {
		settings.pragma('journal_mode = WAL')
	} finally {
		settings.close()
	}
}
const globalDb = globalThis as unknown as { campusPrisma?: PrismaClient }
export const db =
	globalDb.campusPrisma ??
	new PrismaClient({
		adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 3000 }),
	})
if (process.env.NODE_ENV !== 'production') globalDb.campusPrisma = db
