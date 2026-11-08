import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { availablePort } from '../scripts/dev-ports.ts'
import type { BookView, BookLoanView } from '../packages/contracts/books.ts'

interface AuthResult {
	user: {
		id: string
		role: string
		name: string
		passwordHash?: string
		account?: string
	}
}
interface FeedResult {
	items: { id: string }[]
	nextCursor?: string | null
}
let directory = '',
	origin = '',
	bookId = '',
	postId = '',
	cookie = '',
	userId = ''
let server: ChildProcess | undefined
let database: Database.Database | undefined
let serverOutput = ''
const sourcePath = resolve(process.env.CAMPUS_TEST_DATABASE ?? '.data/pulse.db')
const account = `qa_${randomBytes(8).toString('hex')}`
const password = randomBytes(24).toString('hex')
async function request(path: string, options: RequestInit = {}) {
	return fetch(`${origin}${path}`, {
		...options,
		signal: AbortSignal.timeout(15000),
	})
}
async function json<T>(
	path: string,
	expected = 200,
	options: RequestInit = {},
): Promise<T> {
	const response = await request(path, options)
	assert.equal(response.status, expected, `${path}: unexpected HTTP status`)
	return (await response.json()) as T
}
function body(
	value: unknown,
	authenticated = false,
	method = 'POST',
): RequestInit {
	return {
		method,
		headers: {
			'content-type': 'application/json',
			...(authenticated ? { cookie } : {}),
		},
		body: JSON.stringify(value),
	}
}
function countRecords(kind: string) {
	return (
		database!
			.prepare(
				'SELECT COUNT(*) AS count FROM BookReadingRecord WHERE userId=? AND bookId=? AND kind=?',
			)
			.get(userId, bookId, kind) as { count: number }
	).count
}

