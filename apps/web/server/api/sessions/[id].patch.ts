import { readBody, getRouterParam } from 'h3'
import { db } from '@campus/domain/prisma'
import { api, actor, objectBody, text, fail } from '../../utils/api'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	const user = await actor(event)
	const id = text(getRouterParam(event, 'id'), 'id', 100)
	const requested = Number(b.effectiveMs)
	if (
		!Number.isFinite(requested) ||
		requested < 0 ||
		requested > 300000 ||
		typeof b.closed !== 'boolean'
	)
		fail('VALIDATION_FAILED', 422)
	return db.$transaction(async (tx) => {
		const s = await tx.viewSession.findUnique({ where: { id } })
		if (!s) fail('NOT_FOUND', 404)
		if (s.userId !== user.id) fail('FORBIDDEN', 403)
		if (s.closed) return { ok: true, effectiveMs: s.effectiveMs }
		const now = Date.now()
		const elapsed = Math.max(0, now - Date.parse(s.updatedAt))
		const effectiveMs = Math.min(
			300000,
			Math.max(0, now - Date.parse(s.startedAt)),
			Math.max(
				s.effectiveMs,
				Math.min(Math.floor(requested), s.effectiveMs + elapsed),
			),
		)
		await tx.viewSession.update({
			where: { id },
			data: {
				effectiveMs,
				closed: b.closed === true,
				updatedAt: new Date(now).toISOString(),
			},
		})
		await tx.behavior.update({ where: { id }, data: { effectiveMs } })
		return { ok: true, effectiveMs }
	})
})
