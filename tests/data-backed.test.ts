import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { loadReadOnlySnapshot } from '../packages/domain/readonly-snapshot.ts'
import { readOnlyBookSnapshot } from '../packages/domain/books.ts'
import {
	recommendPosts,
	recommendActivities,
	compareRecommendations,
	type RecommendationTraceEvent,
} from '../packages/recommendation/index.ts'
import { recommendBooks } from '../packages/recommendation/books.ts'
import type { Snapshot } from '../packages/contracts/index.ts'
import type { BookSnapshot } from '../packages/contracts/books.ts'

let directory = '',
	snapshot: Snapshot,
	books: BookSnapshot,
	userId = ''
const now = new Date().toISOString()
before(async () => {
	directory = await mkdtemp(join(tmpdir(), 'campus-algorithm-tests-'))
	const source = new Database(
		resolve(process.env.CAMPUS_TEST_DATABASE ?? '.data/pulse.db'),
		{ readonly: true, fileMustExist: true },
	)
	const copyPath = join(directory, 'pulse.db')
	try {
		await source.backup(copyPath)
	} finally {
		source.close()
	}
	snapshot = await loadReadOnlySnapshot(`file:${copyPath}`, now, {
		crossDomain: false,
	})
	books = await readOnlyBookSnapshot(`file:${copyPath}`)
	userId = books.records.find((r) =>
		snapshot.users.some((u) => u.id === r.userId),
	)!.userId
})
after(async () => {
	if (directory) await rm(directory, { recursive: true, force: true })
})
test('现有数据包含可用于对照的角色、帖子、活动和图书', () => {
	assert.ok(
		snapshot.users.length &&
			snapshot.posts.length &&
			snapshot.activities.length &&
			books.books.length &&
			books.records.length,
	)
})
for (const [label, recommend] of [
	['帖子', recommendPosts],
	['活动', recommendActivities],
] as const) {
	test(`${label} Top-3 与当前完整候选排序对照`, () => {
		const input = {
			snapshot,
			userId,
			now,
			k: Math.max(snapshot.posts.length, snapshot.activities.length),
			exploration: { seed: 'regression-fixed-seed', strength: 0.12 },
		}
		const all = recommend(input).items
		const top = recommend({ ...input, k: 3 }).items
		assert.ok(all.length > 3)
		assert.deepEqual(
			top,
			[...all].sort((a, b) => compareRecommendations(b, a)).slice(0, 3),
		)
	})
	test(`${label} 相同种子可重放且追踪不改变结果`, () => {
		const input = {
			snapshot,
			userId,
			now,
			k: 3,
			exploration: { seed: 'regression-fixed-seed', strength: 0.12 },
		}
		const events: RecommendationTraceEvent[] = []
		const normal = recommend(input)
		const traced = recommend(input, {
			onTrace: (event) => events.push(event),
			maxEvents: 2,
		})
		assert.deepEqual(normal.items, traced.items)
		assert.deepEqual(normal.items, recommend(input).items)
		assert.ok(
			events.length <= 3 && events.some((e) => e.action === 'truncated'),
		)
	})
}
test('活动结果排除取消、开始、截止和已报名活动', () => {
	const registered = new Set(
		snapshot.states
			.filter(
				(s) =>
					s.userId === userId && s.kind === 'REGISTER' && s.createdAt <= now,
			)
			.map((s) => s.activityId),
	)
	const result = recommendActivities({
		snapshot,
		userId,
		now,
		k: snapshot.activities.length,
	})
	for (const row of result.items) {
		const activity = snapshot.activities.find((a) => a.id === row.id)!
		assert.equal(activity.status, 'PUBLISHED')
		assert.ok(
			activity.startsAt > now &&
				activity.endsAt > now &&
				activity.deadline > now,
		)
		assert.ok(!registered.has(activity.id))
	}
})
test('探索种子变化会改变至少一条帖子得分', () => {
	const base = { snapshot, userId, now, k: snapshot.posts.length }
	const a = new Map(
		recommendPosts({
			...base,
			exploration: { seed: 'first', strength: 0.12 },
		}).items.map((r) => [r.id, r.score]),
	)
	const b = recommendPosts({
		...base,
		exploration: { seed: 'second', strength: 0.12 },
	}).items
	assert.ok(b.some((r) => a.get(r.id) !== r.score))
})
for (const mode of ['user', 'item', 'content', 'hybrid'] as const) {
	test(`真实书目 ${mode} 模式的分数有界且 Top-3 一致`, () => {
		const input = {
			snapshot: books,
			userId,
			now,
			mode,
			resultCount: books.books.length,
		}
		const all = recommendBooks(input)
		const top = recommendBooks({ ...input, resultCount: 3 })
		assert.ok(all.items.length > 3)
		assert.deepEqual(top.items, all.items.slice(0, 3))
		for (const item of all.items)
			assert.ok(
				Number.isFinite(item.score) &&
					item.score >= 0 &&
					item.score <= 1 + 1e-10,
			)
		assert.ok(top.heapSteps.every((step) => step.size <= 3))
	})
}
test('读者协同矩阵的非空行经过 L2 归一化', () => {
	const result = recommendBooks({
		snapshot: books,
		userId,
		now,
		resultCount: 3,
	})
	assert.ok(result.matrix.length > 0)
	for (const row of result.matrix) {
		if (row.entries.length)
			assert.ok(
				Math.abs(row.entries.reduce((s, e) => s + e.normalized ** 2, 0) - 1) <
					1e-8,
			)
	}
})
test('推荐纯函数不会改写原始数据快照', () => {
	const original = JSON.stringify(snapshot)
	recommendPosts({ snapshot, userId, now, k: 3 })
	recommendActivities({ snapshot, userId, now, k: 3 })
	assert.equal(JSON.stringify(snapshot), original)
	const originalBooks = JSON.stringify(books)
	recommendBooks({ snapshot: books, userId, now, resultCount: 3 })
	assert.equal(JSON.stringify(books), originalBooks)
})
