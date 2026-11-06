import { addBookInterestSignals } from './book-interest-projection.ts'
import { db } from './prisma.ts'
import { readSnapshot } from './snapshot-reader.ts'
export async function loadSnapshot(
	now = new Date().toISOString(),
	options: { crossDomain?: boolean } = {},
) {
	const snapshot = await readSnapshot(db, now)
	return options.crossDomain === false
		? snapshot
		: addBookInterestSignals(db, snapshot)
}
