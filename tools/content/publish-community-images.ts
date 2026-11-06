/** Reviewed Synthetic-only image/thread publication. Defaults to preflight, no model calls. */
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { Snapshot } from '@campus/contracts'
import { db, dataDirectory } from '../../packages/domain/prisma.ts'
import { loadSnapshot } from '../../packages/domain/snapshot.ts'
import { topics } from './catalog.ts'
import {
	validateWrittenThread,
	type WrittenThread,
} from './thread-validation.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
import {
	ensureAssetCache,
	writeAssetCacheFile,
	packAssetCache,
} from './asset-bundle.ts'
interface OriginalPost {
	id: string
	authorId: string
	[key: string]: unknown
}
interface OriginalComment {
	id: string
	authorId: string
	parentId: string | null
	[key: string]: unknown
}
interface Assignment {
	post: OriginalPost
	comments: OriginalComment[]
	factId: string
	digest: string
}
interface Fact {
	id: string
	file: string
	url: string
	sha256: string
	width: number
	height: number
	topics: string[]
	verifiedFacts: string[]
	review: { status: string }
	origin?: 'Generated' | 'Web'
	sourcePageUrl?: string
	directImageUrl?: string
	attribution?: string
	license?: string
	originalPath?: string
	originalSha256?: string
	[key: string]: unknown
}
interface Plan {
	version: number
	digest: string
	assignments: Assignment[]
	facts: Fact[]
}
interface Approval {
	scope?: 'production' | 'isolated-rehearsal'
	namespace: string
	status: 'approved'
	planDigest: string
	threadDigests: Record<string, string>
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
	if (value && typeof value === 'object')
		return (
			'{' +
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
				.join(',') +
			'}'
		)
	return JSON.stringify(value)
}
const digest = (value: unknown) =>
	createHash('sha256').update(canonical(value)).digest('hex')
const json = async <T>(path: string) =>
	JSON.parse(await readFile(path, 'utf8')) as T
const arg = (name: string) =>
	process.argv.find((v) => v.startsWith(name + '='))?.slice(name.length + 1)
const namespace = arg('--namespace'),
	planPath = arg('--plan'),
	approvalPath = arg('--approval')
const apply = process.argv.includes('--apply'),
	final = process.argv.includes('--final')
const expectedPictured = Number(arg('--expected-pictured') ?? 500)
if (
	!Number.isSafeInteger(expectedPictured) ||
	expectedPictured < 1 ||
	expectedPictured > 1000
)
	throw Error('EXPECTED_PICTURED_OUT_OF_RANGE')
if (!namespace || !/^[a-z0-9-]{1,90}$/.test(namespace) || !planPath)
	throw Error('NAMESPACE_AND_PLAN_REQUIRED')
const bundleOptions = arg('--bundle-root')
	? { rootDirectory: resolve(arg('--bundle-root')!) }
	: {}
const snapshotOptions = { ...bundleOptions, kind: 'snapshots' as const }
const cache = await ensureContentCache(bundleOptions),
	asset = await ensureAssetCache(bundleOptions),
	directory = join(cache, namespace)
const saveContent = (path: string, value: string | Buffer) =>
	writeContentCacheFile(path, value, bundleOptions)
const saveAsset = (path: string, value: string | Buffer) =>
	writeAssetCacheFile(path, value, bundleOptions)
function archivedAssetPath(file: string) {
	const legacyPrefix = 'tools/content/assets/'
	const name = file.startsWith(legacyPrefix)
		? file.slice(legacyPrefix.length)
		: file
	if (name !== basename(name) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name))
		throw Error('UNSAFE_ARCHIVED_ASSET_PATH')
	return join(asset, name)
}
function webProvenance(f: Fact) {
	if (f.origin !== undefined && f.origin !== 'Generated' && f.origin !== 'Web')
		throw Error('UNSUPPORTED_IMAGE_ORIGIN:' + f.id)
	if (f.origin !== 'Web') return undefined
	for (const value of [f.sourcePageUrl, f.directImageUrl]) {
		if (!value) throw Error('WEB_SOURCE_URL_REQUIRED:' + f.id)
		const url = new URL(value)
		if (
			!['https:', 'http:'].includes(url.protocol) ||
			url.username ||
			url.password
		)
			throw Error('UNSAFE_WEB_SOURCE_URL:' + f.id)
	}
	if (
		!f.attribution?.trim() ||
		!f.license?.trim() ||
		!f.originalPath ||
		!/^[a-f0-9]{64}$/.test(f.originalSha256 ?? '')
	)
		throw Error('WEB_PROVENANCE_INCOMPLETE:' + f.id)
	return {
		origin: 'Web' as const,
		sourcePageUrl: f.sourcePageUrl!,
		directImageUrl: f.directImageUrl!,
		attribution: f.attribution,
		license: f.license,
		originalSha256: f.originalSha256!,
	}
}
function assetProvenance(f: Fact) {
	const web = webProvenance(f)
	return web
		? { ...web, sourceUrl: web.sourcePageUrl }
		: {
				origin: 'Generated',
				sourceUrl: null,
				attribution: 'Generated content subject to provider terms',
				license: 'Generated image; use subject to provider terms',
			}
}
const plan = await json<Plan>(resolve(planPath))
const { digest: declaredPlanDigest, ...planBody } = plan
if (
	createHash('sha256').update(JSON.stringify(planBody)).digest('hex') !==
	declaredPlanDigest
)
	throw Error('PLAN_BODY_DIGEST_CHANGED')
