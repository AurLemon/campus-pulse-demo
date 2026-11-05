export interface StudioUserSearchRequest {
	q: string
	page: number
	pageSize: number
	all: boolean
	signal?: AbortSignal
}
