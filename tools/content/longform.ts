import {
	ensureSnapshotCache,
	resolveSnapshotFile,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { join } from 'node:path'
import {
	ensureContentCache,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'
import { validateSnapshot } from './validate.ts'
import { readFile, readdir } from 'node:fs/promises'
import { runWritingBatch } from './budget.ts'
import { parseWritingJson } from './model-content.ts'
import type { WrittenPost } from './model-content.ts'
import type { Snapshot } from '@campus/contracts'
const size = process.argv.includes('--full') ? 'full' : 'small'
// Use ordinary posts so an experience expansion cannot turn a future notice into a retrospective.
const ids = size === 'full' ? [122, 363, 596, 846, 1088] : [1]
if (process.argv.includes('--dry-run') || !process.argv.includes('--run')) {
	console.log(
		JSON.stringify({ mode: 'dry-run', size, ids: ids.map((id) => `p${id}`) }),
	)
	process.exit(0)
}
const contentCache = await ensureContentCache()
await ensureSnapshotCache()
for (const number of ids) {
	const files = (await readdir(contentCache)).filter(
		(file) => file.startsWith(`${size}-posts-`) && file.endsWith('.json'),
	)
	let path = '',
		posts: WrittenPost[] = [],
		post: WrittenPost | undefined
	for (const file of files) {
		const candidate = JSON.parse(
			await readFile(join(contentCache, file), 'utf8'),
		) as WrittenPost[]
		const found = candidate.find((item) => item.id === `p${number}`)
		if (found) {
			path = join(contentCache, file)
			posts = candidate
			post = found
			break
		}
	}
	if (!post) throw new Error(`POST_NOT_FOUND:p${number}`)
	const result = await parseWritingJson<{ id: string; body: string }>(
		`${size}-longform-p${number}-v1`,
		await runWritingBatch(
			`${size}-longform-p${number}-v1`,
			`只输出JSON{id,body}。将以下Synthetic校园社区帖扩成400-600汉字、多自然段的经验长文。保留id、题目、问题和已有讨论所指具体细节，不能改已有评论。口吻具体朴素，可写尝试步骤、失败与取舍，不要假称官方组织或编造个人电话，不要·和省略号。body用JSON换行分段。原帖：${JSON.stringify(post)}`,
		),
	)
	if (
		result.id !== post.id ||
		typeof result.body !== 'string' ||
		result.body.length < 300 ||
		!result.body.includes('\n')
	)
		throw new Error('LONGFORM_INVALID')
	post.body = result.body
	await writeContentCacheFile(path, JSON.stringify(posts, null, '\t'))
	try {
		const snapshotPath = await resolveSnapshotFile(`${size}.json`),
			s = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot,
			p = s.posts.find((p) => p.id === post.id)!
		p.body = post.body
		p.kind = 'ARTICLE'
		const errors = validateSnapshot(s)
		if (errors.length)
			throw new Error(`INVALID_SNAPSHOT:${JSON.stringify(errors.slice(0, 30))}`)
		await writeSnapshotFile(snapshotPath, JSON.stringify(s, null, '\t'))
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
	}
	console.log(JSON.stringify({ post: post.id, length: post.body.length }))
}

await publishSnapshots()
const contentBundle = await packContentCache()
if (!contentBundle.cacheStateUpdated)
	throw new Error(
		'CONTENT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing the cache',
	)