if (
	plan.version !== 1 ||
	!plan.assignments.length ||
	plan.assignments.length !== plan.facts.length
)
	throw Error('INVALID_PUBLICATION_PLAN')
if (
	new Set(plan.assignments.map((a) => a.post.id)).size !==
		plan.assignments.length ||
	new Set(plan.facts.map((f) => f.id)).size !== plan.facts.length ||
	new Set(plan.facts.map((f) => f.sha256)).size !== plan.facts.length
)
	throw Error('DUPLICATE_POST_OR_IMAGE')
const written = new Map<string, WrittenThread>(),
	imageBytes = new Map<string, Buffer>()
const allowedTags = new Set(topics.map((t) => t.tag))
const publicTopics = (fact: Fact) =>
	fact.topics.filter((topic) => allowedTags.has(topic))
const internalImageTopics = new Set(['food', 'learning'])
for (const a of plan.assignments) {
	const raw = await json<unknown>(
		join(directory, 'thread-' + a.digest + '.json'),
	)
	written.set(a.post.id, validateWrittenThread(a, raw))
	if (!plan.facts.some((f) => f.id === a.factId))
		throw Error('MISSING_FACT:' + a.post.id)
}
for (const f of plan.facts) {
	if (f.review.status !== 'approved' || !f.verifiedFacts.length)
		throw Error('UNREVIEWED_FACT:' + f.id)
	if (!/^[a-zA-Z0-9-]+$/.test(f.id) || f.url !== `/media/${f.id}.webp`)
		throw Error('UNSAFE_MEDIA_ID_OR_URL')
	if (
		!publicTopics(f).length ||
		f.topics.some((t) => !allowedTags.has(t) && !internalImageTopics.has(t))
	)
		throw Error('UNREGISTERED_TOPIC:' + f.id)
	const provenance = webProvenance(f)
	if (
		provenance &&
		createHash('sha256')
			.update(await readFile(resolve(f.originalPath!)))
			.digest('hex') !== provenance.originalSha256
	)
		throw Error('WEB_ORIGINAL_BYTES_CHANGED:' + f.id)
	const bytes = await readFile(resolve(f.file)),
		meta = await sharp(bytes).metadata()
	if (
		createHash('sha256').update(bytes).digest('hex') !== f.sha256 ||
		meta.format !== 'webp' ||
		meta.width !== f.width ||
		meta.height !== f.height
	)
		throw Error('IMAGE_BYTES_OR_DIMENSIONS_CHANGED:' + f.id)
	imageBytes.set(f.id, bytes)
}
const approval = approvalPath
	? await json<Approval>(resolve(approvalPath))
	: undefined
if (
	apply &&
	(!approval ||
		approval.status !== 'approved' ||
		approval.namespace !== namespace ||
		approval.planDigest !== plan.digest ||
		plan.assignments.some(
			(a) =>
				approval.threadDigests[a.post.id] !== digest(written.get(a.post.id)),
		))
)
	throw Error('MATCHING_REVIEWED_DRAFT_APPROVAL_REQUIRED')
