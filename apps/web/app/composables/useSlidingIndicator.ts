/** One moving indicator shared by the active button, including horizontally scrolled groups. */
export function useSlidingIndicator(selected: () => string) {
	const container = ref<HTMLElement>()
	const position = reactive({ x: 0, width: 0, height: 0, ready: false })
	let observer: ResizeObserver | undefined
	let disposed = false
	function update() {
		const group = container.value
		const button = group?.querySelector<HTMLElement>(
			`button[data-value="${CSS.escape(selected())}"]`,
		)
		if (!group || !button) return
		position.x = button.offsetLeft
		position.width = button.offsetWidth
		position.height = button.offsetHeight
		position.ready = true
	}
	watch(selected, async () => {
		await nextTick()
		if (!disposed) update()
	})
	onMounted(() => {
		observer = new ResizeObserver(update)
		if (container.value) {
			observer.observe(container.value)
			for (const button of container.value.querySelectorAll('button'))
				observer.observe(button)
		}
		update()
		void document.fonts.ready.then(() => {
			if (!disposed) update()
		})
	})
	onBeforeUnmount(() => {
		disposed = true
		observer?.disconnect()
	})
	const style = computed(() => ({
		transform: `translateX(${position.x}px)`,
		width: `${position.width}px`,
		height: `${position.height}px`,
		opacity: position.ready ? 1 : 0,
	}))
	return { container, style }
}
