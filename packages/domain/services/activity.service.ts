import { randomUUID } from 'node:crypto'
import { db } from '@campus/domain/prisma'
import { fail, text, tags, campusName } from '../validation.ts'
export async function saveActivity(
	userId: string,
	b: Record<string, unknown>,
	now: string,
	id?: string,
) {
	const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
	if (user.role !== 'ORGANIZER' && user.role !== 'ADMIN') fail('FORBIDDEN', 403)
	if (id) {
		const old = await db.activity.findUnique({ where: { id } })
		if (!old) fail('NOT_FOUND', 404)
		if (old.organizerId !== userId && user.role !== 'ADMIN')
			fail('FORBIDDEN', 403)
		// Cancellation is a complete independent management operation.
		if (b.status === 'CANCELLED' && Object.keys(b).length === 1)
			return db.activity.update({
				where: { id },
				data: { status: 'CANCELLED' },
			})
	}
	const startsAt = text(b.startsAt, 'startsAt', 50),
		endsAt = text(b.endsAt, 'endsAt', 50),
		deadline = text(b.deadline, 'deadline', 50)
	const times = [startsAt, endsAt, deadline].map(Date.parse)
	if (
		times.some((t) => !Number.isFinite(t)) ||
		times[0]! < times[2]! ||
		times[1]! <= times[0]! ||
		times[0]! <= Date.parse(now) ||
		times[2]! <= Date.parse(now)
	)
		fail('VALIDATION_FAILED', 422, { startsAt: 'INVALID_FIELD' })
	const capacity = Number(b.capacity)
	if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)
		fail('VALIDATION_FAILED', 422, { capacity: 'INVALID_FIELD' })
	const coverId = b.coverId ? text(b.coverId, 'coverId', 100) : null
	if (coverId) {
		const media = await db.mediaAsset.findUnique({ where: { id: coverId } })
		if (!media || media.ownerId !== userId) fail('FORBIDDEN', 403)
	}
	const data = {
		coverId,
		title: text(b.title, 'title', 120),
		body: text(b.body, 'body', 10000),
		tags: JSON.stringify(tags(b.tags ?? [])),
		campus: campusName(b.campus),
		location: text(b.location, 'location', 100),
		startsAt: new Date(startsAt).toISOString(),
		endsAt: new Date(endsAt).toISOString(),
		deadline: new Date(deadline).toISOString(),
		capacity,
	}
	return db.$transaction(async (tx) => {
		if (id) {
			const count = await tx.state.count({
				where: { activityId: id, kind: 'REGISTER' },
			})
			if (capacity < count) fail('CAPACITY_BELOW_REGISTRATIONS', 409)
			return tx.activity.update({ where: { id }, data })
		}
		return tx.activity.create({
			data: {
				...data,
				id: randomUUID(),
				organizerId: userId,
				status: 'PUBLISHED',
				source: 'Real',
				createdAt: now,
			},
		})
	})
}
