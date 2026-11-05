import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { PosterOptions, Snapshot } from '@campus/contracts'
import {
	ensureSnapshotCache,
	writeSnapshotFile,
	publishSnapshots,
} from './snapshot-bundle.ts'
import { assignSnapshotPosters, posterIdHash } from './poster.ts'
import { validateSnapshot } from './validate.ts'

const file =
	process.argv.find((value) => value.startsWith('--file='))?.slice(7) ??
	'pulse-full.json'
if (!/^[a-zA-Z0-9_-]+\.json$/.test(file))
	throw new Error('INVALID_SNAPSHOT_NAME')
const directory = await ensureSnapshotCache()
const hashes = new Map<string, string>()
for (const name of await readdir(directory))
	if (name.endsWith('.json') && !name.startsWith('.'))
		hashes.set(
			name,
			createHash('sha256')
				.update(await readFile(join(directory, name)))
				.digest('hex'),
		)
const original = JSON.parse(
	await readFile(join(directory, file), 'utf8'),
) as Snapshot
const updated = assignSnapshotPosters(original)
if (process.argv.includes('--include-note')) {
	for (const row of [...updated.posts, ...updated.activities]) {
		if (posterIdHash(row.id) % 3 === 2) row.posterTemplate = 'note'
	}
}
function withoutPosters(row: PosterOptions) {
	const {
		posterTemplate: _template,
		posterAspect: _aspect,
		posterHighlight: _highlight,
		...rest
	} = row
	return rest
}
const strip = (snapshot: Snapshot) => ({
	...snapshot,
	activities: snapshot.activities.map(withoutPosters),
	posts: snapshot.posts.map(withoutPosters),
})
if (!isDeepStrictEqual(strip(original), strip(updated)))
	throw new Error('NON_METADATA_CHANGE')
const errors = validateSnapshot(updated)
if (errors.length) throw new Error(`INVALID_SNAPSHOT:${errors.join(',')}`)
const run = process.argv.includes('--run')
let bundle
if (run) {
	await writeSnapshotFile(file, JSON.stringify(updated, null, '\t'))
	bundle = await publishSnapshots()
	for (const [name, hash] of hashes)
		if (
			name !== file &&
			createHash('sha256')
				.update(await readFile(join(directory, name)))
				.digest('hex') !== hash
		)
			throw new Error(`OTHER_SNAPSHOT_CHANGED:${name}`)
	const published = JSON.parse(
		await readFile(join(directory, file), 'utf8'),
	) as Snapshot
	if (!isDeepStrictEqual(updated, published))
		throw new Error('PUBLISHED_SNAPSHOT_MISMATCH')
}
const count = (rows: PosterOptions[]) => ({
	total: rows.length,
	orbit: rows.filter((row) => row.posterTemplate === 'orbit').length,
	quote: rows.filter((row) => row.posterTemplate === 'quote').length,
	note: rows.filter((row) => row.posterTemplate === 'note').length,
	portrait: rows.filter((row) => row.posterAspect === 'portrait').length,
	highlighted: rows.filter((row) => row.posterHighlight).length,
})
console.log(
	JSON.stringify(
		{
			mode: run ? 'published' : 'dry-run',
			file,
			version: updated.version,
			posts: count(updated.posts),
			activities: count(updated.activities),
			comments: updated.comments.length,
			preservedOtherFiles: hashes.size - 1,
			validationErrors: errors,
			bundle,
		},
		null,
		'\t',
	),
)
