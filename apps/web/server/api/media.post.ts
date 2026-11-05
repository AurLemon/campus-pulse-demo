import { getHeader, createError } from 'h3'
import { Readable } from 'node:stream'
import { uploadMedia } from '@campus/domain/media'
import { api, actor, fail } from '../utils/api'

export default api(async (event) => {
	const user = await actor(event),
		max = 9 * 1024 * 1024
	const size = Number(getHeader(event, 'content-length') ?? 0)
	if (size > max) fail('PAYLOAD_TOO_LARGE', 413)
	const contentType = getHeader(event, 'content-type') ?? ''
	if (!/^multipart\/form-data;/.test(contentType))
		fail('VALIDATION_FAILED', 422, { file: 'REQUIRED' })
	let received = 0
	const stream = (
		Readable.toWeb(event.node.req) as ReadableStream<Uint8Array>
	).pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				received += chunk.byteLength
				if (received > max)
					controller.error(
						createError({
							statusCode: 413,
							data: { code: 'PAYLOAD_TOO_LARGE' },
						}),
					)
				else controller.enqueue(chunk)
			},
		}),
	)
	const form = await new Response(stream, {
		headers: { 'Content-Type': contentType },
	})
		.formData()
		.catch((error: unknown) => {
			if (error && typeof error === 'object' && 'statusCode' in error)
				throw error
			fail('VALIDATION_FAILED', 422, { file: 'INVALID_IMAGE' })
		})
	const files = form.getAll('file')
	if (files.length !== 1 || !(files[0] instanceof File))
		fail('VALIDATION_FAILED', 422, { file: 'REQUIRED' })
	const alt = form.get('alt')
	return uploadMedia(
		user.id,
		Buffer.from(await files[0].arrayBuffer()),
		typeof alt === 'string' ? alt : '',
	)
})
