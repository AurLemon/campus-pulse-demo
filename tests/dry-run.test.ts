import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const script of [
	'tools/agents/probe.ts',
	'tools/content/small-content.ts',
	'tools/content/repair-one.ts',
	'tools/content/repair-notices.ts',
]) {
	test(`${script} dry-run 不创建数据或模型任务`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'campus-dry-run-'))
		try {
			const result = spawnSync(process.execPath, [script, '--dry-run'], {
				encoding: 'utf8',
				timeout: 20000,
				env: {
					...process.env,
					CAMPUS_DATA_DIR: directory,
					CAMPUS_AGENT_DATA_DIR: directory,
				},
			})
			assert.equal(result.status, 0, result.stderr)
			const output = JSON.parse(result.stdout.trim()) as {
				dryRun?: boolean
				mode?: string
				cacheOpened?: boolean
			}
			assert.ok(output.dryRun === true || output.mode === 'dry-run')
			assert.notEqual(output.cacheOpened, true)
			assert.deepEqual(await readdir(directory), [])
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
}
