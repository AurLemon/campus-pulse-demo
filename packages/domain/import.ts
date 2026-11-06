import { db, dataDirectory } from './prisma.ts'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
	Snapshot,
	PosterOptions,
	ContentImportBatch,
	ContentImportOptions,
	ContentPublishedEvent,
} from '@campus/contracts'
import { createHash } from 'node:crypto'

function validPosterOptions(row: PosterOptions & { title: string }): boolean {
	return (
		(row.posterTemplate === undefined ||
			['orbit', 'quote', 'note'].includes(row.posterTemplate)) &&
		(row.posterAspect === undefined ||
			['portrait', 'square', 'landscape'].includes(row.posterAspect)) &&
		(row.posterHighlight === undefined ||
			(typeof row.posterHighlight === 'string' &&
				row.posterHighlight.length <= 40 &&
				typeof row.title === 'string' &&
				row.title.includes(row.posterHighlight)))
	)
}
function posterDefaults(row: PosterOptions): Required<PosterOptions> {
	return {
		posterTemplate: row.posterTemplate ?? 'orbit',
		posterAspect: row.posterAspect ?? 'portrait',
		posterHighlight: row.posterHighlight ?? '',
	}
}
/** Tool-only import: not mounted as a product HTTP route. */
export async function importSnapshot(snapshot: Snapshot, reset = false) {
	if (
		!snapshot.users.length ||
		!snapshot.version ||
		snapshot.source !== 'Synthetic'
	)
		throw new Error('INVALID_IMPORT')
	if (
		[...snapshot.activities, ...snapshot.posts].some(
			(row) => !validPosterOptions(row),
		)
	)
		throw new Error('INVALID_POSTER_OPTIONS')
	const users = new Set(snapshot.users.map((u) => u.id)),
		activities = new Set(snapshot.activities.map((a) => a.id)),
		posts = new Set(snapshot.posts.map((p) => p.id))
	if (
		snapshot.activities.some((a) => !users.has(a.organizerId)) ||
		snapshot.posts.some(
			(p) =>
				!users.has(p.authorId) ||
				(p.activityId && !activities.has(p.activityId)),
		) ||
		snapshot.comments.some(
			(c) => !users.has(c.authorId) || !posts.has(c.postId),
		)
	)
		throw new Error('INVALID_IMPORT_REFERENCES')
	return db.$transaction(
		async (tx) => {
			const exists = await tx.user.count()
			if (exists && !reset) throw new Error('DATABASE_NOT_EMPTY')
			if (reset) {
				const real = await Promise.all([
					tx.user.count({ where: { source: 'Real' } }),
					tx.post.count({ where: { source: 'Real' } }),
					tx.activity.count({ where: { source: 'Real' } }),
				])
				if (real.some(Boolean)) throw new Error('RESET_REAL_DATA_NOT_ALLOWED')
				await tx.authSession.deleteMany()
				await tx.behavior.deleteMany()
				await tx.viewSession.deleteMany()
				await tx.state.deleteMany()
				await tx.follow.deleteMany()
				await tx.friendship.deleteMany()
				await tx.comment.deleteMany({ where: { parentId: { not: null } } })
				await tx.comment.deleteMany()
				await tx.post.deleteMany()
				await tx.activity.deleteMany()
				await tx.user.deleteMany()
				await tx.demoMeta.deleteMany()
			}
			await tx.user.createMany({
				data: snapshot.users.map((u) => ({
					...u,
					interests: JSON.stringify(u.interests),
				})),
			})
			await tx.activity.createMany({
				data: snapshot.activities.map((a) => ({
					...a,
					...posterDefaults(a),
					tags: JSON.stringify(a.tags),
				})),
			})
			await tx.post.createMany({
				data: snapshot.posts.map((p) => ({
					...p,
					...posterDefaults(p),
					tags: JSON.stringify(p.tags),
					mediaIds: JSON.stringify(p.mediaIds ?? []),
					purpose: p.purpose ?? 'DISCUSSION',
				})),
			})
			await tx.comment.createMany({
				data: snapshot.comments
					.filter((c) => !c.parentId)
					.map((c) => ({ ...c, mediaIds: JSON.stringify(c.mediaIds ?? []) })),
			})
			await tx.comment.createMany({
				data: snapshot.comments
					.filter((c) => c.parentId)
					.map((c) => ({ ...c, mediaIds: JSON.stringify(c.mediaIds ?? []) })),
			})
			await tx.friendship.createMany({ data: snapshot.friendships })
			await tx.follow.createMany({ data: snapshot.follows })
			await tx.state.createMany({ data: snapshot.states })
			await tx.behavior.createMany({ data: snapshot.behaviors })
			await tx.viewSession.createMany({ data: snapshot.sessions })
			await tx.demoMeta.create({
				data: {
					id: 'demo',
					version: snapshot.version,
					source: snapshot.source,
					seed: snapshot.seed,
					now: snapshot.now,
				},
			})
		},
		{ timeout: 60000 },
	)
}
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical)
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, canonical(v)]),
		)
	return value
}
function assertImport(condition: unknown, code: string): asserts condition {
	if (!condition) throw new Error(code)
}
const validId = (value: unknown): value is string =>
	typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(value)
const validDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value
const validText = (value: unknown, max: number, min = 1): value is string =>
	typeof value === 'string' && value.trim().length >= min && value.length <= max
const validTags = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length <= 8 &&
	value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 24)
/** Append-only producer boundary. No HTTP endpoint mounts this function. */
export async function importContentBatch(
	batch: ContentImportBatch,
	options: ContentImportOptions = {},
) {
	assertImport(
		batch && validId(batch.id) && validText(batch.version, 100),
		'INVALID_BATCH',
	)
	const snapshot = batch.snapshot
	assertImport(
		snapshot &&
			(snapshot.source === 'Synthetic' || snapshot.source === 'Generated'),
		'INVALID_BATCH_SOURCE',
	)
	const groups = [
		snapshot.users,
		snapshot.activities,
		snapshot.posts,
		snapshot.comments,
		snapshot.friendships,
		snapshot.follows,
		snapshot.states,
		snapshot.behaviors,
		snapshot.sessions,
		batch.media,
	]
	assertImport(
		groups.every(
			(g, index) =>
				Array.isArray(g) && g.length <= (index === 7 ? 100000 : 20000),
		),
		'INVALID_BATCH_ARRAYS',
	)
	for (const group of groups) {
		assertImport(
			group.every((item) => item && validId(item.id)),
			'INVALID_BATCH_ID',
		)
		assertImport(
			new Set(group.map((item) => item.id)).size === group.length,
			'DUPLICATE_BATCH_ID',
		)
	}
	for (const media of batch.media) {
		assertImport(
			/^\/media\/[a-zA-Z0-9_-]+\.webp$/.test(media.url),
			'INVALID_MEDIA_PATH',
		)
		const info = await stat(
			resolve(
				process.env.CAMPUS_MEDIA_DIR ?? resolve(dataDirectory, 'media'),
				media.url.slice('/media/'.length),
			),
		).catch(() => null)
		assertImport(
			info?.isFile() && info.size > 0 && info.size <= 8 * 1024 * 1024,
			'MEDIA_FILE_MISSING_OR_OVERSIZED',
		)
	}
	const digest = createHash('sha256')
		.update(JSON.stringify(canonical(batch)))
		.digest('hex')
	const result = await db.$transaction(
		async (tx) => {
			const receipt = await tx.contentImportReceipt.findUnique({
				where: { id: batch.id },
			})
			if (receipt) {
				assertImport(receipt.digest === digest, 'BATCH_ID_CONFLICT')
				return {
					id: receipt.id,
					version: receipt.version,
					createdAt: receipt.createdAt,
					counts: JSON.parse(receipt.counts) as ContentPublishedEvent['counts'],
					alreadyImported: true,
				}
			}
			const [
				oldUsers,
				oldActivities,
				oldPosts,
				oldComments,
				oldMedia,
				oldFriends,
				oldFollows,
				oldStates,
				oldBehaviors,
				oldSessions,
			] = await Promise.all([
				tx.user.findMany({ select: { id: true, role: true } }),
				tx.activity.findMany({ select: { id: true } }),
				tx.post.findMany({ select: { id: true } }),
				tx.comment.findMany({
					select: { id: true, postId: true, parentId: true },
				}),
				tx.mediaAsset.findMany({ select: { id: true } }),
				tx.friendship.findMany({ select: { id: true } }),
				tx.follow.findMany({ select: { id: true } }),
				tx.state.findMany({ select: { id: true } }),
				tx.behavior.findMany({ select: { id: true } }),
				tx.viewSession.findMany({ select: { id: true } }),
			])
			const existing = [
				oldUsers,
				oldActivities,
				oldPosts,
				oldComments,
				oldFriends,
				oldFollows,
				oldStates,
				oldBehaviors,
				oldSessions,
				oldMedia,
			]
			groups.forEach((group, i) => {
				const old = new Set(existing[i]!.map((v) => v.id))
				assertImport(
					group.every((v) => !old.has(v.id)),
					'EXISTING_CONTENT_CONFLICT',
				)
			})
			const users = new Set([...oldUsers, ...snapshot.users].map((v) => v.id)),
				activities = new Set(
					[...oldActivities, ...snapshot.activities].map((v) => v.id),
				),
				posts = new Set([...oldPosts, ...snapshot.posts].map((v) => v.id)),
				media = new Set([...oldMedia, ...batch.media].map((v) => v.id))
			for (const u of snapshot.users) {
				assertImport(
					validText(u.name, 40) &&
						validText(u.bio, 2000, 0) &&
						validText(u.campus, 30) &&
						['STUDENT', 'ORGANIZER'].includes(u.role) &&
						validDate(u.createdAt) &&
						['Synthetic', 'Generated'].includes(u.source),
					'INVALID_USER',
				)
				assertImport(
					u.interests &&
						typeof u.interests === 'object' &&
						!Array.isArray(u.interests) &&
						Object.entries(u.interests).length <= 30 &&
						Object.entries(u.interests).every(
							([k, v]) =>
								validText(k, 24) &&
								typeof v === 'number' &&
								Number.isFinite(v) &&
								v >= 0 &&
								v <= 1,
						),
					'INVALID_INTERESTS',
				)
			}
			const roles = new Map(
				[...oldUsers, ...snapshot.users].map((u) => [u.id, u.role]),
			)
			for (const a of snapshot.activities) {
				assertImport(
					users.has(a.organizerId) &&
						validPosterOptions(a) &&
						['ORGANIZER', 'ADMIN'].includes(roles.get(a.organizerId) ?? '') &&
						validText(a.title, 120) &&
						validText(a.body, 10000) &&
						validTags(a.tags) &&
						validText(a.campus, 30) &&
						validText(a.location, 100) &&
						['PUBLISHED', 'CANCELLED'].includes(a.status) &&
						['Synthetic', 'Generated'].includes(a.source) &&
						validDate(a.createdAt) &&
						[a.startsAt, a.endsAt, a.deadline].every(validDate) &&
						a.deadline <= a.startsAt &&
						a.startsAt < a.endsAt &&
						Number.isInteger(a.capacity) &&
						a.capacity > 0 &&
						a.capacity <= 10000 &&
						(!a.coverId || media.has(a.coverId)),
					'INVALID_ACTIVITY',
				)
			}
			for (const p of snapshot.posts) {
				assertImport(
					users.has(p.authorId) &&
						validPosterOptions(p) &&
						(!p.activityId || activities.has(p.activityId)) &&
						validText(p.title, 120) &&
						validText(p.body, 20000) &&
						validTags(p.tags) &&
						['TEXT', 'ARTICLE'].includes(p.kind) &&
						(!p.purpose ||
							['RECRUITMENT', 'REVIEW', 'GUIDE', 'DISCUSSION'].includes(
								p.purpose,
							)) &&
						(!p.mediaIds ||
							(p.mediaIds.length <= 9 &&
								p.mediaIds.every((id) => media.has(id)))) &&
						validDate(p.createdAt) &&
						['Synthetic', 'Generated'].includes(p.source),
					'INVALID_POST',
				)
			}
			const comments = new Map(
				[...oldComments, ...snapshot.comments].map((c) => [c.id, c]),
			)
			for (const c of snapshot.comments) {
				const parent = c.parentId ? comments.get(c.parentId) : null
				assertImport(
					users.has(c.authorId) &&
						posts.has(c.postId) &&
						validText(c.body, 2000) &&
						validDate(c.createdAt) &&
						['Synthetic', 'Generated'].includes(c.source) &&
						(!c.parentId ||
							(parent &&
								parent.id !== c.id &&
								parent.postId === c.postId &&
								!parent.parentId)),
					'INVALID_COMMENT',
				)
			}
			for (const m of batch.media)
				assertImport(
					/^\/media\/[a-zA-Z0-9_-]+\.webp$/.test(m.url) &&
						m.mime === 'image/webp' &&
						Number.isInteger(m.width) &&
						m.width > 0 &&
						m.width <= 10000 &&
						Number.isInteger(m.height) &&
						m.height > 0 &&
						m.height <= 10000 &&
						validText(m.alt, 160, 0) &&
						validText(m.origin, 40) &&
						(!m.sourceUrl ||
							(m.sourceUrl.length <= 2000 &&
								/^https?:\/\//.test(m.sourceUrl))) &&
						(!m.attribution || validText(m.attribution, 300)),
					'INVALID_MEDIA',
				)
			for (const f of snapshot.friendships)
				assertImport(
					users.has(f.requesterId) &&
						users.has(f.recipientId) &&
						f.requesterId !== f.recipientId &&
						['PENDING', 'ACCEPTED'].includes(f.status) &&
						validDate(f.createdAt),
					'INVALID_FRIENDSHIP',
				)
			for (const f of snapshot.follows)
				assertImport(
					users.has(f.followerId) &&
						users.has(f.followingId) &&
						f.followerId !== f.followingId &&
						validDate(f.createdAt),
					'INVALID_FOLLOW',
				)
			const target = (item: {
				userId: string
				postId: string | null
				activityId: string | null
			}) =>
				users.has(item.userId) &&
				!!item.postId !== !!item.activityId &&
				(!item.postId || posts.has(item.postId)) &&
				(!item.activityId || activities.has(item.activityId))
			for (const s of snapshot.states)
				assertImport(
					target(s) &&
						['LIKE', 'FAVORITE', 'REGISTER'].includes(s.kind) &&
						!(s.kind === 'REGISTER' && !s.activityId) &&
						!(s.kind === 'LIKE' && !s.postId) &&
						validDate(s.createdAt),
					'INVALID_STATE',
				)
			for (const b of snapshot.behaviors)
				assertImport(
					target(b) &&
						[
							'VIEW',
							'LIKE',
							'UNLIKE',
							'FAVORITE',
							'UNFAVORITE',
							'REGISTER',
							'UNREGISTER',
							'COMMENT',
						].includes(b.kind) &&
						Number.isFinite(b.effectiveMs) &&
						b.effectiveMs >= 0 &&
						b.effectiveMs <= 300000 &&
						validDate(b.createdAt),
					'INVALID_BEHAVIOR',
				)
			for (const s of snapshot.sessions)
				assertImport(
					target(s) &&
						validDate(s.startedAt) &&
						validDate(s.updatedAt) &&
						s.startedAt <= s.updatedAt &&
						Number.isFinite(s.effectiveMs) &&
						s.effectiveMs >= 0 &&
						s.effectiveMs <= 300000 &&
						typeof s.closed === 'boolean',
					'INVALID_VIEW_SESSION',
				)
			await tx.user.createMany({
				data: snapshot.users.map((u) => ({
					id: u.id,
					name: u.name,
					bio: u.bio,
					campus: u.campus,
					role: u.role,
					interests: JSON.stringify(u.interests),
					createdAt: u.createdAt,
					source: u.source,
				})),
			})
			await tx.mediaAsset.createMany({
				data: batch.media.map((m) => ({
					id: m.id,
					url: m.url,
					mime: m.mime,
					width: m.width,
					height: m.height,
					alt: m.alt,
					origin: m.origin,
					sourceUrl: m.sourceUrl,
					attribution: m.attribution,
					createdAt: new Date().toISOString(),
				})),
			})
			await tx.activity.createMany({
				data: snapshot.activities.map((a) => ({
					...a,
					...posterDefaults(a),
					tags: JSON.stringify(a.tags),
				})),
			})
			await tx.post.createMany({
				data: snapshot.posts.map((p) => ({
					...p,
					...posterDefaults(p),
					tags: JSON.stringify(p.tags),
					mediaIds: JSON.stringify(p.mediaIds ?? []),
					purpose: p.purpose ?? 'DISCUSSION',
				})),
			})
			await tx.comment.createMany({
				data: snapshot.comments
					.filter((c) => !c.parentId)
					.map((c) => ({ ...c, mediaIds: JSON.stringify(c.mediaIds ?? []) })),
			})
			await tx.comment.createMany({
				data: snapshot.comments
					.filter((c) => c.parentId)
					.map((c) => ({ ...c, mediaIds: JSON.stringify(c.mediaIds ?? []) })),
			})
			await tx.friendship.createMany({ data: snapshot.friendships })
			await tx.follow.createMany({ data: snapshot.follows })
			await tx.state.createMany({ data: snapshot.states })
			await tx.behavior.createMany({ data: snapshot.behaviors })
			await tx.viewSession.createMany({ data: snapshot.sessions })
			const counts = {
					users: snapshot.users.length,
					activities: snapshot.activities.length,
					posts: snapshot.posts.length,
					comments: snapshot.comments.length,
					media: batch.media.length,
				},
				createdAt = new Date().toISOString()
			await tx.contentImportReceipt.create({
				data: {
					id: batch.id,
					version: batch.version,
					digest,
					createdAt,
					counts: JSON.stringify(counts),
				},
			})
			return {
				id: batch.id,
				version: batch.version,
				createdAt,
				counts,
				alreadyImported: false,
			}
		},
		{ timeout: 60000 },
	)
	if (!result.alreadyImported && options.onPublished) {
		try {
			await options.onPublished({
				batchId: result.id,
				version: result.version,
				committedAt: result.createdAt,
				counts: result.counts,
			})
		} catch (error) {
			return {
				...result,
				hookError:
					error instanceof Error ? error.message : 'PUBLISH_HOOK_FAILED',
			}
		}
	}
	return result
}
