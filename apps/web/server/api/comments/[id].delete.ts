import { getRouterParam } from 'h3'
import { removeComment } from '@campus/domain/services/comment.service'
import { api, actor, text, businessNow } from '../../utils/api'
export default api(async (event) => {
	const user = await actor(event)
	return removeComment(
		user.id,
		text(getRouterParam(event, 'id'), 'id', 100),
		businessNow(),
	)
})
