import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Serve only the shared public portrait set, never private message media.
export default defineEventHandler(async (event) => {
	const file = getRouterParam(event, 'file') ?? ''
	const match = /^anime-avatar-u([1-9][0-9]{0,2})\.webp$/.exec(file)
	if (!match || Number(match[1]) > 200) throw createError({ statusCode: 404 })
	const directory =
		process.env.CAMPUS_MEDIA_DIR ??
		resolve(process.env.CAMPUS_DATA_DIR ?? '.data', 'media')
	try {
		const bytes = await readFile(resolve(directory, file))
		setHeader(event, 'Content-Type', 'image/webp')
		setHeader(event, 'Cache-Control', 'public, max-age=86400')
		return bytes
	} catch {
		throw createError({ statusCode: 404 })
	}
})
