import { readBody } from 'h3'
import { api, actor, businessNow, objectBody, text } from '../utils/api'
import { act } from '../services/action.service'
import type { Mutation } from '@campus/contracts'
export default api(async (event) => {
	const b = objectBody(await readBody(event))
	return act(
		(await actor(event)).id,
		{ ...b, targetId: text(b.targetId, 'targetId', 100) } as Mutation,
		await businessNow(),
	)
})
