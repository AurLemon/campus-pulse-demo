import { defineEventHandler, getQuery } from 'h3'
import type { StudioAccount, StudioAccountsResponse } from '@campus/contracts'
import {
	runStudioLoginRequest,
	studioLoginFailure,
	studioLoginError,
} from '../../../utils/studio-login'
export default defineEventHandler((event) => {
	if (!import.meta.dev) return studioLoginFailure(event)
	return runStudioLoginRequest(
		event,
		async (): Promise<StudioAccountsResponse> => {
			const { db } = await import('@campus/domain/prisma')
			const query = getQuery(event)
			const q = String(query.q ?? '').trim()
			const page = Number(query.page ?? 1),
				pageSize = Number(query.pageSize ?? 100)
			if (
				q.length > 100 ||
				!Number.isInteger(page) ||
				page < 1 ||
				page > 100000 ||
				![20, 50, 100, 200].includes(pageSize)
			)
				studioLoginError(422, 'STUDIO_INVALID_INPUT')
			if (!q && query.all !== 'true')
				return { accounts: [], total: 0, page: 1, pageSize }
			const where = q
				? {
						OR: [
							{ name: { contains: q } },
							{ account: { contains: q } },
							{ campus: { contains: q } },
						],
					}
				: {}
			const [total, accounts] = await db.$transaction([
				db.user.count({ where }),
				db.user.findMany({
					where,
					select: {
						id: true,
						name: true,
						account: true,
						campus: true,
						role: true,
					},
					orderBy: [{ name: 'asc' }, { id: 'asc' }],
					skip: (page - 1) * pageSize,
					take: pageSize,
				}),
			])
			return {
				total,
				page,
				pageSize,
				accounts: accounts.map((account) => ({
					...account,
					role: account.role as StudioAccount['role'],
				})),
			}
		},
	)
})
