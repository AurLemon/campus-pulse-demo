import { readBody } from 'h3'
import { createConversation } from '@campus/domain/messages'
import { api, actor, objectBody, text } from '../../utils/api'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	return createConversation(
		(await actor(event)).id,
		text(b.peerId, 'peerId', 100),
	)
})