if (apply && approval?.scope === 'isolated-rehearsal') {
	const url = process.env.DATABASE_URL
	if (
		!arg('--bundle-root') ||
		!url?.startsWith('file:') ||
		(await realpath(url.slice(5))) ===
			(await realpath(resolve('.data/pulse.db')))
	)
		throw Error('REHEARSAL_MUST_USE_ISOLATED_DATABASE_AND_BUNDLES')
}
const payloadDigest = digest({
	planDigest: plan.digest,
	assignments: plan.assignments.map((a) => ({
		postId: a.post.id,
		source: digest({ post: a.post, comments: a.comments }),
		draft: digest(written.get(a.post.id)),
		factId: a.factId,
	})),
	facts: plan.facts.map((f) => ({
		id: f.id,
		sha256: f.sha256,
		topics: publicTopics(f),
		verifiedFacts: f.verifiedFacts,
		...(webProvenance(f) ? { provenance: webProvenance(f) } : {}),
	})),
})
const receiptId = 'community-images-v3:' + namespace
const preset = await json<Snapshot>(
	join(await ensureContentCache(snapshotOptions), 'natural-v3-media.json'),
)
if (
	preset.users.length !== 200 ||
	preset.posts.length !== 1000 ||
	preset.comments.length !== 3000 ||
	plan.assignments.some((a) => !preset.posts.some((p) => p.id === a.post.id))
)
	throw Error('ORIGINAL_COHORT_CHANGED')
