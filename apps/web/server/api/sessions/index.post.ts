import { readBody } from 'h3'
import { randomUUID } from 'node:crypto'
import { db } from '@campus/domain/prisma'
import {
	api,
	actor,
	objectBody,
	businessNow,
	text,
	fail,
} from '../../utils/api'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	if (Boolean(b.postId) === Boolean(b.activityId))
		fail('VALIDATION_FAILED', 422)
	const postId = b.postId ? text(b.postId, 'postId', 100) : null,
		activityId = b.activityId ? text(b.activityId, 'activityId', 100) : null
	const user = await actor(event),
		now = await businessNow()
	if (
		(postId && !(await db.post.findUnique({ where: { id: postId } }))) ||
		(activityId &&
			!(await db.activity.findUnique({ where: { id: activityId } })))
	)
		fail('NOT_FOUND', 404)
	const id = randomUUID()
	const stamp = new Date().toISOString()
	await db.$transaction([
		db.viewSession.create({
			data: {
				id,
				userId: user.id,
				postId,
				activityId,
				startedAt: stamp,
				updatedAt: stamp,
				effectiveMs: 0,
				closed: false,
			},
		}),
		db.behavior.create({
			data: {
				id,
				userId: user.id,
				postId,
				activityId,
				kind: 'VIEW',
				createdAt: now,
				effectiveMs: 0,
			},
		}),
	])
	return { id }
})
