import { randomUUID, createHash } from 'node:crypto'
import { db } from './prisma.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { fail, text } from './validation.ts'
import { publicUser } from './views.ts'
import type {
	CommunityEvent,
	FriendRequestView,
	DirectMessageView,
	ConversationView,
	ConversationPage,
	NotificationView,
} from '../contracts/messages.ts'

export async function validateMessageMedia(
	tx: Prisma.TransactionClient,
	userId: string,
	input: unknown,
) {
	if (input === undefined) return [] as string[]
	if (
		!Array.isArray(input) ||
		input.length > 4 ||
		input.some((id) => typeof id !== 'string' || id.length > 100)
	)
		fail('VALIDATION_FAILED', 422, { mediaIds: 'INVALID_FIELD' })
	const ids = [...new Set(input)] as string[]
	const rows = await tx.mediaAsset.findMany({ where: { id: { in: ids } } })
	if (
		rows.length !== ids.length ||
		rows.some((row) => row.ownerId !== userId || !row.mime.startsWith('image/'))
	)
		fail('FORBIDDEN', 403)
	return ids
}
export async function enqueueCommunityEvent(
	tx: Prisma.TransactionClient,
	event: CommunityEvent,
) {
	await tx.communityOutbox.upsert({
		where: { id: event.id },
		create: {
			id: event.id,
			kind: event.kind,
			payload: JSON.stringify(event),
			createdAt: event.occurredAt,
		},
		update: {},
	})
}
// A durable outbox is consumed after commit and again on every inbox read. Failed delivery remains pending.
export async function drainCommunityOutbox() {
	const events = await db.communityOutbox.findMany({
		where: { deliveredAt: null },
		orderBy: { createdAt: 'asc' },
		take: 200,
	})
	for (const row of events) {
		const event = JSON.parse(row.payload) as CommunityEvent
		await db.$transaction(async (tx) => {
			if (event.notificationKind && event.actorId !== event.recipientId) {
				if (await tx.user.findUnique({ where: { id: event.recipientId } }))
					await tx.notification.upsert({
						where: { id: event.id },
						create: {
							id: event.id,
							recipientId: event.recipientId,
							actorId: event.actorId,
							kind: event.notificationKind,
							targetType: event.targetType,
							targetId: event.targetId,
							createdAt: event.occurredAt,
						},
						update: {},
					})
			}
			await tx.communityOutbox.update({
				where: { id: row.id },
				data: { deliveredAt: new Date().toISOString() },
			})
		})
	}
}
export async function heartbeatPresence(userId: string, active = true) {
	if (!(await db.user.findUnique({ where: { id: userId } })))
		fail('NOT_FOUND', 404)
	const lastSeenAt = active
		? new Date().toISOString()
		: new Date(0).toISOString()
	await db.presence.upsert({
		where: { userId },
		create: { userId, lastSeenAt },
		update: { lastSeenAt },
	})
	return { ok: true }
}
export async function createConversation(userId: string, peerId: string) {
	if (userId === peerId) fail('VALIDATION_FAILED', 422)
	if (!(await db.user.findUnique({ where: { id: peerId } })))
		fail('NOT_FOUND', 404)
	const [userLow, userHigh] = [userId, peerId].sort() as [string, string]
	const id = createHash('sha256')
		.update(JSON.stringify([userLow, userHigh]))
		.digest('hex')
	return db.conversation.upsert({
		where: { userLow_userHigh: { userLow, userHigh } },
		create: { id, userLow, userHigh, updatedAt: new Date().toISOString() },
		update: {},
	})
}
async function participant(userId: string, id: string) {
	const row = await db.conversation.findUnique({ where: { id } })
	if (!row) fail('NOT_FOUND', 404)
	if (row.userLow !== userId && row.userHigh !== userId) fail('FORBIDDEN', 403)
	return row
}
async function messageView(
	row: Awaited<ReturnType<typeof db.directMessage.findFirstOrThrow>>,
): Promise<DirectMessageView> {
	const ids = JSON.parse(row.mediaIds) as string[]
	const media = await db.mediaAsset.findMany({ where: { id: { in: ids } } })
	return {
		id: row.id,
		conversationId: row.conversationId,
		senderId: row.senderId,
		body: row.body,
		sequence: row.sequence,
		createdAt: row.createdAt,
		media: ids.flatMap((id) =>
			media
				.filter((m) => m.id === id)
				.map(({ ownerId: _ownerId, createdAt: _createdAt, ...asset }) => asset),
		),
	}
}
type ConversationRow = Awaited<
	ReturnType<typeof db.conversation.findFirstOrThrow>
