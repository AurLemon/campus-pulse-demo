let current: ViewTransition | undefined
let sequence = 0

export function useThemeTransition() {
	const mode = useColorMode()
	async function setTheme(value: string) {
		if (mode.preference === value && !current) return
		const selection = ++sequence
		const update = async () => {
			if (selection !== sequence) return
			mode.preference = value
			await nextTick()
		}
		current?.skipTransition()
		if (
			!import.meta.client ||
			typeof document.startViewTransition !== 'function' ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			current = undefined
			if (import.meta.client)
				document.documentElement.classList.remove('theme-transition')
			await update()
			return
		}
		document.documentElement.classList.add('theme-transition')
		try {
			const transition = document.startViewTransition(update)
			current = transition
			void transition.ready.catch(() => {})
			await transition.updateCallbackDone.catch(update)
			await transition.finished.catch(() => {})
		} catch {
			await update()
		} finally {
			if (selection === sequence) {
				current = undefined
				document.documentElement.classList.remove('theme-transition')
			}
		}
	}
	return { setTheme }
}
