import bridgeSecret from '#campus-studio-proof-secret'
import { verifyStudioRequest } from '../../../../../modules/studio-bridge-security'
import { readBody } from 'h3'
import type { AgentTrigger } from '@campus/contracts/agents'
import { api, objectBody, text } from '@campus/domain/validation'
import { assertAgentRequest, agentContext } from '@campus/domain/agent-access'
export default api(async (event) => {
	assertAgentRequest(
		event,
		import.meta.dev && verifyStudioRequest(event, bridgeSecret),
	)
	const b = objectBody(await readBody(event))
	return agentContext(
		text(b.actorId, 'actorId', 100),
		b.trigger as AgentTrigger | undefined,
		b.operationId === undefined
			? undefined
			: text(b.operationId, 'operationId', 160),
	)
})
