import { getRouterParam, readBody } from 'h3'
import { markConversationRead } from '@campus/domain/messages'
import { api, actor, text, objectBody } from '../../../utils/api'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	return markConversationRead(
		(await actor(event)).id,
		text(getRouterParam(event, 'id'), 'id', 100),
		Number(b.sequence),
	)
})
