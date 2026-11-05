import { readBody } from 'h3'
import { api, actor, objectBody, businessNow } from '../../utils/api'
import { saveActivity } from '../../services/activity.service'
export default api(async (event) =>
	saveActivity(
		(await actor(event)).id,
		objectBody(await readBody(event)),
		await businessNow(),
	),
)