const result = await db.$transaction(
	async (tx) => {
		const prior = await tx.contentImportReceipt.findUnique({
			where: { id: receiptId },
		})
		if (prior) {
			if (prior.digest !== payloadDigest)
				throw Error('RECEIPT_NAMESPACE_CONFLICT')
			for (const assignment of plan.assignments) {
				const current = await tx.post.findUnique({
					where: { id: assignment.post.id },
				})
				const draft = written.get(assignment.post.id)!
				const fact = plan.facts.find((item) => item.id === assignment.factId)!
				const expected = {
					...assignment.post,
					title: draft.title,
					body: draft.body,
					tags: JSON.stringify(publicTopics(fact)),
					mediaIds: JSON.stringify([fact.id]),
					posterHighlight: '',
				}
				if (canonical(current) !== canonical(expected))
					throw Error('RECEIPT_POST_DRIFT_NO_REAPPLY:' + assignment.post.id)
				for (const original of assignment.comments) {
					const comment = await tx.comment.findUnique({
						where: { id: original.id },
					})
					const body = draft.comments.find(
						(item) => item.id === original.id,
					)!.body
					if (canonical(comment) !== canonical({ ...original, body }))
						throw Error('RECEIPT_COMMENT_DRIFT_NO_REAPPLY:' + original.id)
				}
			}
			return {
				alreadyApplied: true,
				...(JSON.parse(prior.counts) as {
					posts: number
					comments: number
					media: number
				}),
			}
		}
		for (const a of plan.assignments) {
			const post = await tx.post.findUnique({ where: { id: a.post.id } }),
				comments = await tx.comment.findMany({
					where: { postId: a.post.id },
					orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
				})
			const ids = [
				...new Set([a.post.authorId, ...a.comments.map((c) => c.authorId)]),
			]
			const actors = await tx.user.findMany({
				where: { id: { in: ids } },
				select: { id: true, source: true },
			})
			if (
				!post ||
				post.source !== 'Synthetic' ||
				post.activityId ||
				post.kind !== 'TEXT' ||
				JSON.parse(post.mediaIds).length ||
				comments.some(
					(c) =>
						c.source !== 'Synthetic' ||
						c.deletedAt ||
						JSON.parse(c.mediaIds).length,
				) ||
				actors.length !== ids.length ||
				actors.some((u) => u.source !== 'Synthetic')
			)
				throw Error('PROTECTED_OR_CHANGED_THREAD:' + a.post.id)
			if (
				canonical({ post, comments }) !==
				canonical({ post: a.post, comments: a.comments })
			)
				throw Error('THREAD_CHANGED_ABORT:' + a.post.id)
			const linked = await tx.post.findMany({
				where: { mediaIds: { contains: a.factId } },
				select: { id: true, mediaIds: true },
			})
			if (
				linked.some((p) =>
					(JSON.parse(p.mediaIds) as string[]).includes(a.factId),
				)
			)
				throw Error('IMAGE_ALREADY_BOUND:' + a.factId)
		}
		const manifest = await json<
			Array<{ id: string; sha256?: string; file: string }>
		>(join(asset, 'manifest.json'))
		const bound = await tx.post.findMany({
			where: { mediaIds: { not: '[]' } },
			select: { mediaIds: true },
		})
		const liveIds = [
			...new Set(
				bound.flatMap((post) => JSON.parse(post.mediaIds) as string[]),
			),
		]
		const liveMedia = await tx.mediaAsset.findMany({
			where: { id: { in: liveIds } },
			select: { id: true, url: true },
		})
		if (liveMedia.length !== liveIds.length)
			throw Error('BOUND_MEDIA_METADATA_MISSING')
		const liveHashes = new Set<string>()
		for (const media of liveMedia) {
			if (!/^\/media\/[a-zA-Z0-9_.-]+$/.test(media.url))
				throw Error('BOUND_MEDIA_PATH_UNVERIFIABLE:' + media.id)
			const path = join(
				resolve(process.env.CAMPUS_MEDIA_DIR ?? join(dataDirectory, 'media')),
				media.url.slice('/media/'.length),
			)
			liveHashes.add(
				createHash('sha256')
					.update(await readFile(path))
					.digest('hex'),
			)
		}
		for (const fact of plan.facts)
			if (liveHashes.has(fact.sha256))
				throw Error('LIVE_POST_IMAGE_SHA_REUSE:' + fact.id)
		for (const f of plan.facts) {
			for (const m of manifest) {
				if (m.id === f.id) continue
				if (m.sha256 === f.sha256) throw Error('IMAGE_SHA_REUSE:' + f.id)
			}
			const existing = await tx.mediaAsset.findUnique({ where: { id: f.id } })
			if (
				existing &&
				(existing.url !== f.url ||
					existing.origin !== 'Generated' ||
					existing.ownerId)
			)
				throw Error('MEDIA_ID_CONFLICT:' + f.id)
		}
		const counts = {
			posts: plan.assignments.length,
			comments: plan.assignments.reduce((n, a) => n + a.comments.length, 0),
			media: plan.facts.length,
		}
		if (!apply) return { alreadyApplied: false, ...counts }
		const mediaDirectory = resolve(
			process.env.CAMPUS_MEDIA_DIR ?? join(dataDirectory, 'media'),
		)
		await mkdir(mediaDirectory, { recursive: true })
		for (const f of plan.facts) {
			const target = join(mediaDirectory, f.id + '.webp')
			try {
				const old = await readFile(target)
				if (createHash('sha256').update(old).digest('hex') !== f.sha256)
					throw Error('PERSISTENT_MEDIA_CONFLICT:' + f.id)
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
				await writeFile(target, imageBytes.get(f.id)!, { flag: 'wx' })
			}
			await tx.mediaAsset.upsert({
				where: { id: f.id },
				create: {
					id: f.id,
					url: f.url,
					mime: 'image/webp',
					width: f.width,
					height: f.height,
					alt: f.verifiedFacts.join('，'),
					origin: assetProvenance(f).origin,
					ownerId: null,
					sourceUrl: assetProvenance(f).sourceUrl,
					attribution: assetProvenance(f).attribution,
					createdAt: new Date().toISOString(),
				},
				update: { alt: f.verifiedFacts.join('，') },
			})
		}
		for (const a of plan.assignments) {
			const draft = written.get(a.post.id)!,
				fact = plan.facts.find((f) => f.id === a.factId)!
			await tx.post.update({
				where: { id: a.post.id },
				data: {
					title: draft.title,
					body: draft.body,
					tags: JSON.stringify(publicTopics(fact)),
					mediaIds: JSON.stringify([a.factId]),
					posterHighlight: '',
				},
			})
			for (const c of draft.comments)
				await tx.comment.update({ where: { id: c.id }, data: { body: c.body } })
		}
		await tx.contentImportReceipt.create({
			data: {
				id: receiptId,
				version: 'community-images-v3',
				digest: payloadDigest,
				createdAt: new Date().toISOString(),
				counts: JSON.stringify(counts),
			},
		})
		return { alreadyApplied: false, ...counts }
	},
	{ timeout: 60000 },
)
if (!apply) {
	console.log(
		JSON.stringify({
			phase: 'preflight',
			namespace,
			...result,
			payloadDigest,
			databaseWritten: false,
		}),
	)
	await db.$disconnect()
	process.exit(0)
}
// The database receipt above is durable. Archive errors below do not undo that commit.
await saveContent(
	join(directory, 'publish-receipt.json'),
	JSON.stringify(
		{
			receiptId,
			payloadDigest,
			...result,
			databaseCommitted: true,
			archivesPublished: false,
		},
		null,
		2,
	) + '\n',
)
const manifest = await json<Array<Record<string, unknown>>>(
	join(asset, 'manifest.json'),
)
const avatars = manifest
	.filter((m) => String(m.id).startsWith('anime-avatar-'))
	.map((m) => m.id)
