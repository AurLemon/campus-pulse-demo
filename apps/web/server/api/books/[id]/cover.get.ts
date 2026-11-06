import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getRouterParam, setHeader } from 'h3'
import { dataDirectory, db } from '@campus/domain/prisma'
import { api, fail } from '../../../utils/api'
export default api(async (event) => {
	const id = getRouterParam(event, 'id') ?? ''
	if (!/^(douban|ituring)-\d+$/.test(id)) fail('NOT_FOUND', 404)
	if (!(await db.book.findUnique({ where: { id }, select: { id: true } })))
		fail('NOT_FOUND', 404)
	let bytes: Buffer
	try {
		bytes = await readFile(
			resolve(dataDirectory, 'books', 'covers', `${id}.webp`),
		)
	} catch {
		fail('NOT_FOUND', 404)
	}
	setHeader(event, 'content-type', 'image/webp')
	setHeader(event, 'cache-control', 'public, max-age=86400')
	return bytes
})
