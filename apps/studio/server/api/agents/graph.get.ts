import Database from 'better-sqlite3'
import { defaultUserAvatar } from '@campus/contracts'
import { personas, store } from '../../../../agents/store'
import { studioDatabaseUrl } from '../../utils/snapshot'
import type {
	AgentGraphResponse,
	AgentGraphEdge,
	AgentGraphEdgeKind,
	AgentGraphState,
	AgentGraphEvent,
	AgentGraphLike,
} from '../../../shared/types/agent-graph'
interface RelationshipRow {
	source: string
	target: string
	createdAt: string
}
interface EventJobRow {
	id: string
	actorId: string
	action: AgentGraphEvent['kind']
	contentId: string | null
}
interface EventContentRow {
	postId: string | null
	actorName: string
	targetId: string | null
	targetName: string | null
	title: string | null
	body: string
	occurredAt: string
}
interface JobRow {
	actorId: string
	status: string
	action: string | null
	updatedAt: string
	senderId: string | null
}
export default defineEventHandler((event): AgentGraphResponse => {
	setHeader(event, 'Cache-Control', 'no-store')
	let database: Database.Database | undefined
	try {
		const url = studioDatabaseUrl()
		if (!url.startsWith('file:')) throw new Error('UNSUPPORTED_DATABASE')
		database = new Database(url.slice(5), {
			readonly: true,
			fileMustExist: true,
		})
		const db = database,
			observedAt = new Date().toISOString(),
			recentSince = new Date(Date.now() - 86_400_000).toISOString(),
			recentLimit = 2000,
			people = personas(),
			ids = new Set(people.map((person) => person.actorId)),
			edges = new Map<string, AgentGraphEdge>()
		function add(
			kind: AgentGraphEdgeKind,
			source: string,
			target: string,
			at: string | null,
		) {
			if (!ids.has(source) || !ids.has(target) || source === target) return
			if (kind === 'friend' && source > target)
				[source, target] = [target, source]
			const id = `${kind}:${source}:${target}`,
				prior = edges.get(id)
			if (prior) {
				prior.count++
				if (at && (!prior.lastAt || at > prior.lastAt)) prior.lastAt = at
			} else edges.set(id, { id, source, target, kind, count: 1, lastAt: at })
		}
		let eventJobs: EventJobRow[] = []
		const current = new Map<string, JobRow>(),
			latest = new Map<string, JobRow>()
		store.transaction(() => {
			const projection = `actorId,status,COALESCE(action,json_extract(decision,'$.action')) AS action,updatedAt,json_extract(trigger,'$.senderId') AS senderId`
			const jobs = store
				.prepare(
					`SELECT ${projection} FROM jobs WHERE status IN ('queued','ready','running') ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'ready' THEN 1 ELSE 2 END,createdAt`,
				)
				.all() as JobRow[]
			for (const job of jobs) {
				if (!current.has(job.actorId)) current.set(job.actorId, job)
				if (job.senderId) add('task', job.actorId, job.senderId, job.updatedAt)
			}
			const recent = store
				.prepare(
					`SELECT actorId,status,action,updatedAt,senderId FROM (SELECT ${projection},ROW_NUMBER() OVER (PARTITION BY actorId ORDER BY updatedAt DESC,rowid DESC) AS rank FROM jobs) WHERE rank=1`,
				)
				.all() as JobRow[]
			for (const job of recent) latest.set(job.actorId, job)
			eventJobs = store
				.prepare(
					`SELECT id,actorId,action,json_extract(CASE WHEN json_valid(result) THEN result ELSE '{}' END,'$.id') AS contentId FROM jobs WHERE status='complete' AND action IN ('message','comment','post') AND updatedAt>=? ORDER BY updatedAt DESC,rowid DESC LIMIT 16`,
				)
				.all(recentSince) as EventJobRow[]
		})()
		return db.transaction(() => {
			const humans = new Set(
				(
					db
						.prepare(
							'SELECT DISTINCT userId FROM AuthSession WHERE expiresAt>?',
						)
						.all(observedAt) as Array<{ userId: string }>
				).map((row) => row.userId),
			)
			for (const row of db
				.prepare(
					"SELECT requesterId AS source,recipientId AS target,createdAt FROM Friendship WHERE status='ACCEPTED'",
				)
				.all() as RelationshipRow[])
				add('friend', row.source, row.target, row.createdAt)
			for (const row of db
				.prepare(
					'SELECT followerId AS source,followingId AS target,createdAt FROM Follow',
				)
				.all() as RelationshipRow[])
				add('follow', row.source, row.target, row.createdAt)
			const messages = db
				.prepare(
					`SELECT m.senderId AS source,CASE WHEN c.userLow=m.senderId THEN c.userHigh ELSE c.userLow END AS target,m.createdAt FROM DirectMessage m JOIN Conversation c ON c.id=m.conversationId WHERE m.createdAt>=? ORDER BY m.createdAt DESC LIMIT ?`,
				)
				.all(recentSince, recentLimit) as RelationshipRow[]
			for (const row of messages)
				add('message', row.source, row.target, row.createdAt)
			const comments = db
				.prepare(
					`SELECT c.authorId AS source,COALESCE(parent.authorId,p.authorId) AS target,c.createdAt FROM Comment c JOIN Post p ON p.id=c.postId LEFT JOIN Comment parent ON parent.id=c.parentId WHERE c.deletedAt IS NULL AND c.createdAt>=? ORDER BY c.createdAt DESC LIMIT ?`,
				)
				.all(recentSince, recentLimit) as RelationshipRow[]
			for (const row of comments)
				add('comment', row.source, row.target, row.createdAt)
			const task = (row: JobRow | undefined) =>
				row
					? { status: row.status, action: row.action, updatedAt: row.updatedAt }
					: null
			// Only inspect content produced by completed jobs of synthetic graph actors.
			// A receipt alone is not authority: verify author and current product row.
			const contentQueries = {
				message: db.prepare(
					`SELECT NULL AS postId,a.name AS actorName,other.id AS targetId,other.name AS targetName,NULL AS title,m.body,m.createdAt AS occurredAt FROM DirectMessage m JOIN User a ON a.id=m.senderId AND a.source='Synthetic' JOIN Conversation c ON c.id=m.conversationId JOIN User other ON other.id=CASE WHEN c.userLow=m.senderId THEN c.userHigh ELSE c.userLow END WHERE m.id=? AND m.senderId=?`,
				),
				comment: db.prepare(
					`SELECT p.id AS postId,a.name AS actorName,target.id AS targetId,target.name AS targetName,p.title,c.body,c.createdAt AS occurredAt FROM Comment c JOIN User a ON a.id=c.authorId AND a.source='Synthetic' JOIN Post p ON p.id=c.postId LEFT JOIN Comment parent ON parent.id=c.parentId JOIN User target ON target.id=COALESCE(parent.authorId,p.authorId) WHERE c.id=? AND c.authorId=? AND c.deletedAt IS NULL`,
				),
				post: db.prepare(
					`SELECT p.id AS postId,a.name AS actorName,NULL AS targetId,NULL AS targetName,p.title,p.body,p.createdAt AS occurredAt FROM Post p JOIN User a ON a.id=p.authorId AND a.source='Synthetic' WHERE p.id=? AND p.authorId=?`,
				),
			}
			const events: AgentGraphEvent[] = eventJobs.flatMap((job) => {
				if (!ids.has(job.actorId) || !job.contentId) return []
				const content = contentQueries[job.action].get(
					job.contentId,
					job.actorId,
				) as EventContentRow | undefined
				return content
					? [{ id: job.id, kind: job.action, actorId: job.actorId, ...content }]
					: []
			})
			const likesSince = new Date(Date.parse(observedAt) - 10_000).toISOString()
			const likes = (
				db
					.prepare(
						`
				SELECT 'post:' || id AS id,userId AS actorId,createdAt AS occurredAt FROM State WHERE kind='LIKE' AND postId IS NOT NULL AND createdAt>=?
				UNION ALL
				SELECT 'comment:' || userId || ':' || commentId || ':' || createdAt AS id,userId AS actorId,createdAt AS occurredAt FROM CommentLike WHERE createdAt>=?
				ORDER BY occurredAt DESC LIMIT 200
			`,
					)
					.all(likesSince, likesSince) as AgentGraphLike[]
			).filter((like) => ids.has(like.actorId))
			return {
				likes,
				observedAt,
				recentSince,
				recentLimit,
				events,
				nodes: people.map((person) => ({
					id: person.actorId,
					name: person.name,
					avatar: defaultUserAvatar(person.actorId).replace(
						'/media/',
						'/api/agents/avatars/',
					),
					campus: person.campus,
					className: person.className,
					interests: person.interests,
					state: (current.get(person.actorId)?.status ??
						'idle') as AgentGraphState,
					humanControlled: humans.has(person.actorId),
					currentTask: task(current.get(person.actorId)),
					lastAction: task(latest.get(person.actorId)),
				})),
				edges: [...edges.values()],
			}
		})()
	} catch {
		throw createError({
			statusCode: 503,
			statusMessage: 'STUDIO_AGENT_GRAPH_UNAVAILABLE',
		})
	} finally {
		database?.close()
	}
})
