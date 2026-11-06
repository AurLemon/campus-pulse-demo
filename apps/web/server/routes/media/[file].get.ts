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
import { db } from '@campus/domain/prisma'
import { optionalActor } from '@campus/domain/validation'
import { mediaDirectory } from '@campus/domain/media'
export default defineEventHandler(async (event) => {
	const file = getRouterParam(event, 'file') ?? ''
	if (!/^[a-zA-Z0-9_-]+\.webp$/.test(file))
		throw createError({ statusCode: 404 })
	const asset = await db.mediaAsset.findFirst({
		where: { url: `/media/${file}` },
	})
	let privateMedia = false
	if (asset?.ownerId) {
		const token = JSON.stringify(asset.id)
		const [post, comment, activity] = await Promise.all([
			db.post.findFirst({
				where: { mediaIds: { contains: token } },
				select: { id: true },
			}),
			db.comment.findFirst({
				where: { mediaIds: { contains: token }, deletedAt: null },
				select: { id: true },
			}),
			db.activity.findFirst({
				where: { coverId: asset.id },
				select: { id: true },
			}),
		])
		if (!post && !comment && !activity) {
			privateMedia = true
			const viewer = await optionalActor(event)
			if (!viewer) throw createError({ statusCode: 404 })
			if (viewer.id !== asset.ownerId) {
				const conversations = await db.conversation.findMany({
					where: { OR: [{ userLow: viewer.id }, { userHigh: viewer.id }] },
					select: { id: true },
				})
				const message = await db.directMessage.findFirst({
					where: {
						conversationId: { in: conversations.map((c) => c.id) },
						mediaIds: { contains: token },
					},
					select: { id: true },
				})
				if (!message) throw createError({ statusCode: 404 })
			}
		}
	}
	const path = resolve(mediaDirectory, file)
	const info = await stat(path).catch(() => null)
	if (!info?.isFile()) throw createError({ statusCode: 404 })
	setHeader(event, 'Content-Type', 'image/webp')
	setHeader(event, 'X-Content-Type-Options', 'nosniff')
	setHeader(
		event,
		'Cache-Control',
		privateMedia ? 'private, no-store' : 'public, max-age=31536000, immutable',
	)
	return sendStream(event, createReadStream(path))
})
