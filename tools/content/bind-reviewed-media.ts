/** Offline reviewed-media binding. --drafts=/absolute/reviews.json plans, --apply commits a saved plan. No model calls. */
import { createHash } from 'node:crypto'
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { Snapshot } from '@campus/contracts'
import { db, dataDirectory } from '../../packages/domain/prisma.ts'
import { loadSnapshot } from '../../packages/domain/snapshot.ts'
import { validateAgentText } from '../../packages/domain/agent-access.ts'
import {
	ensureAssetCache,
	writeAssetCacheFile,
	packAssetCache,
} from './asset-bundle.ts'
import {
	ensureContentCache,
	writeContentCacheFile,
	packContentCache,
} from './bundle.ts'
import {
	resolveSnapshotFile,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { topics } from './catalog.ts'
interface Fact {
	id: string
	file: string
	url: string
	stagedPath: string
	sha256: string
	width: number
	height: number
	topics: string[]
	verifiedFacts: string[]
	review: { status: string; note?: string }
	kind: string
}
interface Draft {
	id: string
	facts: string[]
	title: string
	body: string
	tags: string[]
}
interface OriginalPost {
	id: string
	authorId: string
	activityId: string | null
	title: string
	body: string
	tags: string
	kind: string
	purpose: string
	mediaIds: string
	posterTemplate: string
	posterAspect: string
	posterHighlight: string
	createdAt: string
	source: string
}
interface Assignment {
	post: OriginalPost
	fact: Fact
	draft: Draft
}
interface Plan {
	version: string
	digest: string
	at: string
	assignments: Assignment[]
}
const digest = (value: unknown) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex')
const asset = await ensureAssetCache(),
	content = await ensureContentCache(),
	directory = join(content, 'pulse-extra-media-v1'),
	file = join(directory, 'plan.json')
const save = async (path: string, value: unknown) =>
	writeContentCacheFile(path, JSON.stringify(value, null, '\t') + '\n')
const tags = new Set(topics.map((t) => t.tag))
async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}
async function verifyFact(fact: Fact) {
	const bytes = await readFile(fact.stagedPath)
	const meta = await sharp(bytes).metadata()
	if (
		createHash('sha256').update(bytes).digest('hex') !== fact.sha256 ||
		meta.width !== fact.width ||
		meta.height !== fact.height ||
		meta.format !== 'webp'
	)
		throw Error(`MEDIA_CHANGED:${fact.id}`)
	return bytes
}
async function planDrafts(path: string) {
	const drafts = await readJson<Draft[]>(path),
		facts = await readJson<Fact[]>(join(asset, 'natural-image-facts.json'))
	if (drafts.length !== 16 || new Set(drafts.map((d) => d.id)).size !== 16)
		throw Error('EXPECT_16_UNIQUE_REVIEWED_IMAGES')
	const preset = await readJson<Snapshot>(
			await resolveSnapshotFile('natural-v3-media.json'),
		),
		cohort = new Set(preset.posts.map((p) => p.id))
	const posts = await db.post.findMany({
			where: {
				source: 'Synthetic',
				activityId: null,
				kind: 'TEXT',
				mediaIds: '[]',
				Comment_postId: { none: {} },
			},
			orderBy: { id: 'asc' },
		}),
		users = await db.user.findMany({ select: { id: true, interests: true } }),
		interests = new Map(
			users.map((u) => [
				u.id,
				JSON.parse(u.interests) as Record<string, number>,
			]),
		)
	const used = new Set<string>(),
		authors = new Set<string>(),
		assignments: Assignment[] = []
	for (const draft of drafts) {
		const fact = facts.find((f) => f.id === draft.id)
		if (
			!fact ||
			!/^natural-(?:29|3\d|4[0-4])-/.test(fact.id) ||
			!draft.facts.length ||
			draft.tags.length === 0 ||
			draft.tags.some((t) => !tags.has(t))
		)
			throw Error(`INVALID_REVIEW:${draft.id}`)
		validateAgentText(draft.title, 120)
		validateAgentText(draft.body, 20000)
		await verifyFact(fact)
		const candidates = posts.filter(
			(p) => cohort.has(p.id) && !used.has(p.id) && !authors.has(p.authorId),
		)
		candidates.sort((a, b) => {
			const score = (p: OriginalPost) =>
				draft.tags.reduce(
					(n, t) => n + (interests.get(p.authorId)?.[t] ?? 0),
					0,
				) +
				(JSON.parse(p.tags).some((t: string) => draft.tags.includes(t)) ? 1 : 0)
			return score(b) - score(a) || a.id.localeCompare(b.id)
		})
		const post = candidates[0]
		if (!post) throw Error('NO_UNTOUCHED_PRESET_POST')
		used.add(post.id)
		authors.add(post.authorId)
		assignments.push({
			post,
			fact: {
				...fact,
				verifiedFacts: draft.facts,
				review: {
					status: 'approved',
					note: '人工逐图查看，事实只含可见物体与状态，内部提示词和来源不进入帖子',
				},
			},
			draft,
		})
	}
	const plan: Plan = {
		version: 'campus-extra-natural-media-v1',
		digest: digest(assignments),
		at: new Date().toISOString(),
		assignments,
	}
	await save(file, plan)
	const packed = await packContentCache()
	if (!packed.cacheStateUpdated) throw Error('CONTENT_ARCHIVE_STATE_PENDING')
	console.log(
		JSON.stringify({
			phase: 'planned',
			digest: plan.digest,
			assignments: plan.assignments.map((a) => ({
				postId: a.post.id,
				imageId: a.fact.id,
				title: a.draft.title,
			})),
		}),
	)
}
async function apply() {
	const plan = await readJson<Plan>(file)
	if (digest(plan.assignments) !== plan.digest)
		throw Error('PLAN_DIGEST_CHANGED')
	const preset = await readJson<Snapshot>(
		await resolveSnapshotFile('natural-v3-media.json'),
	)
	if (
		preset.users.length !== 200 ||
		preset.posts.length !== 1000 ||
		preset.comments.length !== 3000 ||
		plan.assignments.some((a) => !preset.posts.some((p) => p.id === a.post.id))
	)
		throw Error('PRESET_COHORT_CHANGED')
	const facts = await readJson<Fact[]>(join(asset, 'natural-image-facts.json')),
		manifest = await readJson<Array<Record<string, unknown>>>(
			join(asset, 'manifest.json'),
		),
		avatarIds = manifest
			.filter((m) => String(m.id).startsWith('anime-avatar-'))
			.map((m) => m.id)
	for (const a of plan.assignments) {
		const current = facts.find((f) => f.id === a.fact.id)
		if (!current || current.sha256 !== a.fact.sha256)
			throw Error('FACT_CHECKPOINT_CHANGED')
		const bytes = await verifyFact(a.fact)
		await writeAssetCacheFile(join(asset, a.fact.file), bytes)
		Object.assign(current, a.fact)
		const entry = {
			id: a.fact.id,
			file: a.fact.file,
			url: a.fact.url,
			mime: 'image/webp',
			width: a.fact.width,
			height: a.fact.height,
			alt: a.fact.verifiedFacts.join('，'),
			origin: 'Generated',
			sourceUrl: null,
			attribution: 'Generated content subject to provider terms',
			license: 'Generated image; use subject to provider terms',
			tags: a.draft.tags,
		}
		const index = manifest.findIndex((m) => m.id === entry.id)
		if (index < 0) manifest.push(entry)
		else manifest[index] = entry
	}
	if (
		avatarIds.length !== 200 ||
		avatarIds.some((id) => !manifest.some((m) => m.id === id))
	)
		throw Error('AVATAR_MANIFEST_NOT_PRESERVED')
	await writeAssetCacheFile(
		join(asset, 'natural-image-facts.json'),
		JSON.stringify(facts, null, '\t') + '\n',
	)
	await writeAssetCacheFile(
		join(asset, 'manifest.json'),
		JSON.stringify(manifest, null, '\t') + '\n',
	)
	await writeAssetCacheFile(
		join(asset, 'natural-photos.json'),
		JSON.stringify(
			facts
				.filter((f) => f.kind === 'photo' && f.review.status === 'approved')
				.map((f) => ({
					id: f.id,
					file: f.file,
					url: f.url,
					width: f.width,
					height: f.height,
					topics: f.topics,
					facts: f.verifiedFacts,
				})),
			null,
			'\t',
		) + '\n',
	)
	const assetResult = await packAssetCache()
	if (!assetResult.cacheStateUpdated) throw Error('ASSET_ARCHIVE_STATE_PENDING')
	const media = resolve(
		process.env.CAMPUS_MEDIA_DIR ?? join(dataDirectory, 'media'),
	)
	await mkdir(media, { recursive: true })
	for (const a of plan.assignments) {
		const bytes = await verifyFact(a.fact)
		let existing: Buffer | undefined
		try {
			existing = await readFile(join(media, a.fact.file))
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
		}
		if (
			existing &&
			createHash('sha256').update(existing).digest('hex') !== a.fact.sha256
		)
			throw Error('PERSISTENT_MEDIA_CONFLICT')
		if (!existing)
			await copyFile(a.fact.stagedPath, join(media, a.fact.file), 1)
		if (!bytes.length) throw Error('EMPTY_MEDIA')
	}
	const receiptId = 'extra-natural-media:' + plan.digest
	const counts = await db.$transaction(
		async (tx) => {
			const prior = await tx.contentImportReceipt.findUnique({
				where: { id: receiptId },
			})
			if (prior)
				return JSON.parse(prior.counts) as { posts: number; media: number }
			for (const a of plan.assignments) {
				const post = await tx.post.findUnique({ where: { id: a.post.id } }),
					comments = await tx.comment.count({ where: { postId: a.post.id } })
				if (
					!post ||
					digest(post) !== digest(a.post) ||
					post.source !== 'Synthetic' ||
					post.activityId ||
					post.mediaIds !== '[]' ||
					comments !== 0
				)
					throw Error(`THREAD_CHANGED_ABORT:${a.post.id}`)
				const linked = await tx.post.count({
					where: { mediaIds: { contains: a.fact.id } },
				})
				if (linked) throw Error(`IMAGE_ALREADY_BOUND:${a.fact.id}`)
			}
			for (const a of plan.assignments) {
				const old = await tx.mediaAsset.findUnique({ where: { id: a.fact.id } })
				if (
					old &&
					(old.origin !== 'Generated' || old.ownerId || old.url !== a.fact.url)
				)
					throw Error('MEDIA_ID_CONFLICT')
				await tx.mediaAsset.upsert({
					where: { id: a.fact.id },
					create: {
						id: a.fact.id,
						url: a.fact.url,
						mime: 'image/webp',
						width: a.fact.width,
						height: a.fact.height,
						alt: a.fact.verifiedFacts.join('，'),
						origin: 'Generated',
						sourceUrl: null,
						ownerId: null,
						attribution: 'Generated content subject to provider terms',
						createdAt: plan.at,
					},
					update: { alt: a.fact.verifiedFacts.join('，') },
				})
				await tx.post.update({
					where: { id: a.post.id },
					data: {
						title: a.draft.title,
						body: a.draft.body,
						tags: JSON.stringify(a.draft.tags),
						mediaIds: JSON.stringify([a.fact.id]),
						posterHighlight: '',
					},
				})
			}
			const result = {
				posts: plan.assignments.length,
				media: plan.assignments.length,
			}
			await tx.contentImportReceipt.create({
				data: {
					id: receiptId,
					version: plan.version,
					digest: plan.digest,
					createdAt: new Date().toISOString(),
					counts: JSON.stringify(result),
				},
			})
			return result
		},
		{ timeout: 60000 },
	)
	// Durable commit above is retained if any subsequent archive operation needs recovery.
	const live = await loadSnapshot(undefined, { crossDomain: false }),
		updated = new Set(plan.assignments.map((a) => a.post.id))
	preset.posts = preset.posts.map((p) =>
		updated.has(p.id)
			? (live.posts.find(
					(current) => current.id === p.id && current.source === 'Synthetic',
				) ?? p)
			: p,
	)
	await writeSnapshotFile(
		'natural-v3-media.json',
		JSON.stringify(preset, null, '\t') + '\n',
	)
	await publishSnapshots()
	await save(join(directory, 'receipt.json'), {
		receiptId,
		at: new Date().toISOString(),
		counts,
		avatarAssetsPreserved: avatarIds.length,
		preset: {
			users: preset.users.length,
			posts: preset.posts.length,
			comments: preset.comments.length,
		},
		source: 'Synthetic',
		modelRequests: 0,
	})
	const contentResult = await packContentCache()
	if (!contentResult.cacheStateUpdated)
		throw Error('CONTENT_ARCHIVE_STATE_PENDING_AFTER_COMMIT')
	console.log(
		JSON.stringify({
			phase: 'applied',
			receiptId,
			counts,
			preset: {
				users: preset.users.length,
				posts: preset.posts.length,
				comments: preset.comments.length,
			},
			avatarAssetsPreserved: avatarIds.length,
		}),
	)
}
try {
	const path = process.argv
		.find((a) => a.startsWith('--drafts='))
		?.slice('--drafts='.length)
	if (path) await planDrafts(resolve(path))
	if (process.argv.includes('--apply')) await apply()
	if (!path && !process.argv.includes('--apply'))
		console.log(
			'Provide --drafts=/absolute/reviews.json or --apply. No model calls.',
		)
} finally {
	await db.$disconnect()
}
