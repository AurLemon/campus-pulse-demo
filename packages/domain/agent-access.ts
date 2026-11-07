import { MAX_AGENT_ACTORS } from '../contracts/agents.ts'
import { timingSafeEqual, createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getHeader, type H3Event } from 'h3'
import {
	isHumanControlled,
	humanControlledActorIds,
} from './manual-presence.ts'
import { db } from './prisma.ts'
import { fail, text } from './validation.ts'
import { act } from './services/action.service.ts'
import { createComment } from './services/comment.service.ts'
import { enqueueContentMentions } from './mentions.ts'
import { feed } from './feed.ts'
import { setBookState, changeBookLoan } from './books.ts'
import {
	getConversationMessages,
	sendDirectMessage,
	heartbeatPresence,
	listConversations,
	markConversationRead,
	createConversation,
	listFriendRequests,
} from './messages.ts'
import type { AgentOperation, AgentTrigger } from '../contracts/agents.ts'
export function assertAgentRequest(event: H3Event, socketAttested = false) {
	const address = event.node.req.socket.remoteAddress
	const host = getHeader(event, 'host') ?? ''
	if (
		(!socketAttested &&
			!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '')) ||
		!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) ||
		getHeader(event, 'origin')
	)
		fail('FORBIDDEN', 403)
	let expected: string
	try {
		expected = readFileSync(
			resolve(
				process.env.CAMPUS_AGENT_TOKEN_FILE ?? '.data/agents/service-token',
			),
			'utf8',
		).trim()
	} catch {
		fail('AGENT_NOT_CONFIGURED', 503)
	}
	const received =
		getHeader(event, 'authorization')?.replace(/^Bearer /, '') ?? ''
	if (
		expected.length < 32 ||
		!timingSafeEqual(
			createHash('sha256').update(received).digest(),
			createHash('sha256').update(expected).digest(),
		)
	)
		fail('FORBIDDEN', 403)
}
export async function syntheticActor(id: string) {
	const user = await db.user.findUnique({ where: { id } })
	if (!user || user.source !== 'Synthetic') fail('FORBIDDEN', 403)
	return user
}
export async function agentActors() {
	const users = await db.user.findMany({
		where: { source: 'Synthetic' },
		select: { id: true, name: true, campus: true, interests: true },
		orderBy: { id: 'asc' },
		take: MAX_AGENT_ACTORS,
	})
	const friendships = await db.friendship.findMany({
		where: {
			status: 'ACCEPTED',
			OR: [
				{ requesterId: { in: users.map((u) => u.id) } },
				{ recipientId: { in: users.map((u) => u.id) } },
			],
		},
		select: { requesterId: true, recipientId: true },
	})
	const follows = await db.follow.findMany({
		where: { followerId: { in: users.map((u) => u.id) } },
	})
	const controlled = new Set(await humanControlledActorIds())
	return users.map((u) => ({
		...u,
		humanControlled: controlled.has(u.id),
		interests: Object.entries(JSON.parse(u.interests) as Record<string, number>)
			.filter(([, weight]) => weight > 0)
			.map(([tag]) => tag),
		friendIds: friendships
			.filter((f) => f.requesterId === u.id || f.recipientId === u.id)
			.map((f) => (f.requesterId === u.id ? f.recipientId : f.requesterId)),
		followingIds: follows
			.filter((f) => f.followerId === u.id)
			.map((f) => f.followingId),
	}))
}
function validateTrigger(
	actorId: string,
	trigger?: AgentTrigger,
): AgentTrigger {
	if (!trigger) return { kind: 'sweep', recipientId: actorId }
	if (
		!['direct-message', 'comment', 'social', 'sweep'].includes(trigger.kind) ||
		trigger.recipientId !== actorId
	)
		fail('INVALID_AGENT_TRIGGER', 422)
	if (
		trigger.relatedSignals &&
		(!Array.isArray(trigger.relatedSignals) ||
			trigger.relatedSignals.length > 12 ||
			trigger.relatedSignals.some(
				(item) =>
					!item || item.recipientId !== actorId || item.kind !== 'social',
			))
	)
		fail('INVALID_AGENT_TRIGGER', 422)
	if (trigger.kind === 'direct-message')
		text(trigger.conversationId, 'conversationId', 100)
	if (trigger.kind === 'comment') text(trigger.targetId, 'targetId', 100)
	return trigger
}
async function focusedPrivateThreads(actorId: string, conversationId: string) {
	const conversation = await db.conversation.findUnique({
		where: { id: conversationId },
		select: { sequence: true, userLow: true, userHigh: true },
	})
	if (!conversation) fail('NOT_FOUND', 404)
	// getConversationMessages validates membership before returning any private content.
	const page = await getConversationMessages(
		actorId,
		conversationId,
		Math.max(0, conversation.sequence - 24),
	)
	const messages = {
		...page,
		items: page.items.slice(-24).map((message, index, recent) => ({
			...message,
			body: message.body.slice(0, index === recent.length - 1 ? 1600 : 800),
			bodyTruncated:
				message.body.length > (index === recent.length - 1 ? 1600 : 800),
		})),
	}

	const read = await db.conversationRead.findUnique({
		where: { conversationId_userId: { conversationId, userId: actorId } },
	})
	if (
		(read?.sequence ?? 0) >= messages.nextSequence ||
		messages.items.at(-1)?.senderId === actorId
	)
		return []
	const lastSix = messages.items.slice(-6)
	if (lastSix.length >= 6) {
		const rows = await db.directMessage.findMany({
			where: { id: { in: lastSix.map((message) => message.id) } },
			select: { senderId: true, clientMessageId: true },
		})
		const receipts = await db.agentOperationReceipt.findMany({
			where: {
				id: { in: rows.map((message) => message.clientMessageId) },
				action: 'message',
			},
			select: { id: true, actorId: true },
		})
		if (
			rows.length === 6 &&
			rows.every((message) =>
				receipts.some(
					(receipt) =>
						receipt.id === message.clientMessageId &&
						receipt.actorId === message.senderId,
				),
			)
		)
			return []
	}
	const firstRecent = messages.items[0]?.sequence ?? 0
	const openingMessages =
		firstRecent > 1
			? await db.directMessage.findMany({
					where: { conversationId, sequence: { lt: firstRecent } },
					orderBy: { sequence: 'asc' },
					take: 4,
					select: {
						senderId: true,
						body: true,
						sequence: true,
						createdAt: true,
					},
				})
			: []
	const peerId =
		conversation.userLow === actorId
			? conversation.userHigh
			: conversation.userLow
	const [peer, friendship, follows] = await Promise.all([
		db.user.findUniqueOrThrow({
			where: { id: peerId },
			select: { id: true, name: true, campus: true },
		}),
		db.friendship.findFirst({
			where: {
				OR: [
					{ requesterId: actorId, recipientId: peerId },
					{ requesterId: peerId, recipientId: actorId },
				],
			},
			select: {
				id: true,
				requesterId: true,
				recipientId: true,
				status: true,
				createdAt: true,
			},
		}),
		db.follow.findMany({
			where: {
				OR: [
					{ followerId: actorId, followingId: peerId },
					{ followerId: peerId, followingId: actorId },
				],
			},
			select: { followerId: true, followingId: true },
		}),
	])
	return [
		{
			conversationId,
			messages,
			openingMessages: openingMessages.map((message) => ({
				...message,
				body: message.body.slice(0, 500),
			})),
			historyCoverage: {
				firstRecentSequence: firstRecent,
				latestSequence: messages.nextSequence,
				hasEarlierMessages: firstRecent > openingMessages.length + 1,
			},
			peer,
			relationship: {
				friendship,
				following: follows.some((follow) => follow.followerId === actorId),
				followedBy: follows.some((follow) => follow.followerId === peerId),
			},
		},
	]
}
function postContactToken(
	actorId: string,
	operationId: string,
	postId: string,
) {
	const secret = readFileSync(
		resolve(
			process.env.CAMPUS_AGENT_TOKEN_FILE ?? '.data/agents/service-token',
		),
		'utf8',
	).trim()
	const signature = createHmac('sha256', secret)
		.update(JSON.stringify([actorId, operationId, postId]))
		.digest('hex')
		.slice(0, 24)
	return `post:${postId}:${signature}`
}
async function proactiveContactAllowed(
	actorId: string,
	conversationId?: string,
) {
	const [prior, lastMessage] = await Promise.all([
		db.agentOperationReceipt.findFirst({
			where: { actorId, action: 'message' },
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		}),
		conversationId
			? db.directMessage.findFirst({
					where: { conversationId },
					orderBy: { sequence: 'desc' },
					select: { createdAt: true },
				})
			: Promise.resolve(null),
	])
	const cutoff = Date.now() - 6 * 3600000
	return (
		(!prior || Date.parse(prior.createdAt) <= cutoff) &&
		(!lastMessage || Date.parse(lastMessage.createdAt) <= cutoff)
	)
}
export async function commentReplyOpportunity(
	actorId: string,
	postId: string,
	rootId?: string,
) {
	const recent = await db.comment.findMany({
		where: {
			postId,
			deletedAt: null,
			...(rootId ? { OR: [{ id: rootId }, { parentId: rootId }] } : {}),
		},
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		take: 8,
		select: { id: true, authorId: true, createdAt: true },
	})
	const receipts = recent.length
		? await db.agentOperationReceipt.findMany({
				where: {
					action: 'comment',
					createdAt: { gte: recent.at(-1)!.createdAt },
					actorId: {
						in: [...new Set(recent.map((comment) => comment.authorId))],
					},
				},
				select: { result: true },
			})
		: []
	const automatedIds = new Set(
		receipts.map(
			(receipt) => (JSON.parse(receipt.result) as { id?: string }).id,
		),
	)
	let consecutive = 0
	let ownReplies = 0
	for (const comment of recent) {
		if (!automatedIds.has(comment.id)) break
		consecutive++
		if (comment.authorId === actorId) ownReplies++
	}
	return {
		mayReply:
			(!recent.length || recent[0]?.authorId !== actorId) &&
			consecutive < 6 &&
			ownReplies < 3,
		consecutiveAgentComments: consecutive,
	}
}
/** Only the verified conversation's text and public posts enter this retrieval. */
async function privateThreadPublicFacts(actorId: string, texts: string[]) {
	const normalize = (value: string) =>
		value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()
	const conversationText = normalize(texts.join('\n'))
	const catalog = await db.post.findMany({
		where: { authorId: actorId },
		orderBy: { createdAt: 'desc' },
		take: 200,
		select: { id: true, title: true },
	})
	const matched = catalog
		.filter((post) => conversationText.includes(normalize(post.title)))
		.slice(0, 4)
	const selectedIds = [
		...new Set([...matched, ...catalog.slice(0, 4)].map((post) => post.id)),
	]
	const referenceIds = new Set<string>()
	for (const text of texts) {
		for (const match of text.matchAll(
			/(?:[?&]post=|\/posts\/)([A-Za-z0-9_%:-]+)/gu,
		)) {
			try {
				referenceIds.add(decodeURIComponent(match[1]!))
			} catch {
				/* Invalid links are not references. */
			}
			if (referenceIds.size >= 4) break
		}
		if (referenceIds.size >= 4) break
	}
	const rows = await db.post.findMany({
		where: { id: { in: [...new Set([...selectedIds, ...referenceIds])] } },
		select: {
			id: true,
			authorId: true,
			title: true,
			body: true,
			createdAt: true,
		},
	})
	const posts = rows.map((post) => ({
		...post,
		body: post.body.slice(0, 1000),
		isSelfAuthored: post.authorId === actorId,
	}))
	return {
		ownPublishedPosts: posts.filter((post) => post.isSelfAuthored),
		referencedPosts: posts.filter((post) => referenceIds.has(post.id)),
	}
}
interface AgentAccountIdentity {
	id: string
	name: string
	campus: string
	bio: string
	interests: string
}
async function agentAccountFacts(actor: AgentAccountIdentity) {
	const [
		recentComments,
		reading,
		loans,
		registrations,
		reactions,
		recentPosts,
	] = await Promise.all([
		db.comment.findMany({
			where: { authorId: actor.id, deletedAt: null },
			orderBy: { createdAt: 'desc' },
			take: 6,
			select: {
				id: true,
				postId: true,
				parentId: true,
				body: true,
				createdAt: true,
				post: { select: { title: true } },
			},
		}),
		db.bookState.findMany({
			where: { userId: actor.id },
			orderBy: { updatedAt: 'desc' },
			take: 8,
			select: {
				status: true,
				favorite: true,
				updatedAt: true,
				book: { select: { id: true, title: true, authors: true } },
			},
		}),
		db.bookLoan.findMany({
			where: { userId: actor.id },
			orderBy: { borrowedAt: 'desc' },
			take: 6,
			select: {
				borrowedAt: true,
				dueAt: true,
				returnedAt: true,
				book: { select: { id: true, title: true } },
			},
		}),
		db.state.findMany({
			where: { userId: actor.id, kind: 'REGISTER', activityId: { not: null } },
			orderBy: { createdAt: 'desc' },
			take: 6,
			select: {
				createdAt: true,
				activity: {
					select: {
						id: true,
						title: true,
						status: true,
						startsAt: true,
						endsAt: true,
						deadline: true,
						campus: true,
						location: true,
					},
				},
			},
		}),
		db.state.findMany({
			where: {
				userId: actor.id,
				kind: { in: ['LIKE', 'FAVORITE'] },
				postId: { not: null },
			},
			orderBy: { createdAt: 'desc' },
			take: 8,
			select: {
				kind: true,
				createdAt: true,
				post: { select: { id: true, title: true, authorId: true } },
			},
		}),
		db.post.findMany({
			where: { authorId: actor.id },
			orderBy: { createdAt: 'desc' },
			take: 4,
			select: {
				id: true,
				authorId: true,
				title: true,
				body: true,
				createdAt: true,
			},
		}),
	])
	return {
		actorId: actor.id,
		name: actor.name,
		profile: {
			campus: actor.campus,
			bio: actor.bio,
			interests: JSON.parse(actor.interests),
		},
		ownPublishedPosts: recentPosts.map((post) => ({
			...post,
			body: post.body.slice(0, 900),
			isSelfAuthored: true,
		})),
		recentComments: recentComments.map((comment) => ({
			...comment,
			body: comment.body.slice(0, 350),
		})),
		readingStates: reading,
		bookLoans: loans,
		activityRegistrations: registrations,
		recentReactions: reactions,
		coverage: { recentItemsOnly: true, missingRecordsDoNotProveAbsence: true },
	}
}
export async function agentContext(
	actorId: string,
	inputTrigger?: AgentTrigger,
	operationId?: string,
) {
	const actor = await syntheticActor(actorId)
	if (await isHumanControlled(actorId)) fail('AGENT_HUMAN_CONTROLLED', 409)
	const trigger = validateTrigger(actorId, inputTrigger)
	if (trigger.kind === 'direct-message') {
		const privateThreads = await focusedPrivateThreads(
			actorId,
			trigger.conversationId!,
		)
		const publicFacts = privateThreads.length
			? await privateThreadPublicFacts(
					actorId,
					privateThreads.flatMap((thread) =>
						[...thread.openingMessages, ...thread.messages.items].map(
							(message) => message.body,
						),
					),
				)
			: { ownPublishedPosts: [], referencedPosts: [] }
		await heartbeatPresence(actorId)
		return {
			selfFacts: {
				...(privateThreads.length
					? await agentAccountFacts(actor)
					: { actorId: actor.id, name: actor.name }),
				...publicFacts,
			},
			now: new Date().toISOString(),
			trigger,
			posts: [],
			comments: [],
			books: [],
			loans: [],
			relationships: [],
			privateThreads,
		}
	}
	const selfFacts = await agentAccountFacts(actor)
	if (trigger.kind === 'comment') {
		const target =
			trigger.targetType === 'comment'
				? await db.comment.findUnique({ where: { id: trigger.targetId } })
				: null
		const postId =
			target?.postId ??
			(trigger.targetType === 'post' ? trigger.targetId : undefined)
		const post = postId
			? await db.post.findUnique({
					where: { id: postId },
					select: {
						id: true,
						authorId: true,
						title: true,
						body: true,
						createdAt: true,
					},
				})
			: null
		const rootId = target?.parentId ?? target?.id
		const comments = post
			? await db.comment.findMany({
					where: {
						postId: post.id,
						deletedAt: null,
						...(rootId ? { OR: [{ id: rootId }, { parentId: rootId }] } : {}),
					},
					orderBy: { createdAt: 'desc' },
					take: 24,
					select: {
						id: true,
						postId: true,
						parentId: true,
						authorId: true,
						author: { select: { name: true } },
						body: true,
						createdAt: true,
						_count: { select: { likes: true } },
						likes: { where: { userId: actorId }, select: { userId: true } },
					},
				})
			: []
		return {
			selfFacts,
			now: new Date().toISOString(),
			trigger,
			posts: post ? [{ ...post, body: post.body.slice(0, 2000) }] : [],
			comments: comments.reverse().map(({ _count, likes, ...comment }) => ({
				...comment,
				replyRootId: comment.parentId ?? comment.id,
				body: comment.body.slice(0, 1000),
				likes: _count.likes,
				liked: likes.length > 0,
			})),
			thread: {
				postId: post?.id,
				rootId,
				signalCommentId: target?.id,
				rootComment: rootId
					? await db.comment.findUnique({
							where: { id: rootId },
							select: {
								id: true,
								authorId: true,
								body: true,
								deletedAt: true,
								createdAt: true,
							},
						})
					: null,
			},
			replyOpportunity: post
				? await commentReplyOpportunity(actorId, post.id, rootId)
				: { mayReply: false },
			books: [],
			loans: [],
			privateThreads: [],
			relationships: [],
		}
	}
	if (trigger.kind === 'social') {
		const senderIds = [
			...new Set(
				[
					trigger.senderId,
					...(trigger.relatedSignals ?? []).map((signal) => signal.senderId),
				].filter((id): id is string => !!id),
			),
		]
		const [friendships, following] = await Promise.all([
			db.friendship.findMany({
				where: {
					OR: [
						{ requesterId: actorId, recipientId: { in: senderIds } },
						{ recipientId: actorId, requesterId: { in: senderIds } },
					],
				},
				select: {
					id: true,
					requesterId: true,
					recipientId: true,
					status: true,
				},
			}),
			db.follow.findMany({
				where: { followerId: actorId, followingId: { in: senderIds } },
				select: { followingId: true },
			}),
		])
		const socialActors = await db.user.findMany({
			where: { id: { in: senderIds } },
			select: { id: true, name: true, campus: true, bio: true },
		})
		return {
			selfFacts,
			socialActors,
			friendRequests: await listFriendRequests(actorId),
			now: new Date().toISOString(),
			trigger,
			posts: [],
			comments: [],
			books: [],
			loans: [],
			privateThreads: [],
			relationships: senderIds.map((userId) => {
				const friendship =
					friendships.find(
						(row) => row.requesterId === userId || row.recipientId === userId,
					) ?? null
				return {
					userId,
					isSelf: userId === actorId,
					isFollowing: following.some((row) => row.followingId === userId),
					isFriend: friendship?.status === 'ACCEPTED',
					friendship,
				}
			}),
		}
	}

	const interests = Object.entries(
		JSON.parse(actor.interests) as Record<string, number>,
	)
		.filter(([, weight]) => weight > 0)
		.map(([tag]) => tag)

	const recommendation = await feed({
		userId: actorId,
		tab: 'recommended',
		q: '',
		tag: '',
		limit: 6,
	})
	const posts = recommendation.items.map((p) => ({
		id: p.id,
		authorId: p.author.id,
		createdAt: p.createdAt,
		viewer: p.viewer,
		stats: p.stats,
		activity: p.activity
			? {
					id: p.activity.id,
					title: p.activity.title,
					organizerId: p.activity.organizerId,
					startsAt: p.activity.startsAt,
					endsAt: p.activity.endsAt,
					deadline: p.activity.deadline,
					status: p.activity.status,
					availability: p.activity.availability,
					capacity: p.activity.capacity,
					registrations: p.activity.stats.registrations,
				}
			: null,
		title: p.title,
		body: p.body,
		tags: p.tags,
		mediaFacts: p.media
			.filter((asset) => ['Generated', 'Stock'].includes(asset.origin))
			.map((asset) => asset.alt.slice(0, 300)),
	}))
	const books = await db.book.findMany({
		take: 8,
		select: { id: true, title: true, tags: true },
	})
	const relevantBooks = books
		.sort(
			(a, b) =>
				JSON.parse(b.tags).filter((t: string) => interests.includes(t)).length -
				JSON.parse(a.tags).filter((t: string) => interests.includes(t)).length,
		)
		.slice(0, 4)
	const loans = await db.bookLoan.findMany({
		where: { userId: actorId, returnedAt: null },
		select: { bookId: true, dueAt: true },
	})

	const comments = await db.comment.findMany({
		where: { postId: { in: posts.map((p) => p.id) }, deletedAt: null },
		orderBy: { createdAt: 'desc' },
		take: 12,
		select: {
			id: true,
			postId: true,
			parentId: true,
			authorId: true,
			body: true,
			createdAt: true,
			_count: { select: { likes: true } },
			likes: { where: { userId: actorId }, select: { userId: true } },
		},
	})
	const [friendships, following] = await Promise.all([
		db.friendship.findMany({
			where: {
				OR: [{ requesterId: actorId }, { recipientId: actorId }],
			},
			select: { id: true, requesterId: true, recipientId: true, status: true },
		}),
		db.follow.findMany({
			where: { followerId: actorId },
			select: { followingId: true },
		}),
	])
	const friendIds = new Set(
		friendships
			.filter((f) => f.status === 'ACCEPTED')
			.map((f) => (f.requesterId === actorId ? f.recipientId : f.requesterId)),
	)
	const followingIds = new Set(following.map((f) => f.followingId))
	const relationships = [
		...new Set([...posts, ...comments].map((row) => row.authorId)),
	].map((userId) => ({
		userId,
		isSelf: userId === actorId,
		isFriend: friendIds.has(userId),
		isFollowing: followingIds.has(userId),
		friendship:
			friendships.find(
				(f) => f.requesterId === userId || f.recipientId === userId,
			) ?? null,
	}))

	const knownContacts = (await listConversations(actorId))
		.filter(
			(conversation) =>
				conversation.unread === 0 && friendIds.has(conversation.peer.id),
		)
		.slice(0, 4)
	const privateContacts: Array<{
		targetId: string
		conversationId?: string
		sourcePostId?: string
		userId: string
		isFriend: boolean
	}> = []
	if (await proactiveContactAllowed(actorId)) {
		for (const conversation of knownContacts) {
			if (await proactiveContactAllowed(actorId, conversation.id))
				privateContacts.push({
					targetId: conversation.id,
					conversationId: conversation.id,
					userId: conversation.peer.id,
					isFriend: true,
				})
		}
		if (operationId)
			for (const post of posts.filter((post) => post.authorId !== actorId)) {
				const [userLow, userHigh] = [actorId, post.authorId].sort() as [
					string,
					string,
				]
				const conversation = await db.conversation.findUnique({
					where: { userLow_userHigh: { userLow, userHigh } },
					select: { id: true },
				})
				if (await proactiveContactAllowed(actorId, conversation?.id))
					privateContacts.push({
						targetId: postContactToken(actorId, operationId, post.id),
						sourcePostId: post.id,
						userId: post.authorId,
						isFriend: friendIds.has(post.authorId),
					})
			}
	}
	const [latestPost, ownLatestPost] = await Promise.all([
		db.post.findFirst({
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		}),
		db.post.findFirst({
			where: { authorId: actorId },
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		}),
	])
	const mayPost =
		!ownLatestPost ||
		Date.now() - Date.parse(ownLatestPost.createdAt) >= 6 * 3600000
	const feedQuietMinutes = latestPost
		? Math.max(
				0,
				Math.floor((Date.now() - Date.parse(latestPost.createdAt)) / 60000),
			)
		: null
	const postingOpportunity = {
		mayPost,
		lastOwnPostAt: ownLatestPost?.createdAt ?? null,
		feedQuietMinutes,
		encouragePost:
			mayPost && (feedQuietMinutes === null || feedQuietMinutes >= 10),
	}

	await heartbeatPresence(actorId)
	return {
		selfFacts,
		now: new Date().toISOString(),
		posts: posts.map((p) => ({ ...p, body: p.body.slice(0, 2000) })),
		comments: comments.map(({ _count, likes, ...comment }) => ({
			...comment,
			replyRootId: comment.parentId ?? comment.id,
			likes: _count.likes,
			liked: likes.length > 0,
		})),
		friendRequests: await listFriendRequests(actorId),
		commentReplyOpportunities: await Promise.all(
			[
				...new Set(comments.map((comment) => comment.parentId ?? comment.id)),
			].map(async (rootId) => ({
				rootId,
				...(await commentReplyOpportunity(
					actorId,
					comments.find(
						(comment) => (comment.parentId ?? comment.id) === rootId,
					)!.postId,
					rootId,
				)),
			})),
		),
		relationships,
		privateThreads: [],
		privateContacts,
		postingOpportunity,
		books: relevantBooks,
		loans,
	}
}
export function validateAgentText(value: unknown, max: number) {
	const body = text(value, 'body', max)
	const stripped = body.replace(
		/```[\s\S]*?```|`[^`]*`|https?:\/\/[^\s。！？]+/g,
		(match) => (match.startsWith('http') && match.endsWith('.') ? '.' : ''),
	)
	if (/[。]/u.test(stripped) || /\.(?=\s|$)/u.test(stripped))
		fail('AGENT_SENTENCE_PERIOD', 422)
	return body
}
export async function agentReceipt(id: string, actorId: string) {
	await syntheticActor(actorId)
	const receipt = await db.agentOperationReceipt.findUnique({ where: { id } })
	if (receipt && receipt.actorId !== actorId) fail('FORBIDDEN', 403)
	return receipt
		? (JSON.parse(receipt.result) as { id?: string; ok?: boolean })
		: null
}
async function acknowledgeAgentReads(op: AgentOperation) {
	const reads = op.readAcknowledgements ?? []
	if (!Array.isArray(reads) || reads.length > 1) fail('VALIDATION_FAILED', 422)
	if (
		op.trigger &&
		reads.some(
			(read) =>
				op.trigger?.kind !== 'direct-message' ||
				read.conversationId !== op.trigger.conversationId,
		)
	)
		fail('INVALID_AGENT_READ_ACKNOWLEDGEMENT', 422)
	for (const item of reads) {
		if (!item || typeof item !== 'object') fail('VALIDATION_FAILED', 422)
		await markConversationRead(
			op.actorId,
			text(item.conversationId, 'conversationId', 100),
			item.sequence,
		)
	}
}
export async function performAgentOperation(op: AgentOperation) {
	const actor = await syntheticActor(text(op.actorId, 'actorId', 100))
	if (await isHumanControlled(actor.id)) fail('AGENT_HUMAN_CONTROLLED', 409)
	const operationId = text(op.operationId, 'operationId', 160)
	const cached = await agentReceipt(operationId, actor.id)
	if (cached) {
		await acknowledgeAgentReads(op)
		return cached
	}
	const d = op.decision ? { ...op.decision } : op.decision,
		now = new Date().toISOString()
	if (
		!d ||
		![
			'skip',
			'like',
			'favorite',
			'follow',
			'friend',
			'accept',
			'comment',
			'post',
			'message',
			'borrow',
			'return',
			'reading',
			'read',
		].includes(d.action)
	)
		fail('VALIDATION_FAILED', 422)
	if (d.action === 'comment' && d.parentId) {
		const parent = await db.comment.findUnique({
			where: { id: d.parentId },
			select: { postId: true, parentId: true, deletedAt: true },
		})
		if (parent && !parent.deletedAt && parent.postId === d.targetId)
			d.parentId = parent.parentId ?? d.parentId
	}
	const trigger = validateTrigger(actor.id, op.trigger)
	if (
		trigger.kind === 'direct-message' &&
		(!['message', 'skip'].includes(d.action) ||
			(d.action === 'message' && d.targetId !== trigger.conversationId))
	)
		fail('AGENT_TRIGGER_ACTION_MISMATCH', 422)
	if (trigger.kind === 'comment') {
		if (!['comment', 'like', 'skip'].includes(d.action))
			fail('AGENT_TRIGGER_ACTION_MISMATCH', 422)
		if (d.action === 'comment' || d.action === 'like') {
			const target =
				trigger.targetType === 'comment'
					? await db.comment.findUnique({ where: { id: trigger.targetId } })
					: null
			const postId =
				target?.postId ??
				(trigger.targetType === 'post' ? trigger.targetId : undefined)
			if (
				d.action === 'comment' &&
				postId &&
				!(
					await commentReplyOpportunity(
						actor.id,
						postId,
						target?.parentId ?? target?.id,
					)
				).mayReply
			)
				fail('AGENT_COMMENT_TURN_LIMIT', 409)
			if (d.action === 'like' && d.targetType === 'comment') {
				const liked = await db.comment.findUnique({
					where: { id: text(d.targetId, 'targetId', 100) },
				})
				const rootId = target?.parentId ?? target?.id
				if (
					!postId ||
					!liked ||
					liked.deletedAt ||
					liked.postId !== postId ||
					(rootId && liked.id !== rootId && liked.parentId !== rootId)
				)
					fail('AGENT_TRIGGER_ACTION_MISMATCH', 422)
			} else if (
				!postId ||
				d.targetId !== postId ||
				(d.action === 'comment' &&
					target &&
					d.parentId !== (target.parentId ?? target.id))
			)
				fail('AGENT_TRIGGER_ACTION_MISMATCH', 422)
		}
	}
	if (trigger.kind === 'social' && d.action !== 'skip') {
		if (!['follow', 'friend', 'accept'].includes(d.action))
			fail('AGENT_TRIGGER_ACTION_MISMATCH', 422)
		const senderIds = new Set([
			trigger.senderId,
			...(trigger.relatedSignals ?? []).map((signal) => signal.senderId),
		])
		if (d.action === 'accept') {
			const request = await db.friendship.findUnique({
				where: { id: text(d.targetId, 'targetId', 100) },
			})
			if (
				!request ||
				request.recipientId !== actor.id ||
				!senderIds.has(request.requesterId)
			)
				fail('AGENT_TRIGGER_ACTION_MISMATCH', 422)
		} else if (!senderIds.has(d.targetId))
			fail('AGENT_TRIGGER_ACTION_MISMATCH', 422)
	}
	if (d.targetType !== undefined && !['post', 'comment'].includes(d.targetType))
		fail('VALIDATION_FAILED', 422)
	if (d.targetType === 'comment' && d.action !== 'like')
		fail('VALIDATION_FAILED', 422)
	if (d.action === 'post') {
		const lastPost = await db.post.findFirst({
			where: { authorId: actor.id },
			orderBy: { createdAt: 'desc' },
			select: { createdAt: true },
		})
		if (lastPost && Date.now() - Date.parse(lastPost.createdAt) < 6 * 3600000)
			fail('AGENT_POST_COOLDOWN', 409)
	}
	if (await isHumanControlled(actor.id)) fail('AGENT_HUMAN_CONTROLLED', 409)
	const deterministicId =
		'agent:' + createHash('sha256').update(operationId).digest('hex')
	let result: { id?: string; ok?: boolean }
	if (d.action === 'skip') result = { ok: true }
	else if (d.action === 'message') {
		const prior = await db.directMessage.findUnique({
			where: {
				senderId_clientMessageId: {
					senderId: actor.id,
					clientMessageId: operationId,
				},
			},
			select: { conversationId: true },
		})
		let conversationId =
			prior?.conversationId ?? text(d.targetId, 'targetId', 220)
		if (!prior && trigger.kind === 'sweep') {
			if (conversationId.startsWith('post:')) {
				const end = conversationId.lastIndexOf(':')
				const sourcePostId = conversationId.slice(5, end)
				if (
					conversationId !==
					postContactToken(actor.id, operationId, sourcePostId)
				)
					fail('INVALID_AGENT_POST_CONTACT', 422)
				const post = await db.post.findUnique({
					where: { id: sourcePostId },
					select: { authorId: true },
				})
				if (!post || post.authorId === actor.id)
					fail('INVALID_AGENT_POST_CONTACT', 422)
				const [userLow, userHigh] = [actor.id, post.authorId].sort() as [
					string,
					string,
				]
				const existing = await db.conversation.findUnique({
					where: { userLow_userHigh: { userLow, userHigh } },
					select: { id: true },
				})
				if (!(await proactiveContactAllowed(actor.id, existing?.id)))
					fail('AGENT_PROACTIVE_MESSAGE_COOLDOWN', 409)
				if (await isHumanControlled(actor.id))
					fail('AGENT_HUMAN_CONTROLLED', 409)
				conversationId = (await createConversation(actor.id, post.authorId)).id
			} else {
				const conversation = await db.conversation.findUnique({
					where: { id: conversationId },
				})
				if (
					!conversation ||
					![conversation.userLow, conversation.userHigh].includes(actor.id)
				)
					fail('FORBIDDEN', 403)
				const peerId =
					conversation.userLow === actor.id
						? conversation.userHigh
						: conversation.userLow
				const friend = await db.friendship.findFirst({
					where: {
						status: 'ACCEPTED',
						OR: [
							{ requesterId: actor.id, recipientId: peerId },
							{ requesterId: peerId, recipientId: actor.id },
						],
					},
					select: { id: true },
				})
				if (
					!friend ||
					!(await proactiveContactAllowed(actor.id, conversationId))
				)
					fail('AGENT_PROACTIVE_MESSAGE_COOLDOWN', 409)
			}
		}
		if (await isHumanControlled(actor.id)) fail('AGENT_HUMAN_CONTROLLED', 409)
		result = await sendDirectMessage(actor.id, conversationId, {
			body: validateAgentText(d.body, 4000),
			mediaIds: [],
			clientMessageId: operationId,
		})
	} else if (d.action === 'borrow' || d.action === 'return')
		result = await changeBookLoan(
			db,
			actor.id,
			text(d.targetId, 'targetId', 100),
			d.action,
			now,
		)
	else if (d.action === 'reading' || d.action === 'read')
		result = await setBookState(
			db,
			actor.id,
			text(d.targetId, 'targetId', 100),
			{ status: d.action === 'read' ? 'READ' : 'READING' },
			now,
		)
	else if (
		['like', 'favorite', 'follow', 'friend', 'accept'].includes(d.action)
	)
		result = await act(
			actor.id,
			{
				action: d.action as
					'like' | 'favorite' | 'follow' | 'friend' | 'accept',
				targetId: text(d.targetId, 'targetId', 100),
				targetType: d.targetType ?? 'post',
				active: true,
			},
			now,
		)
	else if (d.action === 'comment') {
		if (
			d.parentId &&
			!(
				await commentReplyOpportunity(
					actor.id,
					text(d.targetId, 'targetId', 100),
					d.parentId,
				)
			).mayReply
		)
			fail('AGENT_COMMENT_TURN_LIMIT', 409)
		result = await createComment(
			actor.id,
			{
				postId: text(d.targetId, 'targetId', 100),
				parentId: d.parentId,
				body: validateAgentText(d.body, 2000),
				operationId,
			},
			'Synthetic',
		)
	} else
		result = await db.$transaction(async (tx) => {
			const prior = await tx.agentOperationReceipt.findUnique({
				where: { id: operationId },
			})
			if (prior) return JSON.parse(prior.result) as { id: string }
			const result = await tx.post.create({
				data: {
					id: deterministicId,
					authorId: actor.id,
					title: validateAgentText(d.title, 120),
					body: validateAgentText(d.body, 20000),
					tags: JSON.stringify(
						Object.keys(JSON.parse(actor.interests) as Record<string, number>),
					),
					kind: 'TEXT',
					purpose: 'DISCUSSION',
					createdAt: now,
					source: 'Synthetic',
				},
				select: { id: true },
			})
			await enqueueContentMentions(tx, {
				authorId: actor.id,
				targetType: 'post',
				targetId: result.id,
				text: `${d.title}\n${d.body}`,
				occurredAt: now,
			})
			await tx.agentOperationReceipt.create({
				data: {
					id: operationId,
					actorId: actor.id,
					action: d.action,
					result: JSON.stringify(result),
					createdAt: now,
				},
			})
			return result
		})
	await db.agentOperationReceipt.upsert({
		where: { id: operationId },
		create: {
			id: operationId,
			actorId: actor.id,
			action: d.action,
			result: JSON.stringify(result),
			createdAt: now,
		},
		update: {},
	})
	await acknowledgeAgentReads(op)
	return result
}
