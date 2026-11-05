export function useAuthOverlay() {
	const route = useRoute()
	const router = useRouter()
	function authLocation(mode: 'login' | 'register' = 'login', next?: string) {
		return {
			path: route.path,
			query: { ...route.query, auth: mode, ...(next ? { next } : {}) },
		}
	}
	async function openAuth(mode: 'login' | 'register' = 'login', next?: string) {
		await (route.query.auth ? router.replace : router.push)(
			authLocation(mode, next),
		)
	}
	async function closeAuth(replace = false) {
		if (!route.query.auth) return
		const { auth: _auth, next: _next, ...query } = route.query
		const target = { path: route.path, query }
		if (
			!replace &&
			window.history.state?.back === router.resolve(target).fullPath
		)
			router.back()
		else await router.replace(target)
	}
	return { openAuth, closeAuth, authLocation }
}