>
async function conversationView(
	userId: string,
	row: ConversationRow,
): Promise<ConversationView | null> {
	const peerId = row.userLow === userId ? row.userHigh : row.userLow
	const [peer, presence, read, last] = await Promise.all([
		db.user.findUnique({ where: { id: peerId } }),
		db.presence.findUnique({ where: { userId: peerId } }),
		db.conversationRead.findUnique({
			where: { conversationId_userId: { conversationId: row.id, userId } },
		}),
		db.directMessage.findFirst({
			where: { conversationId: row.id },
			orderBy: { sequence: 'desc' },
		}),
	])
	if (!peer) return null
	const unread = await db.directMessage.count({
		where: {
			conversationId: row.id,
			senderId: { not: userId },
			sequence: { gt: read?.sequence ?? 0 },
		},
	})
	return {
		id: row.id,
		peer: publicUser(peer),
		online: !!presence && Date.now() - Date.parse(presence.lastSeenAt) < 90000,
		unread,
		lastMessage: last ? await messageView(last) : null,
		updatedAt: row.updatedAt,
	}
}
export async function getConversationMetadata(
	userId: string,
	id: string,
): Promise<ConversationView> {
	const row = await participant(userId, id)
	const view = await conversationView(userId, row)
	if (!view) fail('NOT_FOUND', 404)
	return view
}
export async function listConversationPage(
	userId: string,
	cursor?: string,
): Promise<ConversationPage> {
	let before: { updatedAt: string; id: string } | undefined
	if (cursor) {
		if (cursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(cursor))
			fail('VALIDATION_FAILED', 422)
		try {
			const decoded = JSON.parse(
				Buffer.from(cursor, 'base64url').toString(),
			) as { updatedAt?: unknown; id?: unknown }
			if (
				typeof decoded.updatedAt !== 'string' ||
				!Number.isFinite(Date.parse(decoded.updatedAt)) ||
				typeof decoded.id !== 'string' ||
				!decoded.id.length ||
				decoded.id.length > 100
			)
				fail('VALIDATION_FAILED', 422)
			before = { updatedAt: decoded.updatedAt, id: decoded.id }
		} catch {
			fail('VALIDATION_FAILED', 422)
		}
	}
	const rows = await db.conversation.findMany({
		where: {
			AND: [
				{ OR: [{ userLow: userId }, { userHigh: userId }] },
				...(before
					? [
							{
								OR: [
									{ updatedAt: { lt: before.updatedAt } },
									{ updatedAt: before.updatedAt, id: { lt: before.id } },
								],
							},
						]
					: []),
			],
		},
		orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
		take: 21,
	})
	const selected = rows.slice(0, 20)
	const views = await Promise.all(
		selected.map((row) => conversationView(userId, row)),
	)
	const last = selected.at(-1)
	return {
		items: views.filter((row): row is ConversationView => row !== null),
		hasMore: rows.length > 20,
		nextCursor:
			rows.length > 20 && last
				? Buffer.from(
						JSON.stringify({ updatedAt: last.updatedAt, id: last.id }),
					).toString('base64url')
				: null,
	}
}
/** Bounded recent context for actor workers. Product lists use listConversationPage. */
export async function listConversations(
	userId: string,
): Promise<ConversationView[]> {
	return (await listConversationPage(userId)).items
}
export async function getConversationMessages(
	userId: string,
	id: string,
	after = 0,
) {
	await participant(userId, id)
	if (!Number.isSafeInteger(after) || after < 0) fail('VALIDATION_FAILED', 422)
	const rows = await db.directMessage.findMany({
		where: { conversationId: id, sequence: { gt: after } },
		orderBy: { sequence: 'asc' },
		take: 51,
	})
	const selected = rows.slice(0, 50)
	return {
		items: await Promise.all(selected.map(messageView)),
		hasMore: rows.length > 50,
		nextSequence: selected.at(-1)?.sequence ?? after,
	}
}
export async function sendDirectMessage(
	userId: string,
	id: string,
	input: { body?: unknown; mediaIds?: unknown; clientMessageId?: unknown },
) {
	await participant(userId, id)
	const body = text(input.body ?? '', 'body', 2000, 0)
	const clientMessageId = text(input.clientMessageId, 'clientMessageId', 100)
	const row = await db.$transaction(async (tx) => {
		const previous = await tx.directMessage.findUnique({
			where: {
				senderId_clientMessageId: { senderId: userId, clientMessageId },
			},
		})
		if (previous) {
			if (
				previous.conversationId !== id ||
				previous.body !== body ||
				previous.mediaIds !== JSON.stringify(input.mediaIds ?? [])
			)
				fail('CONFLICT', 409)
			return previous
		}
		const recent = await tx.directMessage.count({
			where: {
				senderId: userId,
				createdAt: { gt: new Date(Date.now() - 60000).toISOString() },
			},
		})
		if (recent >= 30) fail('RATE_LIMITED', 429)
		const mediaIds = await validateMessageMedia(tx, userId, input.mediaIds)
		if (!body && !mediaIds.length)
			fail('VALIDATION_FAILED', 422, { body: 'INVALID_FIELD' })
		const now = new Date().toISOString()
		const conversation = await tx.conversation.update({
			where: { id },
			data: { sequence: { increment: 1 }, updatedAt: now },
		})
		const message = await tx.directMessage.create({
			data: {
				id: randomUUID(),
				conversationId: id,
				senderId: userId,
				body,
				mediaIds: JSON.stringify(mediaIds),
				sequence: conversation.sequence,
				clientMessageId,
				createdAt: now,
			},
		})
		await enqueueCommunityEvent(tx, {
			id: message.id,
			kind: 'DirectMessageCreated',
			actorId: userId,
			recipientId:
				conversation.userLow === userId
					? conversation.userHigh
					: conversation.userLow,
			targetType: 'conversation',
			targetId: id,
			occurredAt: now,
		})
		return message
	})
	return messageView(row)
}
export async function markConversationRead(
	userId: string,
	id: string,
	sequence: number,
) {
	await participant(userId, id)
	if (!Number.isSafeInteger(sequence) || sequence < 0)
		fail('VALIDATION_FAILED', 422)
	if (
		sequence &&
		!(await db.directMessage.findUnique({
			where: { conversationId_sequence: { conversationId: id, sequence } },
		}))
	)
		fail('VALIDATION_FAILED', 422)
	await db.$transaction(async (tx) => {
		await tx.conversationRead.upsert({
			where: { conversationId_userId: { conversationId: id, userId } },
			create: { id: randomUUID(), conversationId: id, userId, sequence: 0 },
			update: {},
		})
		await tx.conversationRead.updateMany({
			where: { conversationId: id, userId, sequence: { lt: sequence } },
			data: { sequence },
		})
	})
	return { ok: true }
}
export async function listNotifications(
	userId: string,
): Promise<NotificationView[]> {
	await drainCommunityOutbox()
	const rows = await db.notification.findMany({
		where: { recipientId: userId },
		orderBy: { createdAt: 'desc' },
		take: 100,
	})
	return Promise.all(
		rows.map(async (row) => {
			const actor = await db.user.findUnique({ where: { id: row.actorId } })
			let targetUrl: string | null = null
			let targetTitle: string | null = null
			if (row.targetType === 'post') {
				const post = await db.post.findUnique({
					where: { id: row.targetId },
					select: { title: true },
				})
				if (post) {
					targetUrl = `/posts/${row.targetId}`
					targetTitle = post.title
				}
			}
			if (
				row.targetType === 'activity' &&
				(await db.activity.findUnique({ where: { id: row.targetId } }))
			)
				targetUrl = `/activities/${row.targetId}`
			if (row.targetType === 'user' && actor) targetUrl = `/users/${actor.id}`
			if (row.targetType === 'comment') {
				const comment = await db.comment.findUnique({
					where: { id: row.targetId },
					include: { post: { select: { title: true } } },
				})
				if (comment && !comment.deletedAt) {
					targetUrl = `/posts/${comment.postId}`
					targetTitle = comment.post.title
				}
			}
			return {
				id: row.id,
				kind: row.kind as NotificationView['kind'],
				actor: actor ? publicUser(actor) : null,
				targetType: row.targetType,
				targetId: row.targetId,
				targetAvailable: !!targetUrl,
				targetUrl,
				targetTitle,
				createdAt: row.createdAt,
				read: !!row.readAt,
			}
		}),
	)
}
export async function markNotificationsRead(userId: string, ids: unknown) {
	if (
		!Array.isArray(ids) ||
		ids.length > 100 ||
		ids.some((id) => typeof id !== 'string')
	)
		fail('VALIDATION_FAILED', 422)
	await db.notification.updateMany({
		where: { recipientId: userId, id: { in: ids as string[] }, readAt: null },
		data: { readAt: new Date().toISOString() },
	})
	return { ok: true }
}

