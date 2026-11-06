import { getRouterParam, readBody } from 'h3'
import { db } from '@campus/domain/prisma'
import { setBookState } from '@campus/domain/books'
import { api, actor, text, objectBody } from '../../../utils/api'
export default api(async (event) => {
	const input = objectBody(await readBody(event))
	return setBookState(
		db,
		(await actor(event)).id,
		text(getRouterParam(event, 'id'), 'id', 100),
		input,
	)
})
