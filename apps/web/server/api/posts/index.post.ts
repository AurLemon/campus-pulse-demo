import { readBody } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '@campus/domain/prisma'
import {
	api,
	actor,
	businessNow,
	objectBody,
	text,
	tags,
	fail,
} from '../../utils/api'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	const user = await actor(event)
	if (b.kind !== undefined && b.kind !== 'TEXT' && b.kind !== 'ARTICLE')
		fail('VALIDATION_FAILED', 422, { kind: 'INVALID_FIELD' })
	const activityId = b.activityId ? text(b.activityId, 'activityId', 100) : null
	if (
		activityId &&
		!(await db.activity.findUnique({ where: { id: activityId } }))
	)
		fail('NOT_FOUND', 404)
	const mediaIds = Array.isArray(b.mediaIds) ? b.mediaIds : []
	if (mediaIds.length > 9 || mediaIds.some((id) => typeof id !== 'string'))
		fail('VALIDATION_FAILED', 422, { mediaIds: 'INVALID_FIELD' })
	const assets = await db.mediaAsset.findMany({
		where: { id: { in: mediaIds as string[] } },
	})
	if (
		assets.length !== mediaIds.length ||
		assets.some((m) => m.ownerId !== user.id)
	)
		fail('FORBIDDEN', 403)
	const purpose = b.purpose ?? 'DISCUSSION'
	if (
		!['RECRUITMENT', 'REVIEW', 'GUIDE', 'DISCUSSION'].includes(String(purpose))
	)
		fail('VALIDATION_FAILED', 422, { purpose: 'INVALID_FIELD' })
	const title = text(b.title, 'title', 120)
	const posterTemplate =
			b.posterTemplate === undefined ? 'orbit' : b.posterTemplate,
		posterAspect = b.posterAspect === undefined ? 'portrait' : b.posterAspect
	const posterHighlight =
		b.posterHighlight === undefined ? '' : b.posterHighlight
	if (typeof posterHighlight !== 'string' || posterHighlight.length > 40)
		fail('VALIDATION_FAILED', 422, { posterHighlight: 'INVALID_FIELD' })
	if (
		posterTemplate !== 'orbit' &&
		posterTemplate !== 'quote' &&
		posterTemplate !== 'note'
	)
		fail('VALIDATION_FAILED', 422, { posterTemplate: 'INVALID_FIELD' })
	if (
		posterAspect !== 'portrait' &&
		posterAspect !== 'square' &&
		posterAspect !== 'landscape'
	)
		fail('VALIDATION_FAILED', 422, { posterAspect: 'INVALID_FIELD' })
	if (posterHighlight && !title.includes(posterHighlight))
		fail('VALIDATION_FAILED', 422, { posterHighlight: 'INVALID_FIELD' })
	return db.post.create({
		select: { id: true },
		data: {
			id: randomUUID(),
			authorId: user.id,
			activityId,
			title,
			posterTemplate,
			posterAspect,
			posterHighlight,
			body: text(b.body, 'body', 20000),
			tags: JSON.stringify(tags(b.tags ?? [])),
			purpose: String(purpose),
			mediaIds: JSON.stringify(mediaIds),
			kind: b.kind === 'ARTICLE' ? 'ARTICLE' : 'TEXT',
			createdAt: await businessNow(),
			source: 'Real',
		},
	})
})
