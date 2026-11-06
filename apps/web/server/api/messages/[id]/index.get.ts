import { getRouterParam, getQuery } from 'h3'
import { getConversationMessages } from '@campus/domain/messages'
import { api, actor, text } from '../../../utils/api'
export default api(async (event) =>
	getConversationMessages(
		(await actor(event)).id,
		text(getRouterParam(event, 'id'), 'id', 100),
		Number(getQuery(event).after ?? 0),
	),
)
