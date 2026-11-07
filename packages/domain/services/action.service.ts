import { enqueueCommunityEvent } from '../messages.ts'
import { randomUUID } from 'node:crypto'
import { db } from '@campus/domain/prisma'
import { fail } from '../validation.ts'
import type { Mutation } from '@campus/contracts'

export async function act(userId: string, mutation: Mutation, now: string) {
	const { action, targetId, active } = mutation
	if (
		!['like', 'favorite', 'register', 'follow', 'friend', 'accept'].includes(
			action,
		) ||
		typeof active !== 'boolean'
	)
		fail('VALIDATION_FAILED', 422)
	return db.$transaction(async (tx) => {
		if (mutation.targetType === 'comment') {
			if (action !== 'like') fail('VALIDATION_FAILED', 422)
			const comment = await tx.comment.findUnique({ where: { id: targetId } })
			if (!comment || comment.deletedAt) fail('NOT_FOUND', 404)
			const where = { userId_commentId: { userId, commentId: targetId } }
			const existing = await tx.commentLike.findUnique({ where })
			if (active && !existing) {
				await tx.commentLike.create({
					data: { userId, commentId: targetId, createdAt: now },
				})
				await enqueueCommunityEvent(tx, {
					id: `comment-like:${userId}:${targetId}:${now}`,
					kind: 'ReactionChanged',
					actorId: userId,
					recipientId: comment.authorId,
					targetType: 'comment',
					targetId,
					notificationKind: 'LIKE',
					occurredAt: now,
				})
			} else if (!active && existing) {
				await tx.commentLike.delete({ where })
			}
			return {
				ok: true,
				likes: await tx.commentLike.count({ where: { commentId: targetId } }),
				liked: active,
			}
		}
		if (action === 'accept') {
			const request = await tx.friendship.findUnique({
				where: { id: targetId },
			})
			if (!request) fail('NOT_FOUND', 404)
			if (request.recipientId !== userId) fail('FORBIDDEN', 403)
			if (request.status === 'ACCEPTED') return { ok: true }
			await tx.friendship.update({
				where: { id: request.id },
				data: { status: 'ACCEPTED' },
			})
			await enqueueCommunityEvent(tx, {
				id: `friend-accepted:${request.id}:${now}`,
				kind: 'FriendAccepted',
				actorId: userId,
				recipientId: request.requesterId,
				targetType: 'user',
				targetId: userId,
				notificationKind: 'FRIEND_ACCEPTED',
				occurredAt: now,
			})
			return { ok: true }
		}
		if (action === 'follow' || action === 'friend') {
			if (userId === targetId) fail('VALIDATION_FAILED', 422)
			if (!(await tx.user.findUnique({ where: { id: targetId } })))
				fail('NOT_FOUND', 404)
			if (action === 'follow') {
				const id = `follow:${userId}:${targetId}`
				if (active) {
					if (
						await tx.follow.findUnique({
							where: {
								followerId_followingId: {
									followerId: userId,
									followingId: targetId,
								},
							},
						})
					)
						return { ok: true }
					await enqueueCommunityEvent(tx, {
						id: `${id}:${now}`,
						kind: 'FollowCreated',
						actorId: userId,
						recipientId: targetId,
						targetType: 'user',
						targetId: userId,
						notificationKind: 'FOLLOW',
						occurredAt: now,
					})
					await tx.follow.upsert({
						where: {
							followerId_followingId: {
								followerId: userId,
								followingId: targetId,
							},
						},
						create: {
							id,
							followerId: userId,
							followingId: targetId,
							createdAt: now,
						},
						update: {},
					})
				} else
					await tx.follow.deleteMany({
						where: { followerId: userId, followingId: targetId },
					})
			} else {
				const id = `friend:${[userId, targetId].sort().join(':')}`
				const existing = await tx.friendship.findFirst({
					where: {
						OR: [
							{ requesterId: userId, recipientId: targetId },
							{ requesterId: targetId, recipientId: userId },
						],
					},
				})
				if (!active) {
					if (existing)
						await tx.friendship.delete({ where: { id: existing.id } })
				} else if (!existing) {
					await tx.friendship.create({
						data: {
							id,
							requesterId: userId,
							recipientId: targetId,
							status: 'PENDING',
							createdAt: now,
						},
					})
					await enqueueCommunityEvent(tx, {
						id: `friend-request:${id}:${now}`,
						kind: 'FriendRequested',
						actorId: userId,
						recipientId: targetId,
						targetType: 'user',
						targetId: userId,
						notificationKind: 'FRIEND_REQUEST',
						occurredAt: now,
					})
				}
			}
			return { ok: true }
		}
		const isActivity =
			action === 'register' || mutation.targetType === 'activity'
		if (isActivity && action === 'like') fail('VALIDATION_FAILED', 422)
		const activityId = isActivity ? targetId : null,
			postId = isActivity ? null : targetId
		const target = isActivity
			? await tx.activity.findUnique({ where: { id: targetId } })
			: await tx.post.findUnique({ where: { id: targetId } })
		if (!target) fail('NOT_FOUND', 404)
		const kind =
			action === 'like'
				? 'LIKE'
				: action === 'favorite'
					? 'FAVORITE'
					: 'REGISTER'
		const existing = await tx.state.findFirst({
			where: { userId, activityId, postId, kind },
		})
		if (Boolean(existing) === active) return { ok: true }
		if (action === 'register' && active) {
			const activity = await tx.activity.findUniqueOrThrow({
				where: { id: targetId },
			})
			if (
				activity.status !== 'PUBLISHED' ||
				activity.deadline <= now ||
				activity.startsAt <= now
			)
				fail('REGISTRATION_CLOSED', 409)
			if (
				(await tx.state.count({ where: { activityId, kind: 'REGISTER' } })) >=
				activity.capacity
			)
				fail('ACTIVITY_FULL', 409)
		}
		if (active)
			await tx.state.create({
				data: {
					id: randomUUID(),
					userId,
					postId,
					activityId,
					kind,
					createdAt: now,
				},
			})
		else
			await tx.state.deleteMany({ where: { userId, postId, activityId, kind } })
		if (active && (action === 'like' || action === 'favorite')) {
			const recipientId =
				'authorId' in target ? target.authorId : target.organizerId
			await enqueueCommunityEvent(tx, {
				id: `reaction:${userId}:${targetId}:${kind}:${now}`,
				kind: 'ReactionChanged',
				actorId: userId,
				recipientId,
				targetType: isActivity ? 'activity' : 'post',
				targetId,
				notificationKind: kind as 'LIKE' | 'FAVORITE',
				occurredAt: now,
			})
		}
		const eventKind = active
			? kind
			: kind === 'LIKE'
				? 'UNLIKE'
				: kind === 'FAVORITE'
					? 'UNFAVORITE'
					: 'UNREGISTER'
		await tx.behavior.create({
			data: {
				id: randomUUID(),
				userId,
				postId,
				activityId,
				kind: eventKind,
				createdAt: now,
				effectiveMs: 0,
			},
		})
		return { ok: true }
	})
}
