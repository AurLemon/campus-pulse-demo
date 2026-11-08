import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MinHeap, selectTopK } from '../packages/recommendation/heap.ts'
import {
	cosineSimilarity,
	compareRecommendations,
} from '../packages/recommendation/index.ts'
import { resolveMentions } from '../packages/contracts/mentions.ts'
import { validPort } from '../scripts/dev-ports.ts'

const values = [9, -4, 0, 9, 2, 7, 1]
for (const k of [
	-1,
	0,
	0.5,
	1,
	3,
	3.9,
	20,
	Number.NaN,
	Number.POSITIVE_INFINITY,
]) {
	test(`Top-K 与全量排序对照 k=${k}`, () => {
		const limit = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0
		assert.deepEqual(
			selectTopK(values, k, (a, b) => a - b),
			[...values].sort((a, b) => b - a).slice(0, limit),
		)
	})
}
test('空输入返回空 Top-K', () =>
	assert.deepEqual(
		selectTopK([], 3, (a: number, b: number) => a - b),
		[],
	))
test('最小堆保持重复值且按升序弹出', () => {
	const heap = new MinHeap<number>((a, b) => a - b)
	for (const value of values) heap.push(value)
	const result: number[] = []
	while (heap.size) result.push(heap.pop()!)
	assert.deepEqual(
		result,
		[...values].sort((a, b) => a - b),
	)
	assert.equal(heap.pop(), undefined)
	assert.equal(heap.peek(), undefined)
})
test('堆数组快照不暴露内部可变状态', () => {
	const heap = new MinHeap<number>((a, b) => a - b)
	heap.push(2)
	heap.toArray().push(-100)
	assert.deepEqual(heap.toArray(), [2])
})
test('Top-K 追踪与普通路径得到相同结果', () => {
	const events: string[] = []
	const normal = selectTopK(values, 3, (a, b) => a - b)
	const traced = selectTopK(
		values,
		3,
		(a, b) => a - b,
		(action) => events.push(action),
	)
	assert.deepEqual(traced, normal)
	assert.ok(
		events.includes('retain') &&
			events.includes('replace') &&
			events.includes('skip'),
	)
})
test('堆变更与候选追踪提供有界独立快照', () => {
	const snapshots: number[][] = []
	let candidates = 0
	const result = selectTopK(
		values,
		3,
		(a, b) => a - b,
		undefined,
		(event) => snapshots.push(event.values),
		(_item, retained) => {
			candidates++
			assert.ok(retained.length <= 3)
		},
	)
	assert.equal(candidates, values.length)
	assert.deepEqual(result, [9, 9, 7])
	assert.deepEqual(snapshots[0], [9])
	assert.ok(snapshots.every((snapshot) => snapshot.length <= 3))
})
for (const [profile, tags, expected] of [
	[{}, ['音乐'], 0],
	[{ 音乐: 1 }, [], 0],
	[{ 音乐: 1 }, ['音乐', '音乐'], 1],
	[{ 音乐: 1 }, ['技术'], 0],
] as const) {
	test(`余弦相似度处理空画像和重复标签 ${JSON.stringify(tags)}`, () =>
		assert.equal(cosineSimilarity(profile, [...tags]), expected))
}
const users = [
	{ id: 'first', name: '林俊乐' },
	{ id: 'second', name: '潘崇宇' },
]
test('前端 mention 支持中文全角符号与 UTF-16 偏移', () => {
	const text = '📚 ＠林俊乐，和 @潘崇宇 一起看'
	const result = resolveMentions(text, users)
	assert.deepEqual(
		result.map((m) => m.userId),
		['first', 'second'],
	)
	for (const mention of result)
		assert.equal(text.slice(mention.start, mention.end), mention.label)
})
test('前端 mention 跳过代码、网址和邮箱', () => {
	assert.deepEqual(
		resolveMentions('`@林俊乐` https://site.test/@林俊乐 a@林俊乐', users),
		[],
	)
})
test('前端 mention 对同名用户保持无歧义', () => {
	assert.deepEqual(
		resolveMentions('@林俊乐', [...users, { id: 'duplicate', name: '林俊乐' }]),
		[],
	)
})
test('前端 mention 不将用户名的前缀当完整命中', () => {
	assert.deepEqual(resolveMentions('@林俊乐同学', users), [])
})
test('开发端口校验接受合法边界', () => {
	assert.equal(validPort(1), 1)
	assert.equal(validPort('65535'), 65535)
})
test('开发端口校验拒绝非法边界', () => {
	for (const port of [0, 65536, -1, 1.1, 'abc'])
		assert.throws(() => validPort(port), /INVALID_DEV_PORT/)
})
// The public comparator needs only id and score; its other fields do not affect ordering.
test('相同推荐项比较结果为零', () => {
	const item = { id: 'same', score: 0.5 } as Parameters<
		typeof compareRecommendations
	>[0]
	assert.equal(compareRecommendations(item, item), 0)
})
