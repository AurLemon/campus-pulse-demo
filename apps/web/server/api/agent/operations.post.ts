import bridgeSecret from '#campus-studio-proof-secret'
import { verifyStudioRequest } from '../../../../../modules/studio-bridge-security'
import { readBody } from 'h3'
import { api, objectBody } from '@campus/domain/validation'
import {
	assertAgentRequest,
	performAgentOperation,
} from '@campus/domain/agent-access'
import type { AgentOperation } from '@campus/contracts/agents'
export default api(async (event) => {
	assertAgentRequest(
		event,
		import.meta.dev && verifyStudioRequest(event, bridgeSecret),
	)
	return performAgentOperation(
		objectBody(await readBody(event)) as unknown as AgentOperation,
	)
})
