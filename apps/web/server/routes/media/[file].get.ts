import {
	defineEventHandler,
	getRouterParam,
	sendStream,
	setHeader,
	createError,
} from 'h3'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mediaDirectory } from '@campus/domain/media'
export default defineEventHandler(async (event) => {
	const file = getRouterParam(event, 'file') ?? ''
	if (!/^[a-zA-Z0-9_-]+\.webp$/.test(file))
		throw createError({ statusCode: 404 })
	const path = resolve(mediaDirectory, file)
	const info = await stat(path).catch(() => null)
	if (!info?.isFile()) throw createError({ statusCode: 404 })
	setHeader(event, 'Content-Type', 'image/webp')
	setHeader(event, 'X-Content-Type-Options', 'nosniff')
	setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
	return sendStream(event, createReadStream(path))
})
