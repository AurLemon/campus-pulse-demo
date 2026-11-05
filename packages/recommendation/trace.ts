import type { Recommendation, ScoreWeights } from '@campus/contracts'

export interface HeapFrame {
	id: string
	score: number
}
export type TraceAction =
	| 'profile'
	| 'filter'
	| 'score'
	| 'candidate'
	| 'compare'
	| 'insert'
	| 'remove'
	| 'swap'
	| 'retain'
	| 'replace'
	| 'skip'
	| 'output'
	| 'truncated'
export interface RecommendationTraceEvent {
	sequence: number
	action: TraceAction
	id?: string
	reason?: string
	accepted?: boolean
	indices?: number[]
	heap?: HeapFrame[]
	item?: Recommendation
	profile?: Record<string, number>
	weights?: ScoreWeights
	resultIds?: string[]
}
export interface TraceOptions {
	onTrace: (event: RecommendationTraceEvent) => void
	maxEvents?: number
}
export interface HeapMutation<T> {
	action: 'compare' | 'insert' | 'remove' | 'swap'
	values: T[]
	indices: number[]
	item?: T
}
