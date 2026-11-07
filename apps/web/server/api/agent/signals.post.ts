import bridgeSecret from '#campus-studio-proof-secret'
import { verifyStudioRequest } from '../../../../../modules/studio-bridge-security'
import { readBody } from 'h3'
import { api, objectBody, text } from '@campus/domain/validation'
import { assertAgentRequest } from '@campus/domain/agent-access'
import type { AgentTrigger } from '@campus/contracts/agents'
import { humanControlledActorIds } from '@campus/domain/manual-presence'
import { db } from '@campus/domain/prisma'
export default api(async (event) => {
	assertAgentRequest(
		event,
		import.meta.dev && verifyStudioRequest(event, bridgeSecret),
	)
	const b = objectBody(await readBody(event)),
		after = text(b.after, 'after', 500)
	const cursor = after.startsWith('{')
		? (JSON.parse(after) as { at: string; id: string })
		: { at: after, id: '' }
	const events = await db.communityOutbox.findMany({
		where: {
			OR: [
				{ createdAt: { gt: cursor.at } },
				{ createdAt: cursor.at, id: { gt: cursor.id } },
			],
		},
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		take: 200,
	})
	const pendingIds = Array.isArray(b.pendingSignalIds)
		? b.pendingSignalIds
				.filter(
					(id): id is string => typeof id === 'string' && id.length <= 160,
				)
				.slice(0, 200)
		: []
	const replay = pendingIds.length
		? await db.communityOutbox.findMany({ where: { id: { in: pendingIds } } })
		: []
	const deliver = [
		...new Map([...replay, ...events].map((row) => [row.id, row])).values(),
	]

	const actors = await db.user.findMany({
			where: { source: 'Synthetic' },
			select: { id: true },
		}),
		allowed = new Set(actors.map((a) => a.id))
	return {
		humanControlledActorIds: await humanControlledActorIds(),
		cursor: events.length
			? JSON.stringify({ at: events.at(-1)!.createdAt, id: events.at(-1)!.id })
			: after,
		signals: deliver.flatMap((row) => {
			const payload = JSON.parse(row.payload) as {
				recipientId?: string
				actorId?: string
				targetId?: string
				targetType?: AgentTrigger['targetType']
			}
			return payload.recipientId &&
				allowed.has(payload.recipientId) &&
				payload.actorId !== payload.recipientId
				? [
						{
							id: row.id,
							kind: row.kind,
							actorId: payload.recipientId,
							createdAt: row.createdAt,
							trigger: {
								kind:
									row.kind === 'DirectMessageCreated'
										? 'direct-message'
										: ['CommentCreated', 'MentionCreated'].includes(row.kind)
											? 'comment'
											: 'social',
								recipientId: payload.recipientId,
								senderId: payload.actorId,
								signalId: row.id,
								targetId: payload.targetId,
								targetType: payload.targetType,
								conversationId:
									row.kind === 'DirectMessageCreated'
										? payload.targetId
										: undefined,
								createdAt: row.createdAt,
							} satisfies AgentTrigger,
						},
					]
				: []
		}),
	}
})
