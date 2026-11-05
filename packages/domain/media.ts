import { resolve } from 'node:path'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { db, dataDirectory } from './prisma.ts'
import { fail } from './validation.ts'
export const mediaDirectory =
	process.env.CAMPUS_MEDIA_DIR ?? resolve(dataDirectory, 'media')
export async function uploadMedia(ownerId: string, data: Buffer, alt: string) {
	if (!data.length || data.length > 8 * 1024 * 1024)
		fail('PAYLOAD_TOO_LARGE', 413)
	let buffer: Buffer, width: number, height: number
	try {
		const image = sharp(data, {
				limitInputPixels: 40000000,
				animated: false,
				failOn: 'warning',
			}),
			metadata = await image.metadata()
		if (
			!metadata.format ||
			!['jpeg', 'png', 'webp'].includes(metadata.format) ||
			!metadata.width ||
			!metadata.height
		)
			fail('VALIDATION_FAILED', 422, { file: 'INVALID_IMAGE' })
		const result = await image
			.rotate()
			.resize({
				width: 2000,
				height: 2400,
				fit: 'inside',
				withoutEnlargement: true,
			})
			.webp({ quality: 85 })
			.toBuffer({ resolveWithObject: true })
		buffer = result.data
		width = result.info.width
		height = result.info.height
	} catch (error) {
		if (error && typeof error === 'object' && 'statusCode' in error) throw error
		fail('VALIDATION_FAILED', 422, { file: 'INVALID_IMAGE' })
	}
	const id = randomUUID(),
		filename = `${id}.webp`
	await mkdir(mediaDirectory, { recursive: true })
	await writeFile(resolve(mediaDirectory, filename), buffer)
	return db.mediaAsset
		.create({
			data: {
				id,
				ownerId,
				url: `/media/${filename}`,
				mime: 'image/webp',
				width,
				height,
				alt: alt.slice(0, 160),
				origin: 'upload',
				createdAt: new Date().toISOString(),
			},
		})
		.catch(async (error) => {
			await unlink(resolve(mediaDirectory, filename)).catch(() => {})
			throw error
		})
}
