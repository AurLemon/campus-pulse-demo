interface ActivityOrigin {
	left: number
	top: number
	width: number
	height: number
	scrollX: number
	scrollY: number
}
export function useActivityOverlay() {
	const route = useRoute(),
		router = useRouter()
	const origin = useState<ActivityOrigin | null>(
		'activity-overlay-origin',
		() => null,
	)
	const returnTo = useState<string | null>(
		'activity-overlay-return-to',
		() => null,
	)
	async function openActivity(event: MouseEvent, id: string) {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		event.preventDefault()
		const element =
			(event.currentTarget as HTMLElement)
				?.closest('[data-activity-card]')
				?.querySelector('.content-cover') ??
			(event.currentTarget as HTMLElement)
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
		if (!route.query.activity) returnTo.value = route.fullPath
		const { post: _post, ...baseQuery } = route.query
		const query = { ...baseQuery, activity: id }
		await (route.query.activity ? router.replace : router.push)({
			path: route.path,
			query,
		})
	}
	async function closeActivity() {
		if (!route.query.activity) return
		if (returnTo.value && window.history.state?.back === returnTo.value) {
			router.back()
		} else {
			const query = { ...route.query }
			delete query.activity
			await router.replace({ path: route.path, query })
		}
	}
	return { origin, openActivity, closeActivity }
}
