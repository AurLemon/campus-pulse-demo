import { getRouterParam, readBody } from 'h3'
import { editComment } from '@campus/domain/services/comment.service'
import { api, actor, objectBody, text } from '../../utils/api'
export default api(async (event) => {
	const user = await actor(event)
	const body = objectBody(await readBody(event))
	return editComment(
		user.id,
		text(getRouterParam(event, 'id'), 'id', 100),
		body.body,
	)
})
