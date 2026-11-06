import { getRouterParam } from 'h3'
import { getConversationMetadata } from '@campus/domain/messages'
import { api, actor, text } from '../../../utils/api'
export default api(async (event) =>
	getConversationMetadata(
		(await actor(event)).id,
		text(getRouterParam(event, 'id'), 'id', 100),
	),
)
