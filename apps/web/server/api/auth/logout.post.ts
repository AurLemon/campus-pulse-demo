import { api } from '../../utils/api'
import { logout } from '@campus/domain/auth'
export default api(async (event) => {
	await logout(event)
	return { ok: true }
})
