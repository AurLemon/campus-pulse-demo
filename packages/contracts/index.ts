import type { TextMention } from './mentions.ts'
export { CAMPUSES } from './catalog.ts'
export type ContentSource = 'Synthetic' | 'Real' | 'Generated'
export interface User {
	id: string
	name: string
	bio: string
	campus: string
	role: 'STUDENT' | 'ORGANIZER' | 'ADMIN'
	interests: Record<string, number>
	createdAt: string
	source: ContentSource
}
export interface PosterOptions {
	posterTemplate?: 'orbit' | 'quote' | 'note'
	posterAspect?: 'portrait' | 'square' | 'landscape'
	posterHighlight?: string
}
export interface Activity extends PosterOptions {
	id: string
	organizerId: string
	title: string
	body: string
	tags: string[]
	campus: string
	location: string
	startsAt: string
	endsAt: string
	deadline: string
	capacity: number
	coverId?: string | null
	status: 'PUBLISHED' | 'CANCELLED'
	createdAt: string
	source: ContentSource
}
export interface Post extends PosterOptions {
	id: string
	authorId: string
	activityId: string | null
	title: string
	body: string
	tags: string[]
	kind: 'TEXT' | 'ARTICLE'
	purpose?: 'RECRUITMENT' | 'REVIEW' | 'GUIDE' | 'DISCUSSION'
	mediaIds?: string[]
	createdAt: string
	source: ContentSource
}
export interface Comment {
	mediaIds?: string[]
	id: string
	postId: string
	authorId: string
	parentId: string | null
	body: string
	createdAt: string
	source: ContentSource
}
export interface Friendship {
	id: string
	requesterId: string
	recipientId: string
	status: 'PENDING' | 'ACCEPTED'
	createdAt: string
}
export interface Follow {
	id: string
	followerId: string
	followingId: string
	createdAt: string
}
export interface State {
	id: string
	userId: string
	postId: string | null
	activityId: string | null
	kind: 'LIKE' | 'FAVORITE' | 'REGISTER'
	createdAt: string
}
export interface Behavior {
	id: string
	userId: string
	postId: string | null
	activityId: string | null
	kind:
		| 'VIEW'
		| 'LIKE'
		| 'UNLIKE'
		| 'FAVORITE'
		| 'UNFAVORITE'
		| 'REGISTER'
		| 'UNREGISTER'
		| 'COMMENT'
	createdAt: string
	effectiveMs: number
}
export interface ViewSession {
	id: string
	userId: string
	postId: string | null
	activityId: string | null
	startedAt: string
	updatedAt: string
	effectiveMs: number
	closed: boolean
}
export interface Snapshot {
	version: string
	source: ContentSource
	seed: number
	now: string
	users: User[]
	activities: Activity[]
	posts: Post[]
	comments: Comment[]
	friendships: Friendship[]
	follows: Follow[]
	states: State[]
	behaviors: Behavior[]
	sessions: ViewSession[]
}
export interface ScoreWeights {
	interest: number
	social: number
	popularity: number
	context: number
}
export interface ScoreParts {
	interest: number
	social: number
	popularity: number
	context: number
}
export interface RecommendationExploration {
	seed: string
	strength: number
}
export interface Recommendation {
	id: string
	score: number
	relevanceScore?: number
	explorationDraw?: number
	explorationStrength?: number
	parts: ScoreParts
	contributions: ScoreParts
	friendIds: string[]
	followIds: string[]
	matchedTags: string[]
	fallback: boolean
}
export interface RecommendationInput {
	snapshot: Snapshot
	userId: string
	k: number
	now: string
	weights?: ScoreWeights
	exploration?: RecommendationExploration
}
export interface RecommendationResult {
	items: Recommendation[]
	candidateCount: number
	profile: Record<string, number>
	weights: ScoreWeights
	elapsedMs: number
	exploration?: RecommendationExploration
	trace: string[]
}
export interface Bootstrap {
	user: PublicUser | null
	topics: string[]
	campuses: string[]
}
export interface Mutation {
	action: 'like' | 'favorite' | 'register' | 'follow' | 'friend' | 'accept'
	targetId: string
	active: boolean
	targetType?: 'post' | 'activity' | 'comment'
}
export interface ApiErrorData {
	code: string
	fields?: Record<string, string>
	requestId: string
}

export interface MediaAsset {
	id: string
	url: string
	mime: string
	width: number
	height: number
	alt: string
	origin: string
	sourceUrl?: string | null
	attribution?: string | null
}
export interface PublicUser extends Omit<User, 'source'> {
	avatar?: string | null
}
export interface ActivityView extends Omit<Activity, 'source'> {
	organizer: PublicUser
	cover: MediaAsset | null
	stats: { registrations: number; favorites: number }
	viewer: { registered: boolean; favorited: boolean }
	availability: 'OPEN' | 'FULL' | 'CLOSED' | 'CANCELLED' | 'ENDED'
}
export interface PostView extends Omit<Post, 'source'> {
	bodyMentions?: TextMention[]
	titleMentions?: TextMention[]
	author: PublicUser
	activity: ActivityView | null
	media: MediaAsset[]
	stats: { likes: number; favorites: number; comments: number }
	viewer: { liked: boolean; favorited: boolean }
	reason?: string
}
export interface CommentView extends Omit<Comment, 'source'> {
	mentions?: TextMention[]
	stats: { likes: number }
	viewer: { liked: boolean }
	media: MediaAsset[]
	deleted: boolean
	author: PublicUser
}
export interface FeedPage {
	items: PostView[]
	nextCursor: string | null
	hasMore: boolean
	sessionId: string
	newestAt: string | null
}
export interface SidebarData {
	user: PublicUser | null
	counts: { registrations: number; favorites: number; posts: number }
	schedule: ActivityView[]
	recommendations: ActivityView[]
	interests: Record<string, number>
}
export interface PostComments {
	comments: CommentView[]
}
export interface PostDetail {
	post: PostView
	comments: CommentView[]
	related: PostView[]
}
export interface ActivityDetail {
	activity: ActivityView
	posts: PostView[]
}
export interface UserDetail {
	user: PublicUser
	posts: PostView[]
	activities: ActivityView[]
	relationship: { following: boolean; friendship: Friendship | null }
	requests: Array<Friendship & { requester: PublicUser }>
}
export interface ActorContext {
	userId: string
	role: User['role']
}
export interface Clock {
	now(): string
}
export interface ContentImportBatch {
	id: string
	version: string
	snapshot: Snapshot
	media: MediaAsset[]
}

export interface ContentPublishedEvent {
	batchId: string
	version: string
	committedAt: string
	counts: {
		users: number
		activities: number
		posts: number
		comments: number
		media: number
	}
}
export interface ContentImportOptions {
	onPublished?: (event: ContentPublishedEvent) => void | Promise<void>
}

/** Local development handoff only. No credentials are exposed to Studio. */
export interface StudioAccount {
	id: string
	name: string
	account: string | null
	campus: string
	role: User['role']
}
export interface StudioAccountsResponse {
	accounts: StudioAccount[]
	total: number
	page: number
	pageSize: number
}
export interface StudioLoginTicket {
	ticket: string
	expiresAt: string
}
export interface StudioLoginLink {
	url: string
	expiresAt: string
}

export { defaultUserAvatar } from './avatars.ts'