export async function getMessageSummary(userId: string) {
	await drainCommunityOutbox()
	const [notifications, counts] = await Promise.all([
		db.notification.count({ where: { recipientId: userId, readAt: null } }),
		db.$queryRaw<
			Array<{ unread: bigint }>
		>`SELECT COUNT(m.id) AS unread FROM DirectMessage m JOIN Conversation c ON c.id=m.conversationId LEFT JOIN ConversationRead r ON r.conversationId=c.id AND r.userId=${userId} WHERE (c.userLow=${userId} OR c.userHigh=${userId}) AND m.senderId<>${userId} AND m.sequence>COALESCE(r.sequence,0)`,
	])
	return { totalUnread: notifications + Number(counts[0]?.unread ?? 0) }
}

/** Explicit user action applies to all notifications already committed at this instant. */
export async function markAllNotificationsRead(userId: string) {
	await drainCommunityOutbox()
	const now = new Date().toISOString()
	await db.notification.updateMany({
		where: { recipientId: userId, readAt: null, createdAt: { lte: now } },
		data: { readAt: now },
	})
	return { ok: true }
}

export async function listFriendRequests(
	userId: string,
): Promise<FriendRequestView[]> {
	const requests = await db.friendship.findMany({
		where: { recipientId: userId, status: 'PENDING' },
		include: { requester: true },
		orderBy: { createdAt: 'desc' },
	})
	return requests.map(({ requester, ...request }) => ({
		...request,
		status: 'PENDING',
		requester: publicUser(requester),
	}))
}
