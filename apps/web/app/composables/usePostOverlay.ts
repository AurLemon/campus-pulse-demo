interface CardOrigin {
	left: number
	top: number
	width: number
	height: number
	scrollX: number
	scrollY: number
}
export function usePostOverlay() {
	const route = useRoute(),
		router = useRouter()
	const origin = useState<CardOrigin | null>('post-overlay-origin', () => null)
	const returnTo = useState<string | null>('post-overlay-return-to', () => null)
	async function openPost(event: MouseEvent, id: string) {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		event.preventDefault()
		const card = (event.currentTarget as HTMLElement)?.closest(
			'[data-post-card]',
		)
		const element = card?.querySelector('.content-cover') ?? card
		const rect = element?.getBoundingClientRect()
		origin.value = rect
			? {
					left: rect.left,
					top: rect.top,
					width: rect.width,
					height: rect.height,
					scrollX: window.scrollX,
					scrollY: window.scrollY,
				}
			: null
		if (!route.query.post) returnTo.value = route.fullPath
		const query = { ...route.query }
		delete query.activity
		query.post = id
		await (route.query.post ? router.replace : router.push)({
			path: route.path,
			query,
		})
	}
	async function closePost() {
		if (!route.query.post) return
		if (returnTo.value && window.history.state?.back === returnTo.value) {
			router.back()
		} else {
			const query = { ...route.query }
			delete query.post
			await router.replace({ path: route.path, query })
		}
	}
	return { origin, openPost, closePost }
}
