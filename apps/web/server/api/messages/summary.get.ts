import { getMessageSummary } from '@campus/domain/messages'
import { api, actor } from '../../utils/api'
export default api(async (event) => getMessageSummary((await actor(event)).id))
