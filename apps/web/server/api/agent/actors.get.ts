import bridgeSecret from '#campus-studio-proof-secret'
import { verifyStudioRequest } from '../../../../../modules/studio-bridge-security'
import { api } from '@campus/domain/validation'
import { assertAgentRequest, agentActors } from '@campus/domain/agent-access'
export default api(async (event) => {
	assertAgentRequest(
		event,
		import.meta.dev && verifyStudioRequest(event, bridgeSecret),
	)
	return agentActors()
})
