import { join } from 'node:path'
import {
	ensureContentCache,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'
import { readFile, readdir, writeFile } from 'node:fs/promises'

interface Change {
	file: string
	path: string
	before: string
	after: string
}
const changes: Change[] = []
const run =
	process.argv.includes('--run') && !process.argv.includes('--dry-run')
if (!run) {
	console.log(
		JSON.stringify({
			mode: 'dry-run',
			action: 'normalize-content',
			cacheOpened: false,
		}),
	)
	process.exit(0)
}
const contentCache = await ensureContentCache()
const normalize = (value: unknown, file: string, path = ''): unknown => {
	if (typeof value === 'string') {
		const after = value
			.replace(/[；;]/g, '，')
			.replace(/·/g, '/')
			.replace(/…+|\.{3,}/g, '。')
		if (after !== value) changes.push({ file, path, before: value, after })
		return after
	}
	if (Array.isArray(value))
		return value.map((item, index) =>
			normalize(item, file, `${path}[${index}]`),
		)
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				normalize(item, file, path ? `${path}.${key}` : key),
			]),
		)
	return value
}
for (const file of (await readdir(contentCache)).filter((file) =>
	/^full-(?:posts|activities)-.*\.json$/.test(file),
)) {
	const filename = join(contentCache, file)
	const beforeCount = changes.length
	const content = normalize(JSON.parse(await readFile(filename, 'utf8')), file)
	if (run && changes.length > beforeCount)
		await writeContentCacheFile(filename, JSON.stringify(content, null, '\t'))
}
if (run)
	await writeFile(
		'.data/data-generation/punctuation-normalization.json',
		JSON.stringify(changes, null, '\t'),
		{ mode: 0o600 },
	)
const contentBundle = await packContentCache()
if (!contentBundle.cacheStateUpdated)
	throw new Error(
		'CONTENT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing the cache',
	)

console.log(
	JSON.stringify({
		mode: run ? 'run' : 'dry-run',
		changedFields: changes.length,
		files: [...new Set(changes.map((change) => change.file))],
	}),
)
