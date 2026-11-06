import '../tools/agents/environment.ts'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

// Materialize a new SQLite file before the schema engine opens it.
const databaseUrl =
	process.env.DATABASE_URL ?? `file:${resolve('.data/pulse.db')}`
if (!databaseUrl.startsWith('file:'))
	throw new Error('SQLite requires a file: DATABASE_URL')
const databasePath = resolve(databaseUrl.slice(5))
await mkdir(dirname(databasePath), { recursive: true })
if (!existsSync(databasePath)) new Database(databasePath).close()
const require = createRequire(import.meta.url)
const cli = require.resolve('prisma/build/index.js')
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
	cwd: process.cwd(),
	env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'info' },
	stdio: 'inherit',
})
child.once('error', () => {
	process.exitCode = 1
})
child.once('close', (code) => {
	process.exitCode = code ?? 1
})
