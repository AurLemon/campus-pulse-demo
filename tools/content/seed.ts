import { resolveSnapshotFile } from './snapshot-bundle.ts'
import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { importContentBatch } from '@campus/domain/import'
import { db, dataDirectory } from '@campus/domain/prisma'
import type { Snapshot } from '@campus/contracts'
import { attachMedia, type Asset } from './media.ts'
import { validateSnapshot } from './validate.ts'
import { ensureAssetCache } from './asset-bundle.ts'

const file = await resolveSnapshotFile(process.argv[2] ?? 'pulse-full.json')
let snapshot = JSON.parse(await readFile(file, 'utf8')) as Snapshot
for (const row of [...snapshot.users, ...snapshot.activities]) {
	const names: Record<string, string> = {
		铜盘: '铜盘校区',
		鼓山: '鼓山校区',
		旗山: '旗山校区',
	}
	row.campus = names[row.campus] ?? row.campus
}
const errors = validateSnapshot(snapshot)
if (errors.length)
	throw new Error(`INVALID_SNAPSHOT:${errors.slice(0, 10).join(',')}`)
const assetCache = await ensureAssetCache()
const assets = JSON.parse(
	await readFile(resolve(assetCache, 'manifest.json'), 'utf8'),
) as Asset[]
const mediaDirectory =
	process.env.CAMPUS_MEDIA_DIR ?? resolve(dataDirectory, 'media')
await mkdir(mediaDirectory, { recursive: true })
for (const asset of assets)
	await copyFile(
		resolve(assetCache, `${asset.id}.webp`),
		resolve(mediaDirectory, `${asset.id}.webp`),
	)
snapshot = attachMedia(snapshot, assets)
try {
	await importContentBatch({
		id: snapshot.version,
		version: snapshot.version,
		snapshot,
		media: assets.map(({ file: _, tags: __, license: ___, ...m }) => m),
	})
	console.log(
		JSON.stringify({
			imported: true,
			version: snapshot.version,
			users: snapshot.users.length,
			activities: snapshot.activities.length,
			posts: snapshot.posts.length,
			media: assets.length,
		}),
	)
} finally {
	await db.$disconnect()
}
