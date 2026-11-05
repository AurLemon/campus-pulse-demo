import type { Bootstrap } from '@campus/contracts'

interface ReadingSession {
	id: string
	elapsed: number
	previous: number
	visible: boolean
	pending?: Promise<void>
	closing?: Promise<void>
}

// The registry contains mounted client readers only. No request data is registered during SSR.
const readers = new Set<() => Promise<void>>()

export async function stopReadingSessions(): Promise<void> {
	if (!import.meta.client) return
	await Promise.allSettled([...readers].map((stop) => stop()))
}

export function useReadingSession(target: {
	postId?: string
	activityId?: string
}) {
	const { data: campus } = useNuxtData<Bootstrap>('campus')
	let mounted = false,
		disposed = false,
		generation = 0
	let active: ReadingSession | undefined
	let timer: ReturnType<typeof setInterval> | undefined
	let starting: Promise<void> | undefined
	let stopping: Promise<void> | undefined
	let stopDeadline: number | undefined

	function tick(session: ReadingSession) {
		const now = performance.now()
		if (session.visible)
			session.elapsed = Math.min(
				300000,
				session.elapsed + Math.min(Math.max(0, now - session.previous), 5000),
			)
		session.previous = now
	}

	function send(session: ReadingSession): Promise<void> {
		tick(session)
		if (session.closing || session.pending)
			return session.closing ?? session.pending!
		const request = $fetch(`/api/sessions/${session.id}`, {
			method: 'PATCH',
			body: { effectiveMs: Math.floor(session.elapsed), closed: false },
			timeout: 5000,
			retry: 0,
		})
			.then(() => {})
			.catch(() => {})
			.finally(() => {
				if (session.pending === request) session.pending = undefined
			})
		session.pending = request
		return request
	}

	function close(session: ReadingSession, deadline: number): Promise<void> {
		if (session.closing) return session.closing
		tick(session)
		session.visible = false
		const request = (async () => {
			await session.pending
			const remaining = deadline - Date.now()
			if (remaining <= 0) return
			await $fetch(`/api/sessions/${session.id}`, {
				method: 'PATCH',
				body: { effectiveMs: Math.floor(session.elapsed), closed: true },
				timeout: Math.min(5000, remaining),
				retry: 0,
				keepalive: true,
			}).catch(() => {})
		})()
		session.closing = request
		return request
	}

	function stop(): Promise<void> {
		if (stopping) return stopping
		generation++
		stopDeadline = Date.now() + 5000
		if (timer) clearInterval(timer)
		timer = undefined
		const session = active
		active = undefined
		const pendingStart = starting
		const request = Promise.allSettled([
			session ? close(session, stopDeadline) : Promise.resolve(),
			pendingStart ?? Promise.resolve(),
		])
			.then(() => {})
			.finally(() => {
				if (stopping === request) {
					stopping = undefined
					stopDeadline = undefined
				}
			})
		stopping = request
		return request
	}

	async function start(): Promise<void> {
		if (!mounted || disposed || active || starting) return
		const owner = campus.value?.user?.id
		if (!owner) return
		const epoch = ++generation
		const request = (async () => {
			try {
				const result = await $fetch<{ id: string }>('/api/sessions', {
					method: 'POST',
					body: target,
					timeout: 5000,
					retry: 0,
				})
				const session: ReadingSession = {
					id: result.id,
					elapsed: 0,
					previous: performance.now(),
					visible: document.visibilityState === 'visible',
				}
				if (
					disposed ||
					epoch !== generation ||
					owner !== campus.value?.user?.id
				) {
					await close(session, stopDeadline ?? Date.now() + 5000)
					return
				}
				active = session
				timer = setInterval(() => {
					if (active === session) void send(session)
				}, 5000)
			} catch {
				// Reading remains available when telemetry is unavailable.
			}
		})()
		starting = request
		await request
		if (starting === request) starting = undefined
	}

	async function restart() {
		const owner = campus.value?.user?.id
		await stop()
		if (mounted && !disposed && owner === campus.value?.user?.id) await start()
	}
	function visibility() {
		if (!active) return
		tick(active)
		active.visible = document.visibilityState === 'visible'
		void send(active)
	}
	const leave = () => {
		void stop()
	}
	watch(
		() => campus.value?.user?.id,
		(userId, previous) => {
			if (mounted && userId !== previous) void restart()
		},
		{ flush: 'sync' },
	)
	onMounted(() => {
		mounted = true
		readers.add(stop)
		document.addEventListener('visibilitychange', visibility)
		window.addEventListener('pagehide', leave)
		void start()
	})
	onBeforeUnmount(() => {
		disposed = true
		mounted = false
		readers.delete(stop)
		document.removeEventListener('visibilitychange', visibility)
		window.removeEventListener('pagehide', leave)
		void stop()
	})
}
