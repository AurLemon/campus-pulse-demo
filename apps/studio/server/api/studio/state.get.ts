import { readStudioSnapshot } from '../../utils/snapshot'
export default defineEventHandler(async () => ({
	...(await readStudioSnapshot()),
	scope: 'live-product-readonly' as const,
}))
