export type BookStatus = 'NONE' | 'WANT' | 'READING' | 'READ'
export type BookMode = 'hybrid' | 'user' | 'item' | 'content'
export interface BookView {
	id: string
	title: string
	authors: string[]
	publisher: string
	description: string
	language: string
	isbn13: string | null
	coverUrl: string
	tags: string[]
	academic: boolean
	available: number
	copies: number
	status: BookStatus
	favorite: boolean
	loan: BookLoanView | null
}
export interface BookLoanView {
	id: string
	borrowedAt: string
	dueAt: string
	returnedAt: string | null
}
export interface BookRecord {
	id: string
	userId: string
	bookId: string
	kind: string
	occurredAt: string
}
export interface BookAlgorithmItem {
	id: string
	title: string
	tags: string[]
}
export interface BookAlgorithmUser {
	id: string
	name?: string
	interests: Record<string, number>
}
export interface BookSnapshot {
	states?: {
		userId: string
		bookId: string
		status: string
		favorite: boolean
		updatedAt: string
	}[]
	books: BookAlgorithmItem[]
	users: BookAlgorithmUser[]
	records: BookRecord[]
	crossDomain: Record<string, Record<string, number>>
}
export interface BookRecommendationInput {
	snapshot: BookSnapshot
	userId: string
	now: string
	mode?: BookMode
	resultCount?: number
	neighborCount?: number
	crossDomain?: boolean
	weights?: { user: number; item: number; content: number }
}
export interface BookContribution {
	id: string
	similarity: number
	overlap: number
	contribution: number
}
export interface BookScore {
	id: string
	score: number
	user: number
	item: number
	content: number
	matchedTags: string[]
	userContributions: BookContribution[]
	itemContributions: BookContribution[]
}
export interface BookRecommendationResult {
	items: BookScore[]
	matrix: {
		userId: string
		entries: { bookId: string; value: number; normalized: number }[]
	}[]
	neighbors: { userId: string; similarity: number; overlap: number }[]
	profile: Record<string, number>
	channels: { user: boolean; item: boolean; content: boolean }
	candidateCount: number
	heapSteps: { action: string; bookId: string; size: number }[]
}
