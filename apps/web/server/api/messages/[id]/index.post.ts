import { getRouterParam, readBody } from 'h3'
import { sendDirectMessage } from '@campus/domain/messages'
import { api, actor, text, objectBody } from '../../../utils/api'
export default api(async (event) =>
	sendDirectMessage(
		(await actor(event)).id,
		text(getRouterParam(event, 'id'), 'id', 100),
		objectBody(await readBody(event)),
	),
)
