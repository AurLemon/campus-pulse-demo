import { createHash } from 'node:crypto'
import type { AgentDecision } from '../../packages/contracts/agents.ts'

export interface SweepActivityContext {
	posts: Array<{
		id: string
		authorId?: string
		viewer?: { liked: boolean; favorited: boolean }
	}>
	comments?: Array<{ id: string; authorId?: string; liked: boolean }>
	relationships?: Array<{
		userId: string
		isSelf: boolean
		isFollowing: boolean
		isFriend: boolean
		friendship?: unknown
	}>
	postingOpportunity?: { mayPost: boolean }
	privateContacts?: Array<{ targetId: string }>
	friendRequests?: Array<{ id: string }>
}
interface WeightedAction {
	action: AgentDecision['action']
	weight: number
	available: boolean
}

/** A stable per-job preference guides the model without replacing its decision. */
export function sweepEngagementIntent(
	actorId: string,
	jobId: string,
	context: SweepActivityContext,
) {
	const posts = context.posts.filter((post) => post.authorId !== actorId)
	const comments = (context.comments ?? []).filter(
		(comment) => comment.authorId !== actorId,
	)
	const relationships = (context.relationships ?? []).filter(
		(relationship) => !relationship.isSelf,
	)
	const options: WeightedAction[] = [
		{
			action: 'post',
			weight: 20,
			available: context.postingOpportunity?.mayPost === true,
		},
		{
			action: 'like',
			weight: 30,
			available:
				posts.some((post) => !post.viewer?.liked) ||
				comments.some((comment) => !comment.liked),
		},
		{
			action: 'favorite',
			weight: 15,
			available: posts.some((post) => !post.viewer?.favorited),
		},
		{ action: 'comment', weight: 20, available: posts.length > 0 },
		{
			action: 'follow',
			weight: 5,
			available: relationships.some(
				(relationship) => !relationship.isFollowing,
			),
		},
		{
			action: 'friend',
			weight: 3,
			available: relationships.some(
				(relationship) => !relationship.isFriend && !relationship.friendship,
			),
		},
		{
			action: 'accept',
			weight: 5,
			available: !!context.friendRequests?.length,
		},
		{
			action: 'message',
			weight: 3,
			available: !!context.privateContacts?.length,
		},
		{ action: 'skip', weight: 4, available: true },
	]
	const choices = options.filter((option) => option.available)
	const total = choices.reduce((sum, option) => sum + option.weight, 0)
	const seed =
		createHash('sha256')
			.update(`${actorId}:${jobId}`)
			.digest()
			.readUInt32BE(0) / 0x100000000
	let remaining = seed * total
	let preferredAction: AgentDecision['action'] = 'skip'
	for (const option of choices) {
		remaining -= option.weight
		if (remaining < 0) {
			preferredAction = option.action
			break
		}
	}
	return {
		preferredAction,
		actionWeights: choices.map(({ action, weight }) => ({ action, weight })),
		preferenceOnly: true,
	}
}
