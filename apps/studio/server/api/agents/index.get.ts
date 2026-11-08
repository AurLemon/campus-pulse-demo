import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { productOrigin } from '../../../../agents/client'
import { runtimeStatus } from '../../../../agents/store'
import { writingJobId } from '../../../../agents/retry-policy'
import {
	readTaskBudget,
	readLedger,
	type LedgerEntry,
} from '../../../../../tools/content/budget'
import { studioDatabaseUrl } from '../../utils/snapshot'
import { studioProductBrowserOrigin } from '../../utils/studio-product'
async function originalFailure(entry: LedgerEntry | undefined) {
	if (!entry) return null
	if (entry.error?.startsWith('PI_USAGE_UNKNOWN:')) return entry.error
	if (entry.error !== 'PI_USAGE_UNKNOWN') return null
	try {
		const result = JSON.parse(
			await readFile(resolve(entry.job, 'result.json'), 'utf8'),
		) as { error?: string; metadata?: { transportError?: string } }
		const detail = result.metadata?.transportError || result.error
		return detail ? `PI_USAGE_UNKNOWN:${detail.slice(0, 500)}` : null
	} catch {
		return null
	}
}
export default defineEventHandler(async (event) => {
	setHeader(event, 'Cache-Control', 'no-store')
	const q = getQuery(event)
	const state = runtimeStatus({
		actorId: String(q.actorId || ''),
		action: String(q.action || ''),
		status: String(q.status || ''),
		q: String(q.q || '').slice(0, 200),
		page: Math.max(1, Number(q.page) || 1),
	})
	const ledger = await readLedger()
	const costs = new Map<string, LedgerEntry[]>()
	for (const entry of ledger.entries) {
		const jobId = writingJobId(entry.id)
		if (!jobId) continue
		const entries = costs.get(jobId) ?? []
		entries.push(entry)
		costs.set(jobId, entries)
	}
	if (state.pauseReason === 'PI_USAGE_UNKNOWN') {
		const failed = ledger.entries.findLast(
			(entry) =>
				writingJobId(entry.id) !== null &&
				entry.error?.startsWith('PI_USAGE_UNKNOWN'),
		)
		state.pauseReason = (await originalFailure(failed)) ?? state.pauseReason
	}
	let database: Database.Database | undefined
	try {
		database = new Database(studioDatabaseUrl().slice(5), {
			readonly: true,
			fileMustExist: true,
		})
		for (const job of state.jobs) {
			const entries = costs.get(job.id) ?? []
			if (job.error === 'PI_USAGE_UNKNOWN')
				job.error = (await originalFailure(entries.at(-1))) ?? job.error
			job.costUsd = entries.length
				? entries.reduce(
						(sum, entry) =>
							sum + (entry.usage?.estimatedCostUsd ?? entry.reservedUsd),
						0,
					)
				: null
			job.costReserved = entries.some((entry) => !entry.usage)
			const d = job.decision,
				target = d?.action === 'post' ? job.result?.id : d?.targetId
			if (!target || !d) continue
			if (d.action === 'like' && d.targetType === 'comment') {
				const comment = database
					.prepare(
						'SELECT c.postId,p.title FROM Comment c JOIN Post p ON p.id=c.postId WHERE c.id=?',
					)
					.get(String(target)) as { postId: string; title: string } | undefined
				job.targetTitle = comment?.title ?? null
				job.targetUrl = comment
					? `/?post=${encodeURIComponent(comment.postId)}`
					: null
				continue
			}
			if (d.action === 'friend' || d.action === 'accept') {
				const person =
					d.action === 'accept'
						? (database
								.prepare(
									'SELECT u.id,u.name FROM Friendship f JOIN User u ON u.id=f.requesterId WHERE f.id=?',
								)
								.get(String(target)) as
								{ id: string; name: string } | undefined)
						: (database
								.prepare('SELECT id,name FROM User WHERE id=?')
								.get(String(target)) as
								{ id: string; name: string } | undefined)
				job.targetTitle = person?.name ?? null
				job.targetUrl = person
					? `/users/${encodeURIComponent(person.id)}`
					: null
				continue
			}
			const table =
				d.action === 'follow'
					? 'User'
					: ['borrow', 'return', 'reading', 'read'].includes(d.action)
						? 'Book'
						: d.action === 'message' || d.action === 'skip'
							? null
							: 'Post'
			if (!table) continue
			const row = database
				.prepare(
					`SELECT ${table === 'User' ? 'name' : 'title'} AS title FROM "${table}" WHERE id=?`,
				)
				.get(String(target)) as { title: string } | undefined
			job.targetTitle ??= row?.title ?? null
		}
	} finally {
		database?.close()
	}
	return {
		...state,
		productOrigin: studioProductBrowserOrigin(event, productOrigin()),
		budget: await readTaskBudget(),
	}
})
