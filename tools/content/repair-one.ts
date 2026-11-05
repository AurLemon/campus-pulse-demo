import { join } from 'node:path'
import {
	ensureContentCache,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'
import { readFile } from 'node:fs/promises'
import { runWritingBatch, readLedger } from './budget.ts'
import { parseJson } from './model-content.ts'
import type { WrittenPost } from './model-content.ts'
if (process.argv.includes('--dry-run')) {
	console.log(
		JSON.stringify({
			mode: 'dry-run',
			action: 'repair-one',
			post: 'p20',
			cacheOpened: false,
		}),
	)
	process.exit(0)
}
const contentCache = await ensureContentCache()
const ledger = await readLedger(),
	entry = ledger.entries.findLast((e) => e.id === 'full-posts-16-v1')!
const result = JSON.parse(
	await readFile(entry.job + '/result.json', 'utf8'),
) as { text: string }
const posts = parseJson<WrittenPost[]>(result.text),
	post = posts.find((p) => p.id === 'p20')!
const answer = parseJson<{ reply: string }>(
	await runWritingBatch(
		'full-posts-16-repair-p20-v1',
		`只输出JSON {"reply":"作者回复"}，为下面Synthetic帖补一条8-25汉字的作者回复，针对第一条评论具体问题，语气轻松具体，不用·和省略号。不改其他文字。${JSON.stringify({ title: post.title, body: post.body, comment: post.comments[0]!.body })}`,
	),
)
if (
	typeof answer.reply !== 'string' ||
	answer.reply.length < 2 ||
	answer.reply.length > 100
)
	throw new Error('REPAIR_INVALID')
post.comments[0]!.reply = answer.reply
if (
	posts.length !== 8 ||
	posts.reduce((n, p) => n + p.comments.length, 0) !== 18 ||
	posts.reduce(
		(n, p) => n + p.comments.filter((c) => c.reply !== null).length,
		0,
	) !== 6
)
	throw new Error('REPAIRED_BATCH_INVALID')
await writeContentCacheFile(
	join(contentCache, 'full-posts-16.json'),
	JSON.stringify(posts, null, '\t'),
)
const contentBundle = await packContentCache()
if (!contentBundle.cacheStateUpdated)
	throw new Error(
		'CONTENT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing the cache',
	)

console.log(
	JSON.stringify({ posts: 8, roots: 18, replies: 6, repaired: 'p20' }),
)
