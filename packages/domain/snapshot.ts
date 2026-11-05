import { db } from './prisma.ts'
import { readSnapshot } from './snapshot-reader.ts'
export async function loadSnapshot(now = new Date().toISOString()) {
	return readSnapshot(db, now)
}
