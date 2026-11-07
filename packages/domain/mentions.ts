import type { Prisma } from '../../generated/prisma/client.ts'
import { resolveMentions } from '../contracts/mentions.ts'
import { enqueueCommunityEvent } from './messages.ts'

interface ContentMentionEvent {
	authorId: string
	targetType: 'post' | 'comment'
	targetId: string
	text: string
	occurredAt: string
}

export async function enqueueContentMentions(
	tx: Prisma.TransactionClient,
	content: ContentMentionEvent,
) {
	if (!/[@＠]/u.test(content.text)) return
	const users = await tx.user.findMany({ select: { id: true, name: true } })
	const recipients = new Set(
		resolveMentions(content.text, users).map((mention) => mention.userId),
	)
	for (const recipientId of recipients) {
		if (recipientId === content.authorId) continue
		await enqueueCommunityEvent(tx, {
			id: `mention:${content.targetType}:${content.targetId}:${recipientId}`,
			kind: 'MentionCreated',
			actorId: content.authorId,
			recipientId,
			targetType: content.targetType,
			targetId: content.targetId,
			notificationKind: 'MENTION',
			occurredAt: content.occurredAt,
		})
	}
}
