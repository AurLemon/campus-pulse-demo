import type { Snapshot, RecommendationResult } from '@campus/contracts'
import type { RecommendationTraceEvent } from '@campus/recommendation'

export interface StudioState {
	snapshot: Snapshot
	scope: 'live-product-readonly'
	revision: string
}
export interface StudioRun {
	snapshot: Snapshot
	revision: string
	now: string
	result: RecommendationResult
	events: RecommendationTraceEvent[]
	truncated: boolean
}
