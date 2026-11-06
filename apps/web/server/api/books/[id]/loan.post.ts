import { getRouterParam, readBody } from 'h3'
import { db } from '@campus/domain/prisma'
import { changeBookLoan } from '@campus/domain/books'
import { api, actor, text, objectBody, fail } from '../../../utils/api'
export default api(async (event) => {
	const input = objectBody(await readBody(event))
	if (input.action !== 'borrow' && input.action !== 'return')
		fail('VALIDATION_FAILED', 422)
	return changeBookLoan(
		db,
		(await actor(event)).id,
		text(getRouterParam(event, 'id'), 'id', 100),
		input.action,
	)
})