before(
	async () => {
		await access('apps/web/.output/server/index.mjs')
		directory = await mkdtemp(join(tmpdir(), 'campus-http-tests-'))
		const copyPath = join(directory, 'pulse.db')
		assert.notEqual(resolve(copyPath), sourcePath)
		const source = new Database(sourcePath, {
			readonly: true,
			fileMustExist: true,
		})
		try {
			await source.backup(copyPath)
		} finally {
			source.close()
		}
		database = new Database(copyPath, { readonly: true, fileMustExist: true })
		bookId = (
			database
				.prepare(
					'SELECT b.id FROM Book b WHERE b.copies > (SELECT COUNT(*) FROM BookLoan l WHERE l.bookId=b.id AND l.returnedAt IS NULL) ORDER BY b.id LIMIT 1',
				)
				.get() as { id: string }
		).id
		postId = (
			database.prepare('SELECT id FROM Post ORDER BY id LIMIT 1').get() as {
				id: string
			}
		).id
		const port = await availablePort(43000)
		origin = `http://127.0.0.1:${port}`
		const tokenFile = join(directory, 'service-token')
		await writeFile(tokenFile, randomBytes(32).toString('hex'), { mode: 0o600 })
		server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
			env: {
				...process.env,
				NODE_ENV: 'production',
				HOST: '127.0.0.1',
				NITRO_HOST: '127.0.0.1',
				PORT: String(port),
				NITRO_PORT: String(port),
				DATABASE_URL: `file:${copyPath}`,
				CAMPUS_DATA_DIR: directory,
				CAMPUS_AGENT_DATA_DIR: join(directory, 'agents'),
				CAMPUS_AGENT_TOKEN_FILE: tokenFile,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		for (const stream of [server.stdout, server.stderr])
			stream?.on('data', (chunk: Buffer) => {
				serverOutput = (serverOutput + chunk.toString()).slice(-4000)
			})
		const deadline = Date.now() + 30000
		while (Date.now() < deadline) {
			assert.equal(server.exitCode, null, serverOutput)
			try {
				if ((await request('/api/bootstrap')).ok) return
			} catch {
				/* Wait for this isolated server to listen. */
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		throw new Error(`TEST_SERVER_START_TIMEOUT: ${serverOutput}`)
	},
	{ timeout: 45000 },
)

after(async () => {
	if (server && server.exitCode === null && server.signalCode === null) {
		const exited = once(server, 'exit')
		server.kill('SIGTERM')
		const timer = setTimeout(() => server?.kill('SIGKILL'), 3000)
		try {
			await exited
		} finally {
			clearTimeout(timer)
		}
	}
	database?.close()
	try {
		const source = new Database(sourcePath, {
			readonly: true,
			fileMustExist: true,
		})
		try {
			assert.equal(
				source.prepare('SELECT id FROM User WHERE account=?').get(account),
				undefined,
				'QA account must never appear in the source database',
			)
		} finally {
			source.close()
		}
	} finally {
		if (directory) await rm(directory, { recursive: true, force: true })
	}
})

for (const route of ['/', '/books', '/activities']) {
	test(`前端 SSR 页面可打开 ${route}`, async () => {
		const response = await request(route)
		assert.equal(response.status, 200)
		const html = await response.text()
		assert.match(html, /<html[^>]*lang="zh-CN"/)
		assert.match(html, /href="\/books"/)
		assert.match(html, /href="\/activities"/)
		assert.doesNotMatch(html, /<title>500/)
	})
}
test('游客 bootstrap 不暴露账户、密码或全站快照', async () => {
	const result = await json<{
		user: null
		campuses: string[]
		users?: unknown
		passwordHash?: unknown
	}>('/api/bootstrap')
	assert.equal(result.user, null)
	assert.equal(result.campuses.length, 3)
	assert.equal(result.users, undefined)
	assert.equal(result.passwordHash, undefined)
})
test('Feed 分页后没有重复条目', async () => {
	const first = await json<FeedResult>('/api/feed?limit=3')
	assert.equal(first.items.length, 3)
	assert.ok(first.nextCursor)
	const second = await json<FeedResult>(
		`/api/feed?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`,
	)
	const ids = [...first.items, ...second.items].map((p) => p.id)
	assert.equal(new Set(ids).size, ids.length)
})
for (const limit of ['0', '37', '1.5'])
	test(`Feed 拒绝非法分页 ${limit}`, async () => {
		await json(`/api/feed?limit=${limit}`, 422)
	})
for (const query of ['page=0', 'mode=unknown'])
	test(`图书接口拒绝非法参数 ${query}`, async () => {
		await json(`/api/books?${query}`, 422)
	})
test('图书列表和详情读取同一本书', async () => {
	const list = await json<{ items: BookView[]; total: number }>(
		'/api/books?mode=all',
	)
	assert.ok(list.total > 0 && list.items.length > 0)
	const item = await json<BookView>(
		`/api/books/${encodeURIComponent(list.items[0]!.id)}`,
	)
	assert.equal(item.title, list.items[0]!.title)
})
test('帖子直链保留 query 并打开详情弹层', async () => {
	const response = await request(`/posts/${postId}?tag=music`, {
		redirect: 'manual',
	})
	assert.equal(response.status, 302)
	const location = new URL(response.headers.get('location')!, origin)
	assert.equal(location.searchParams.get('post'), postId)
	assert.equal(location.searchParams.get('tag'), 'music')
})
for (const path of ['/api/messages', '/api/books/history'])
	test(`游客不能读取私人记录 ${path}`, async () => {
		await json(path, 401)
	})
test('游客不能修改阅读状态', async () => {
	await json(
		`/api/books/${bookId}/state`,
		401,
		body({ status: 'READ' }, false, 'PATCH'),
	)
})
test('游客不能借书', async () => {
	await json(`/api/books/${bookId}/loan`, 401, body({ action: 'borrow' }))
})
test('生产构建关闭 Studio 开发身份桥接', async () => {
	await json('/api/dev/studio/users', 404)
})
test('未持有服务令牌不能调用 Agent 接口', async () => {
	await json('/api/agent/actors', 403)
})
test('畸形注册输入返回字段错误', async () => {
	await json(
		'/api/auth/register',
		422,
		body({ account: '?', password: 'short', name: '验证' }),
	)
})
test('注册建立会话且不能自选管理员角色', async () => {
	const response = await request(
		'/api/auth/register',
		body({
			account,
			password,
			name: '回归测试账户',
			campus: '铜盘校区',
			role: 'ADMIN',
		}),
	)
	assert.equal(response.status, 200)
	const result = (await response.json()) as AuthResult
	assert.equal(result.user.role, 'STUDENT')
	assert.equal(result.user.account, undefined)
	assert.equal(result.user.passwordHash, undefined)
	userId = result.user.id
	cookie = response.headers
		.getSetCookie()
		.find(
			(c) =>
				c.startsWith('campus_session=') && !c.startsWith('campus_session=;'),
		)!
		.split(';')[0]!
	assert.match(cookie, /^campus_session=[a-f0-9]{64}$/)
	assert.ok(response.headers.getSetCookie().some((c) => /HttpOnly/i.test(c)))
})
test('有效会话读取自己的身份', async () => {
	const result = await json<AuthResult>('/api/bootstrap', 200, {
		headers: { cookie },
	})
	assert.equal(result.user.id, userId)
})
test('阅读状态重复提交保持幂等', async () => {
	const path = `/api/books/${bookId}/state`
	await json(path, 200, body({ status: 'READ', favorite: true }, true, 'PATCH'))
	const records = countRecords('READ')
	await json(path, 200, body({ status: 'READ', favorite: true }, true, 'PATCH'))
	assert.equal(countRecords('READ'), records)
	const book = await json<BookView>(`/api/books/${bookId}`, 200, {
		headers: { cookie },
	})
	assert.equal(book.status, 'READ')
	assert.equal(book.favorite, true)
})
test('非法阅读状态被拒绝且不写入记录', async () => {
	const before = countRecords('READ')
	await json(
		`/api/books/${bookId}/state`,
		422,
		body({ status: 'FINISHED_WRONG' }, true, 'PATCH'),
	)
	assert.equal(countRecords('READ'), before)
})
test('借阅重复请求只保留一笔有效借阅', async () => {
	const path = `/api/books/${bookId}/loan`
	const first = await json<{ loanId: string }>(
		path,
		200,
		body({ action: 'borrow' }, true),
	)
	const second = await json<{ loanId: string }>(
		path,
		200,
		body({ action: 'borrow' }, true),
	)
	assert.equal(first.loanId, second.loanId)
	assert.equal(countRecords('BORROW'), 1)
	const book = await json<BookView>(`/api/books/${bookId}`, 200, {
		headers: { cookie },
	})
	assert.equal((book.loan as BookLoanView).id, first.loanId)
})
test('归还重复请求只记录一次归还', async () => {
	const path = `/api/books/${bookId}/loan`
	await json(path, 200, body({ action: 'return' }, true))
	await json(path, 200, body({ action: 'return' }, true))
	assert.equal(countRecords('RETURN'), 1)
	const book = await json<BookView>(`/api/books/${bookId}`, 200, {
		headers: { cookie },
	})
	assert.equal(book.loan, null)
})
test('错误密码不能建立登录会话', async () => {
	await json(
		'/api/auth/login',
		401,
		body({ account, password: `${password}wrong` }),
	)
})
test('跨源请求不能提交写入', async () => {
	const options = body({ status: 'WANT' }, true, 'PATCH')
	options.headers = { ...options.headers, origin: 'https://untrusted.invalid' }
	await json(`/api/books/${bookId}/state`, 403, options)
})
test('退出登录使原会话失效', async () => {
	await json('/api/auth/logout', 200, body({}, true))
	await json('/api/messages', 401, { headers: { cookie } })
})
