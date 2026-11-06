import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { db } from '@campus/domain/prisma'
import { mediaDirectory } from '@campus/domain/media'
import {
	ensureAssetCache,
	packAssetCache,
	writeAssetCacheFile,
} from './asset-bundle.ts'
import type { Asset } from './media.ts'

interface CharacterSource {
	id: number
	name: string
	url: string
	sourceUrl: string
	subjectId: number
}
interface AvatarMapping {
	userId: string
	assetId: string
	url: string
	characterId: number
	sourceUrl: string
	sha256: string
}
const digest = (bytes: Buffer) =>
	createHash('sha256').update(bytes).digest('hex')
const directory = resolve(process.argv[2] ?? '.data/avatar-import-v2')
const sources = JSON.parse(
	await readFile(resolve(directory, 'sources.json'), 'utf8'),
) as CharacterSource[]
const cache = await ensureAssetCache()
const manifest = JSON.parse(
	await readFile(resolve(cache, 'manifest.json'), 'utf8'),
) as Asset[]
const users = await db.user.findMany({
	where: { source: 'Synthetic' },
	select: { id: true },
	orderBy: { id: 'asc' },
})
const prepared: {
	source: CharacterSource
	original: Buffer
	image: Buffer
	hash: string
}[] = []
const hashes = new Set<string>()
const originals: Record<string, { sha256: string; base64: string }> = {}
for (const source of sources) {
	const original = await readFile(
		resolve(directory, 'original', `${source.id}.img`),
	)
	originals[String(source.id)] = {
		sha256: digest(original),
		base64: original.toString('base64'),
	}
	const image = await sharp(original, { failOn: 'warning' })
		.rotate()
		.resize(256, 256, { fit: 'cover', position: 'north' })
		.webp({ quality: 88 })
		.toBuffer()
	// Some catalog entries are placeholder images rather than character artwork.
	const statistics = await sharp(image).stats()
	if (statistics.entropy < 0.5) continue
	const hash = digest(image)
	if (!hashes.has(hash)) {
		hashes.add(hash)
		prepared.push({ source, original, image, hash })
	}
}
if (prepared.length < users.length)
	throw new Error(
		`INSUFFICIENT_DISTINCT_AVATARS:${prepared.length}/${users.length}`,
	)
const mapping: AvatarMapping[] = []
const assets: Asset[] = []
await mkdir(mediaDirectory, { recursive: true })
for (const [index, user] of users.entries()) {
	if (!/^[a-z0-9-]+$/.test(user.id))
		throw new Error(`INVALID_AVATAR_USER_ID:${user.id}`)
	const entry = prepared[index]!
	const id = `anime-avatar-${user.id}`
	const url = `/media/${id}.webp`
	const asset: Asset = {
		id,
		url,
		file: `tools/content/assets/${id}.webp`,
		tags: ['avatar'],
		mime: 'image/webp',
		width: 256,
		height: 256,
		alt: entry.source.name,
		origin: 'Anime',
		sourceUrl: entry.source.sourceUrl,
		attribution: `Bangumi / ${entry.source.name}`,
		license: 'Character artwork belongs to its respective copyright holder',
	}
	await writeAssetCacheFile(resolve(cache, `${id}.webp`), entry.image)
	await writeFile(resolve(mediaDirectory, `${id}.webp`), entry.image)
	assets.push(asset)
	mapping.push({
		userId: user.id,
		assetId: id,
		url,
		characterId: entry.source.id,
		sourceUrl: entry.source.sourceUrl,
		sha256: entry.hash,
	})
}
// Keep source bytes recoverable under the archive's JSON-only checkpoint contract.
await writeAssetCacheFile(
	resolve(cache, 'anime-avatar-originals.json'),
	JSON.stringify(originals),
)
await writeAssetCacheFile(
	resolve(cache, 'anime-avatar-sources.json'),
	JSON.stringify(sources, null, '\t') + '\n',
)
await writeAssetCacheFile(
	resolve(cache, 'anime-avatar-map.json'),
	JSON.stringify(mapping, null, '\t') + '\n',
)
const replacements = new Map(assets.map((asset) => [asset.id, asset]))
const merged = manifest.map((asset) => replacements.get(asset.id) ?? asset)
const knownIds = new Set(manifest.map((asset) => asset.id))
merged.push(...assets.filter((asset) => !knownIds.has(asset.id)))
await writeAssetCacheFile(
	resolve(cache, 'manifest.json'),
	JSON.stringify(merged, null, '\t') + '\n',
)
await packAssetCache()
try {
	await db.$transaction(
		assets.map(({ file: _file, tags: _tags, license: _license, ...asset }) =>
			db.mediaAsset.upsert({
				where: { id: asset.id },
				create: {
					...asset,
					ownerId: null,
					createdAt: new Date().toISOString(),
				},
				update: { ...asset, ownerId: null },
			}),
		),
	)
	console.log(
		JSON.stringify({
			avatars: assets.length,
			distinct: hashes.size,
			originalSources: sources.length,
			preservedAssets: manifest.length,
			totalAssets: merged.length,
		}),
	)
} finally {
	await db.$disconnect()
}
