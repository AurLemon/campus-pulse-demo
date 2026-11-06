import { readBody } from 'h3'
import { heartbeatPresence } from '@campus/domain/messages'
import { api, actor, objectBody } from '../../utils/api'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	const user = await actor(event)

	return heartbeatPresence(user.id, b.active !== false)
})
