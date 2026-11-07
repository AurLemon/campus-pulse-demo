import { randomUUID, createHash } from 'node:crypto'
import { enqueueCommunityEvent, validateMessageMedia } from '../messages.ts'
import { db } from '../prisma.ts'
import { fail, text } from '../validation.ts'
import { publicUser } from '../views.ts'
import { enqueueContentMentions } from '../mentions.ts'
import type { CommentView } from '@campus/contracts'
import { resolveMentions } from '../../contracts/mentions.ts'

export async function createComment(
	userId: string,
	input: {
		postId: string
		parentId?: string | null
		body?: unknown
		mediaIds?: unknown
		operationId?: string
	},
	source: 'Real' | 'Synthetic' = 'Real',
) {
	const body = text(input.body ?? '', 'body', 2000, 0)
	const now = new Date().toISOString()
	const id = input.operationId
		? createHash('sha256')
				.update(JSON.stringify([userId, input.operationId]))
				.digest('hex')
		: randomUUID()
	return db.$transaction(async (tx) => {
		const existing = await tx.comment.findUnique({ where: { id } })
		if (existing) {
			if (
				existing.authorId !== userId ||
				existing.postId !== input.postId ||
				existing.body !== body ||
				existing.parentId !== (input.parentId ?? null) ||
				existing.mediaIds !== JSON.stringify(input.mediaIds ?? [])
			)
				fail('CONFLICT', 409)
			return { id }
		}
		const post = await tx.post.findUnique({ where: { id: input.postId } })
		if (!post) fail('NOT_FOUND', 404)
		const parent = input.parentId
			? await tx.comment.findUnique({ where: { id: input.parentId } })
			: null
		if (
			input.parentId &&
			(!parent ||
				parent.postId !== post.id ||
				parent.parentId ||
				parent.deletedAt)
		)
			fail('INVALID_REPLY', 422)
		const mediaIds = await validateMessageMedia(tx, userId, input.mediaIds)
		if (!body && !mediaIds.length)
			fail('VALIDATION_FAILED', 422, { body: 'INVALID_FIELD' })
		await tx.comment.create({
			data: {
				id,
				postId: post.id,
				authorId: userId,
				parentId: parent?.id ?? null,
				body,
				mediaIds: JSON.stringify(mediaIds),
				createdAt: now,
				source,
			},
		})
		await tx.behavior.create({
			data: {
				id: randomUUID(),
				userId,
				postId: post.id,
				activityId: null,
				kind: 'COMMENT',
				createdAt: now,
				effectiveMs: 0,
			},
		})
		for (const recipientId of new Set([
			post.authorId,
			...(parent ? [parent.authorId] : []),
		])) {
			await enqueueCommunityEvent(tx, {
				id: `comment:${id}:${recipientId}`,
				kind: 'CommentCreated',
				actorId: userId,
				recipientId,
				targetType: 'comment',
				targetId: id,
				notificationKind:
					parent?.authorId === recipientId ? 'REPLY' : 'COMMENT',
				occurredAt: now,
			})
		}
		await enqueueContentMentions(tx, {
			authorId: userId,
			targetType: 'comment',
			targetId: id,
			text: body,
			occurredAt: now,
		})
		return { id }
	})
}

export async function editComment(userId: string, id: string, value: unknown) {
	const body = text(value, 'body', 2000, 0)
	return db.$transaction(async (tx) => {
		const comment = await tx.comment.findUnique({ where: { id } })
		if (!comment) fail('NOT_FOUND', 404)
		if (comment.authorId !== userId) fail('FORBIDDEN', 403)
		if (comment.deletedAt) fail('CONFLICT', 409)
		if (!body && !JSON.parse(comment.mediaIds).length)
			fail('VALIDATION_FAILED', 422)
		const updated = await tx.comment.update({
			where: { id },
			data: { body },
			select: { id: true, body: true },
		})
		await enqueueContentMentions(tx, {
			authorId: userId,
			targetType: 'comment',
			targetId: id,
			text: body,
			occurredAt: new Date().toISOString(),
		})
		return updated
	})
}

export async function removeComment(userId: string, id: string, now: string) {
	return db.$transaction(async (tx) => {
		const comment = await tx.comment.findUnique({ where: { id } })
		if (!comment) fail('NOT_FOUND', 404)
		if (comment.authorId !== userId) fail('FORBIDDEN', 403)
		const replies = await tx.comment.count({ where: { parentId: id } })
		if (replies === 0) {
			await tx.comment.delete({ where: { id } })
			return { ok: true, id, removed: true }
		}
		// Preserve every reply and its parent ID. A removed root has no original text left to expose.
		await tx.comment.update({
			where: { id },
			data: { body: '', mediaIds: '[]', deletedAt: comment.deletedAt ?? now },
		})
		return { ok: true, id, removed: false }
	})
}

export async function listPostComments(
	postId: string,
	userId?: string,
): Promise<CommentView[]> {
	const comments = await db.comment.findMany({
		where: { postId },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		include: {
			author: true,
			_count: { select: { likes: true } },
			likes: { where: { userId: userId ?? '' }, select: { userId: true } },
		},
	})
	const mediaIds = comments.flatMap((comment) =>
		comment.deletedAt ? [] : (JSON.parse(comment.mediaIds) as string[]),
	)
	const assets = mediaIds.length
		? await db.mediaAsset.findMany({
				where: { id: { in: [...new Set(mediaIds)] } },
			})
		: []
	const media = new Map(assets.map((asset) => [asset.id, asset]))
	const mentionUsers = comments.some(
		(comment) => !comment.deletedAt && /[@＠]/u.test(comment.body),
	)
		? await db.user.findMany({ select: { id: true, name: true } })
		: []
	return comments.map(
		({ source: _source, deletedAt, author, _count, likes, ...comment }) => {
			const ids: string[] = deletedAt ? [] : JSON.parse(comment.mediaIds)
			return {
				...comment,
				body: deletedAt ? '' : comment.body,
				mentions: deletedAt ? [] : resolveMentions(comment.body, mentionUsers),
				mediaIds: ids,
				media: ids.flatMap((id) => {
					const asset = media.get(id)
					return asset ? [asset] : []
				}),
				deleted: !!deletedAt,
				author: publicUser(author),
				stats: { likes: deletedAt ? 0 : _count.likes },
				viewer: { liked: !deletedAt && likes.length > 0 },
			}
		},
	)
}
