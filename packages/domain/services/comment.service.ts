import { db } from '../prisma.ts'
import { fail, text } from '../validation.ts'

export async function editComment(userId: string, id: string, value: unknown) {
	const body = text(value, 'body', 2000)
	return db.$transaction(async (tx) => {
		const comment = await tx.comment.findUnique({ where: { id } })
		if (!comment) fail('NOT_FOUND', 404)
		if (comment.authorId !== userId) fail('FORBIDDEN', 403)
		if (comment.deletedAt) fail('CONFLICT', 409)
		return tx.comment.update({
			where: { id },
			data: { body },
			select: { id: true, body: true },
		})
	})
}

export async function removeComment(userId: string, id: string, now: string) {
	return db.$transaction(async (tx) => {
		const comment = await tx.comment.findUnique({ where: { id } })
		if (!comment) fail('NOT_FOUND', 404)
		if (comment.authorId !== userId) fail('FORBIDDEN', 403)
		const replies = await tx.comment.count({ where: { parentId: id } })
		if (replies === 0) {
			await tx.comment.delete({ where: { id } })
			return { ok: true, id, removed: true }
		}
		// Preserve every reply and its parent ID. A removed root has no original text left to expose.
		await tx.comment.update({
			where: { id },
			data: { body: '', deletedAt: comment.deletedAt ?? now },
		})
		return { ok: true, id, removed: false }
	})
}
