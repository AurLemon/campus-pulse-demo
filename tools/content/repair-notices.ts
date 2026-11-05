import { join } from 'node:path'
import {
	ensureContentCache,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { runWritingBatch } from './budget.ts'
import { parseWritingJson } from './model-content.ts'
import type { WrittenActivity, WrittenPost } from './model-content.ts'

if (process.argv.includes('--dry-run') || !process.argv.includes('--run')) {
	console.log(
		JSON.stringify({
			mode: 'dry-run',
			action: 'repair-notices',
			cacheOpened: false,
		}),
	)
	process.exit(0)
}
const contentCache = await ensureContentCache()
const files = (await readdir(contentCache)).filter(
	(file) => file.startsWith('full-posts-') && file.endsWith('.json'),
)
const batches = await Promise.all(
	files.map(async (file) => ({
		file,
		posts: JSON.parse(
			await readFile(join(contentCache, file), 'utf8'),
		) as WrittenPost[],
	})),
)
const activities = (
	await Promise.all(
		Array.from({ length: 20 }, (_, index) =>
			readFile(
				join(contentCache, `full-activities-${index * 6}.json`),
				'utf8',
			).then((text) => JSON.parse(text) as WrittenActivity[]),
		),
	)
).flat()
// Explicit audit findings: fixed activity fields were described as undecided,
// or an organizer's official notice was written from a participant's identity.
const auditedIds = new Set(
	[
		1, 2, 4, 7, 8, 10, 11, 13, 14, 16, 19, 28, 29, 31, 32, 43, 44, 47, 49, 52,
		53, 55, 56, 67, 70, 81, 82, 86, 88,
	].map((number) => `p${number}`),
)
let selected = batches
	.flatMap((batch) => batch.posts.map((post) => ({ batch, post })))
	.filter(({ post }) => {
		const index = Number(post.id.slice(1)) - 1
		return (
			index < 120 &&
			(auditedIds.has(post.id) ||
				index % 3 === 2 ||
				/不写死|不承诺固定|不设具体|不写具体|具体.*再定|时间不写死/.test(
					post.body,
				))
		)
	})
	.sort((a, b) => Number(a.post.id.slice(1)) - Number(b.post.id.slice(1)))

const manifestPath = '.data/data-generation/notice-repair-plan-v1.json'
try {
	const ids = JSON.parse(await readFile(manifestPath, 'utf8')) as string[]
	const byId = new Map(
		batches.flatMap((batch) =>
			batch.posts.map((post) => [post.id, { batch, post }] as const),
		),
	)
	selected = ids.map((id) => {
		const item = byId.get(id)
		if (!item) throw new Error(`NOTICE_REPAIR_MISSING:${id}`)
		return item
	})
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	await writeFile(
		manifestPath,
		JSON.stringify(
			selected.map((item) => item.post.id),
			null,
			'\t',
		),
		{ mode: 0o600 },
	)
}
for (let offset = 0; offset < selected.length; offset += 8) {
	const group = selected.slice(offset, offset + 8)
	const id = `full-notice-repair-${group.map((item) => item.post.id).join('-')}-v1`
	const text = await runWritingBatch(
		id,
		`只输出严格JSON数组[{id,title,body}]。修订Synthetic校园活动的正式招募帖，以下每条都有活动介绍与现有评论。发帖身份为该场组织者，发帖时活动尚未举办，禁止把当前快照已结束的状态写成发帖时已经结束。正文应是招募、参加方式或准备说明，80-140字，不写活动已经结束/招募帖留着，不讲往次经历，不重复生成约束。不使用“时间不写死”“不写具体时间地点”“不承诺固定名额”“不虚构安排”等话术。活动时间地点和容量已确定，不能说未定、等人齐再商量、不设名额、以后再发招募，实际字段在关联活动详情查看，可自然提示“时间地点见关联活动”。不要以普通参加者身份问组织者强度或能不能中途离开，组织者可以直接说明参与方式。保留原人物朴素口吻，title不加编号，可用活动标题。现有评论不改，若评论问到细节，正文不擅自创造相反规则。不得出现真实组织背书或电话。只输出给出的id。${JSON.stringify(group.map(({ post }) => ({ id: post.id, title: post.title, body: post.body, comments: post.comments, activity: activities[Number(post.id.slice(1)) - 1] })))}`,
	)
	const patches = await parseWritingJson<
		Array<{ id: string; title: string; body: string }>
	>(id, text)
	if (
		!Array.isArray(patches) ||
		patches.length !== group.length ||
		patches.some(
			(patch, index) =>
				patch.id !== group[index]?.post.id ||
				typeof patch.title !== 'string' ||
				!patch.title ||
				typeof patch.body !== 'string' ||
				patch.body.length < 40 ||
				/活动已经结束|上次.*结束|不写死|不写具体|不承诺固定/.test(patch.body),
		)
	)
		throw new Error('NOTICE_REPAIR_INVALID')
	for (const { batch, post } of group) {
		const patch = patches.find((patch) => patch.id === post.id)!
		post.title = patch.title
		post.body = patch.body
		await writeContentCacheFile(
			join(contentCache, batch.file),
			JSON.stringify(batch.posts, null, '\t'),
		)
	}
	console.log(
		JSON.stringify({
			phase: 'notice-repair',
			done: Math.min(selected.length, offset + 8),
			total: selected.length,
		}),
	)
}

const contentBundle = await packContentCache()
if (!contentBundle.cacheStateUpdated)
	throw new Error(
		'CONTENT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing the cache',
	)
