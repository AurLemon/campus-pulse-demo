import { basename } from 'node:path'
import sharp from 'sharp'
import type { Asset } from './media.ts'

export async function validateAssetFiles(files: Map<string, Buffer>) {
	const assets = JSON.parse(
		files.get('manifest.json')?.toString('utf8') ?? 'null',
	) as Asset[]
	if (!Array.isArray(assets) || !assets.length)
		throw new Error('ASSET_MANIFEST_INVALID')
	const names = new Set<string>()
	for (const asset of assets) {
		if (
			!asset ||
			typeof asset.id !== 'string' ||
			!/^[a-z0-9-]+$/.test(asset.id) ||
			typeof asset.file !== 'string'
		)
			throw new Error('ASSET_MANIFEST_INVALID')
		const name = `${asset.id}.webp`
		if (basename(asset.file) !== name || names.has(name))
			throw new Error('ASSET_MANIFEST_INVALID')
		names.add(name)
		const image = sharp(files.get(name) ?? Buffer.alloc(0))
		const metadata = await image.metadata()
		if (
			metadata.format !== 'webp' ||
			metadata.width !== asset.width ||
			metadata.height !== asset.height
		)
			throw new Error(`ASSET_IMAGE_INVALID:${name}`)
		await image.stats()
	}
	for (const name of files.keys())
		if (name.endsWith('.webp') && !names.has(name))
			throw new Error(`ASSET_UNLISTED:${name}`)
}
