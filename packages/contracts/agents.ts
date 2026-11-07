export const MAX_AGENT_ACTORS = 500
export interface AgentWritingHabits {
	shortReplies: string
	punctuation: string
	whenLonger: string
}
export interface AgentKnowledgeEdges {
	familiarWith: string[]
	uncertainAbout: string[]
	notAuthorizedToInvent: string[]
}
export interface AgentSocialEdge {
	actorId: string
	kind: 'friend' | 'following'
}
export interface AgentEngagementBias {
	stranger: string
	friend: string
	skipWhen: string[]
}
export interface AgentPersona {
	profileAsOf?: string
	ordinaryLifeFacts?: string[]
	currentMotives?: string[]
	writingHabits?: AgentWritingHabits
	knowledgeEdges?: AgentKnowledgeEdges
	socialEdges?: AgentSocialEdge[]
	engagementBias?: AgentEngagementBias
	followingIds?: string[]
	circle?: string
	circles?: string[]
	secondaryInterests?: string[]
	lifeContext?: string
	routine?: string
	onlineHabits?: string
	actorId: string
	name: string
	campus: string
	className: string
	grade: number
	interests: string[]
	activeHours: number[]
	activityWeight: number
	cooldownMinutes: number
	/** Accepted friends only. A follow is not evidence of friendship or shared history. */
	relationships: string[]
	voice: string
	recentEvents: string[]
}
export interface AgentDecision {
	targetType?: 'post' | 'comment'
	action:
		| 'skip'
		| 'like'
		| 'favorite'
		| 'follow'
		| 'friend'
		| 'accept'
		| 'comment'
		| 'post'
		| 'message'
		| 'borrow'
		| 'return'
		| 'reading'
		| 'read'
	targetId?: string
	parentId?: string
	title?: string
	body?: string
}
export interface AgentTrigger {
	relatedSignals?: AgentTrigger[]
	signalIds?: string[]
	kind: 'direct-message' | 'comment' | 'social' | 'sweep'
	recipientId: string
	signalId?: string
	senderId?: string
	conversationId?: string
	targetId?: string
	targetType?:
		'post' | 'activity' | 'user' | 'comment' | 'conversation' | 'book'
	createdAt?: string
}
export interface AgentReadAcknowledgement {
	conversationId: string
	sequence: number
}
export interface AgentOperation {
	trigger?: AgentTrigger
	readAcknowledgements?: AgentReadAcknowledgement[]
	operationId: string
	actorId: string
	decision: AgentDecision
}
export interface AgentJob {
	trigger?: AgentTrigger | null
	id: string
	actorId: string
	actorName: string
	status: string
	action: string | null
	error: string | null
	createdAt: string
	updatedAt: string
	decision: AgentDecision | null
	result: Record<string, unknown> | null
	targetTitle: string | null
	targetUrl: string | null
	costUsd?: number | null
	costReserved?: boolean
}
export interface AgentJobFilter {
	actorId?: string
	action?: string
	status?: string
	q?: string
	page?: number
}
export interface AgentRuntimeStatus {
	maxActorLimit: number
	actorCount: number
	enabled: boolean
	pauseReason: string | null
	intervalSeconds: number
	actorLimit: number
	workerPid: number | null
	heartbeatAt: string | null
	personas: AgentPersona[]
	concurrency: number
	maxConcurrency: number
	maxBackgroundConcurrency: number
	decisionLimit: number
	completedDecisions: number
	queuedCount: number
	runningCount: number
	jobTotal: number
	jobPage: number
	jobPageSize: number
	jobs: AgentJob[]
}