if (avatars.length !== 200) throw Error('AVATAR_MANIFEST_CHANGED_AFTER_COMMIT')
for (const f of plan.facts) {
	await saveAsset(join(asset, f.id + '.webp'), imageBytes.get(f.id)!)
	const entry = {
		id: f.id,
		file: f.id + '.webp',
		url: f.url,
		mime: 'image/webp',
		width: f.width,
		height: f.height,
		sha256: f.sha256,
		alt: f.verifiedFacts.join('，'),
		...assetProvenance(f),
		tags: publicTopics(f),
	}
	const index = manifest.findIndex((m) => m.id === f.id)
	if (index < 0) manifest.push(entry)
	else {
		if (manifest[index]?.file !== entry.file)
			throw Error('ASSET_MANIFEST_CONFLICT_AFTER_COMMIT')
		manifest[index] = { ...manifest[index], ...entry }
	}
	await saveAsset(
		join(asset, 'community-images-v3', 'facts', f.id + '.json'),
		JSON.stringify({ ...f, file: f.id + '.webp' }, null, 2) + '\n',
	)
}
if (avatars.some((id) => !manifest.some((m) => m.id === id)))
	throw Error('AVATAR_REMOVAL_BLOCKED')
await saveAsset(
	join(asset, 'manifest.json'),
	JSON.stringify(manifest, null, 2) + '\n',
)
const packedAssets = await packAssetCache(bundleOptions)
if (!packedAssets.cacheStateUpdated)
	throw Error('ASSET_ARCHIVE_STATE_PENDING_AFTER_COMMIT')
const live = await loadSnapshot(undefined, { crossDomain: false })
function refresh<T extends { id: string; source: string }>(
	original: T[],
	current: T[],
	label: string,
): T[] {
	const index = new Map(current.map((v) => [v.id, v]))
	return original.map((v) => {
		const row = index.get(v.id)
		if (!row || row.source !== 'Synthetic')
			throw Error('COHORT_SOURCE_DRIFT_AFTER_COMMIT:' + label + ':' + v.id)
		return row
	})
}
preset.users = refresh(preset.users, live.users, 'user')
preset.posts = refresh(preset.posts, live.posts, 'post')
preset.comments = refresh(preset.comments, live.comments, 'comment')
preset.activities = refresh(preset.activities, live.activities, 'activity')
preset.version = 'campus-natural-v3-media'
const pictured = preset.posts.filter((p) => p.mediaIds?.length)
const allPostMedia = pictured.flatMap((p) => p.mediaIds ?? [])
const mediaIndex = new Map(manifest.map((m) => [String(m.id), m]))
const allHashes = []
for (const id of allPostMedia) {
	const m = mediaIndex.get(id)
	if (!m || typeof m.file !== 'string')
		throw Error('COHORT_MEDIA_NOT_ARCHIVED_AFTER_COMMIT:' + id)
	allHashes.push(
		createHash('sha256')
			.update(await readFile(archivedAssetPath(m.file)))
			.digest('hex'),
	)
}
if (
	new Set(allPostMedia).size !== allPostMedia.length ||
	new Set(allHashes).size !== allHashes.length
)
	throw Error('POST_IMAGE_REUSE_AFTER_COMMIT')
if (final && pictured.length !== expectedPictured)
	throw Error(
		'FINAL_EXPECTED_PICTURED_POSTS_REQUIRED_AFTER_COMMIT:' + expectedPictured,
	)
await writeContentCacheFile(
	join(await ensureContentCache(snapshotOptions), 'natural-v3-media.json'),
	JSON.stringify(preset, null, 2) + '\n',
	snapshotOptions,
)
const snapshotResult = await packContentCache(snapshotOptions)
if (!snapshotResult.cacheStateUpdated)
	throw Error('SNAPSHOT_ARCHIVE_STATE_PENDING_AFTER_COMMIT')
await saveContent(
	join(directory, 'publish-receipt.json'),
	JSON.stringify(
		{
			receiptId,
			payloadDigest,
			...result,
			databaseCommitted: true,
			archivesPublished: true,
			picturedPosts: pictured.length,
			uniquePostImageHashes: new Set(allHashes).size,
			avatarsPreserved: avatars.length,
			presetCounts: {
				users: preset.users.length,
				posts: preset.posts.length,
				comments: preset.comments.length,
			},
		},
		null,
		2,
	) + '\n',
)
const packedContent = await packContentCache(bundleOptions)
if (!packedContent.cacheStateUpdated)
	throw Error('CONTENT_ARCHIVE_STATE_PENDING_AFTER_COMMIT')
console.log(
	JSON.stringify({
		phase: 'published',
		namespace,
		receiptId,
		...result,
		picturedPosts: pictured.length,
		uniqueHashes: new Set(allHashes).size,
	}),
)
await db.$disconnect()
