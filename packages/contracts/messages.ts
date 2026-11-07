import type { Friendship, MediaAsset, PublicUser } from './index.ts'
export type NotificationKind =
	| 'LIKE'
	| 'FAVORITE'
	| 'FOLLOW'
	| 'COMMENT'
	| 'REPLY'
	| 'FRIEND_REQUEST'
	| 'FRIEND_ACCEPTED'
	| 'MENTION'
export interface CommunityEvent {
	id: string
	kind:
		| 'ReactionChanged'
		| 'FollowCreated'
		| 'FriendRequested'
		| 'FriendAccepted'
		| 'MentionCreated'
		| 'CommentCreated'
		| 'DirectMessageCreated'
		| 'BookLoanChanged'
	actorId: string
	recipientId: string
	targetType: 'post' | 'activity' | 'user' | 'comment' | 'conversation' | 'book'
	targetId: string
	notificationKind?: NotificationKind
	occurredAt: string
}
export interface DirectMessageView {
	id: string
	conversationId: string
	senderId: string
	body: string
	media: MediaAsset[]
	sequence: number
	createdAt: string
}
export interface ConversationView {
	id: string
	peer: PublicUser
	online: boolean
	unread: number
	lastMessage: DirectMessageView | null
	updatedAt: string
}
export interface ConversationMessages {
	items: DirectMessageView[]
	hasMore: boolean
	nextSequence: number
}
export interface NotificationView {
	id: string
	kind: NotificationKind
	actor: PublicUser | null
	targetType: string
	targetId: string
	targetAvailable: boolean
	targetUrl: string | null
	targetTitle: string | null
	createdAt: string
	read: boolean
}

export interface ConversationPage {
	items: ConversationView[]
	nextCursor: string | null
	hasMore: boolean
}

export interface FriendRequestView extends Friendship {
	requester: PublicUser
}
