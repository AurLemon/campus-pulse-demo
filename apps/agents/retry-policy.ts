export const MAX_JOB_RETRIES = 5
export type JobFailureKind =
	'human' | 'protected' | 'regenerate' | 'transient' | 'terminal'

export function jobFailureKind(error: string): JobFailureKind {
	if (error.includes('AGENT_HUMAN_CONTROLLED')) return 'human'
	if (
		/PI_USAGE_UNKNOWN:.*(?:abort|timed?\s*out|timeout|connection|network|fetch failed|ECONN|EPIPE|HTTP (?:408|429|5\d\d))/i.test(
			error,
		)
	)
		return 'transient'
	if (
		/BUDGET|PRICING|PI_USAGE_UNKNOWN|PI_RESULT_MISSING|USAGE_ANOMALY/.test(
			error,
		)
	)
		return 'protected'
	if (
		/^INVALID_MODEL_RESULT:|PRODUCT_422:(?:INVALID_REPLY|VALIDATION_FAILED|AGENT_TRIGGER_ACTION_MISMATCH|AGENT_SENTENCE_PERIOD|INVALID_AGENT_READ_ACKNOWLEDGEMENT)|PRODUCT_404:NOT_FOUND/.test(
			error,
		)
	)
		return 'regenerate'
	if (
		/PRODUCT_(?:408|425|429|5\d\d):|PI_BATCH_FAILED|fetch failed|ECONN|EPIPE|ENOTFOUND|EAI_AGAIN|TimeoutError|AbortError|Request was aborted|network|connection/i.test(
			error,
		)
	)
		return 'transient'
	return 'terminal'
}
export function retryDelayMs(retry: number) {
	return Math.min(30_000, 2000 * 2 ** Math.max(0, retry - 1))
}
export function writingBatchId(jobId: string, retry: number) {
	return `runtime-${jobId}${retry ? `-retry-${retry}` : ''}`
}
export function writingJobId(batchId: string) {
	const writingId = batchId.startsWith('review-runtime-')
		? batchId.slice('review-'.length)
		: batchId
	return writingId.startsWith('runtime-')
		? writingId.slice('runtime-'.length).replace(/-retry-\d+$/, '')
		: null
}
