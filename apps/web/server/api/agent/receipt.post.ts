import bridgeSecret from '#campus-studio-proof-secret'
import { verifyStudioRequest } from '../../../../../modules/studio-bridge-security'
import { readBody } from 'h3'
import { api, objectBody, text } from '@campus/domain/validation'
import { assertAgentRequest, agentReceipt } from '@campus/domain/agent-access'
export default api(async (event) => {
	assertAgentRequest(
		event,
		import.meta.dev && verifyStudioRequest(event, bridgeSecret),
	)
	const b = objectBody(await readBody(event))
	return agentReceipt(
		text(b.operationId, 'operationId', 160),
		text(b.actorId, 'actorId', 100),
	)
})
