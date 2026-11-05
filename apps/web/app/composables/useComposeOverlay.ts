export function useComposeOverlay() {
	const route = useRoute(),
		router = useRouter()
	const returnTo = useState<string | null>('compose-return-to', () => null)
	const origin = useState<{ left: number; top: number; path: string } | null>(
		'compose-scroll',
		() => null,
	)
	function composeLocation() {
		const query = { ...route.query }
		delete query.post
		delete query.activity
		delete query.auth
		delete query.next
		return { path: route.path, query: { ...query, compose: '1' } }
	}
	async function openCompose(event: MouseEvent) {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		event.preventDefault()
		if (route.query.compose === '1') return
		returnTo.value = route.fullPath
		origin.value = {
			left: window.scrollX,
			top: window.scrollY,
			path: route.path,
		}
		await router.push(composeLocation())
	}
	async function closeCompose() {
		if (route.query.compose !== '1') return
		if (returnTo.value && window.history.state?.back === returnTo.value)
			router.back()
		else {
			const query = { ...route.query }
			delete query.compose
			await router.replace({ path: route.path, query })
		}
	}
	return { composeLocation, openCompose, closeCompose, origin }
}
