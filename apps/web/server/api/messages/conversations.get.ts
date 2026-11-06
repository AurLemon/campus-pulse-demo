import { getQuery } from 'h3'
import { listConversationPage } from '@campus/domain/messages'
import { api, actor, text } from '../../utils/api'
export default api(async (event) => {
	const cursor = getQuery(event).cursor
	return listConversationPage(
		(await actor(event)).id,
		cursor === undefined ? undefined : text(cursor, 'cursor', 500),
	)
})
