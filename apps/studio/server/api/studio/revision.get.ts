import { readStudioRevision } from '../../utils/snapshot'
export default defineEventHandler(async () => ({
	revision: await readStudioRevision(),
}))
