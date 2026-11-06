import { readBody } from 'h3'
import {
	markNotificationsRead,
	markAllNotificationsRead,
} from '@campus/domain/messages'
import { api, actor, objectBody } from '../../../utils/api'
export default api(async (event) => {
	const user = await actor(event)
	const body = objectBody(await readBody(event))
	return body.all === true
		? markAllNotificationsRead(user.id)
		: markNotificationsRead(user.id, body.ids)
})
