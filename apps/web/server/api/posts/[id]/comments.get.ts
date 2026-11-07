import { getRouterParam, setHeader } from 'h3'
import { db } from '@campus/domain/prisma'
import { listPostComments } from '@campus/domain/services/comment.service'
import { api, optionalActor, fail } from '../../../utils/api'
import type { PostComments } from '@campus/contracts'

export default api(async (event): Promise<PostComments> => {
	setHeader(event, 'Cache-Control', 'no-store')
	const id = getRouterParam(event, 'id')
	const post = await db.post.findUnique({ where: { id }, select: { id: true } })
	if (!post) fail('NOT_FOUND', 404)
	const user = await optionalActor(event)
	return { comments: await listPostComments(post.id, user?.id) }
})
