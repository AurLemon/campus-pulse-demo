import { readBody } from 'h3'
import { createComment } from '@campus/domain/services/comment.service'
import { api, actor, objectBody, text } from '../../utils/api'
export default api(async (event) => {
	const body = objectBody(await readBody(event))
	return createComment((await actor(event)).id, {
		postId: text(body.postId, 'postId', 100),
		parentId: body.parentId ? text(body.parentId, 'parentId', 100) : null,
		body: body.body,
		mediaIds: body.mediaIds,
		operationId: body.operationId
			? text(body.operationId, 'operationId', 100)
			: undefined,
	})
})
