export type AgentGraphState = 'running' | 'ready' | 'queued' | 'idle'
export type AgentGraphEdgeKind =
	'friend' | 'follow' | 'message' | 'comment' | 'task'
export interface AgentGraphTask {
	status: string
	action: string | null
	updatedAt: string
}
export interface AgentGraphNode {
	id: string
	name: string
	avatar: string
	campus: string
	className: string
	interests: string[]
	state: AgentGraphState
	humanControlled: boolean
	currentTask: AgentGraphTask | null
	lastAction: AgentGraphTask | null
}
export interface AgentGraphEdge {
	id: string
	source: string
	target: string
	kind: AgentGraphEdgeKind
	count: number
	lastAt: string | null
}
export interface AgentGraphEvent {
	id: string
	kind: 'message' | 'comment' | 'post'
	actorId: string
	actorName: string
	targetId: string | null
	targetName: string | null
	title: string | null
	body: string
	occurredAt: string
}
export interface AgentGraphResponse {
	observedAt: string
	recentSince: string
	recentLimit: number
	events: AgentGraphEvent[]
	nodes: AgentGraphNode[]
	edges: AgentGraphEdge[]
}
