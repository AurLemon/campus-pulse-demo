import { readBody } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '@campus/domain/prisma'
import {
	api,
	actor,
	businessNow,
	objectBody,
	text,
	fail,
} from '../../utils/api'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	const user = await actor(event)
	const now = await businessNow()
	const postId = text(b.postId, 'postId', 100)
	const parentId = b.parentId ? text(b.parentId, 'parentId', 100) : null
	const body = text(b.body, 'body', 2000)
	return db.$transaction(async (tx) => {
		if (!(await tx.post.findUnique({ where: { id: postId } })))
			fail('NOT_FOUND', 404)
		if (parentId) {
			const p = await tx.comment.findUnique({ where: { id: parentId } })
			if (!p || p.postId !== postId || p.parentId || p.deletedAt)
				fail('INVALID_REPLY', 422, { parentId: 'INVALID_FIELD' })
		}
		const comment = await tx.comment.create({
			data: {
				id: randomUUID(),
				postId,
				authorId: user.id,
				parentId,
				body,
				createdAt: now,
				source: 'Real',
			},
		})
		await tx.behavior.create({
			data: {
				id: randomUUID(),
				userId: user.id,
				postId,
				activityId: null,
				kind: 'COMMENT',
				createdAt: now,
				effectiveMs: 0,
			},
		})
		return { id: comment.id }
	})
})
