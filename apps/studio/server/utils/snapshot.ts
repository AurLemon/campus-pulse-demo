import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { createError } from 'h3'
import { loadReadOnlySnapshot } from '@campus/domain/readonly-snapshot'
export function studioDatabaseUrl() {
	return (
		useRuntimeConfig().studioDatabaseUrl ||
		process.env.DATABASE_URL ||
		`file:${resolve(process.env.CAMPUS_DATA_DIR || '.data', 'pulse.db')}`
	)
}
export async function readStudioRevision() {
	const url = studioDatabaseUrl()
	if (!url.startsWith('file:'))
		throw createError({
			statusCode: 503,
			statusMessage: 'STUDIO_DATABASE_UNAVAILABLE',
		})
	try {
		const file = url.slice(5),
			db = await stat(file)
		let wal = ''
		try {
			const value = await stat(`${file}-wal`)
			wal = `${value.mtimeMs}:${value.size}`
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
		return `${db.mtimeMs}:${db.size}:${wal}`
	} catch {
		throw createError({
			statusCode: 503,
			statusMessage: 'STUDIO_DATABASE_UNAVAILABLE',
		})
	}
}
export async function readStudioSnapshot(crossDomain = true) {
	try {
		const revision = await readStudioRevision()
		const snapshot = await loadReadOnlySnapshot(
			studioDatabaseUrl(),
			new Date().toISOString(),
			{ crossDomain },
		)
		if (
			!snapshot.users.length ||
			(!snapshot.posts.length && !snapshot.activities.length)
		)
			throw new Error('EMPTY_DATABASE')
		return { snapshot, revision }
	} catch {
		throw createError({
			statusCode: 503,
			statusMessage: 'STUDIO_DATABASE_UNAVAILABLE',
		})
	}
}
