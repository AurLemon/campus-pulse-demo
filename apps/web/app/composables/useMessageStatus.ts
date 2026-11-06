export function useMessageStatus(userId: () => string | undefined) {
	const unread = ref(0)
	let timer: ReturnType<typeof setInterval> | undefined
	let busy = false
	let disposed = false
	async function update() {
		const id = userId()
		if (!id || disposed || busy || document.visibilityState !== 'visible')
			return
		busy = true
		try {
			const [summary] = await Promise.all([
				$fetch<{ totalUnread: number }>('/api/messages/summary'),
				$fetch('/api/presence', { method: 'POST', body: { active: true } }),
			])
			if (userId() === id) unread.value = summary.totalUnread
		} catch {
			/* Background status never interrupts the current page */
		} finally {
			busy = false
		}
	}
	watch(userId, () => {
		unread.value = 0
		if (import.meta.client) void update()
	})
	onMounted(() => {
		void update()
		timer = setInterval(update, 15000)
		document.addEventListener('visibilitychange', update)
	})
	onBeforeUnmount(() => {
		disposed = true
		clearInterval(timer)
		document.removeEventListener('visibilitychange', update)
	})
	return { unread }
}
