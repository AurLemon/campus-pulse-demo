type ThemePreference = 'light' | 'dark' | 'system'

export function useStudioTheme() {
	const mode = useColorMode()
	let current: ViewTransition | undefined
	let sequence = 0

	async function selectTheme(preference: ThemePreference) {
		if (mode.preference === preference && !current) return
		const selection = ++sequence
		const update = async () => {
			if (selection !== sequence) return
			mode.preference = preference
			await nextTick()
		}
		if (
			!import.meta.client ||
			typeof document.startViewTransition !== 'function' ||
			matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			await update()
			return
		}
		current?.skipTransition()
		try {
			const transition = document.startViewTransition(update)
			current = transition
			// Skipping or navigating away can reject ready, even after the DOM update succeeds.
			void transition.ready.catch(() => {})
			await transition.updateCallbackDone.catch(async () => {
				if (current === transition) await update()
			})
			await transition.finished.catch(() => {})
			if (current === transition) current = undefined
		} catch {
			await update()
		}
	}

	onBeforeUnmount(() => {
		sequence++
		current?.skipTransition()
	})
	return { mode, selectTheme }
}
