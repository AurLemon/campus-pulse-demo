import type { Bootstrap, Mutation, PostView } from '@campus/contracts'
import { stopReadingSessions } from './useReadingSession'

export interface FeedCacheEntry {
	items: PostView[]
	cursor: string | null
	hasMore: boolean
	newestAt: string | null
	sessionId: string
	filters: { tab: string; query: string; tag: string }
	scroll: { left: number; top: number }
	initialized: boolean
	updatedAt: number
}
const FEED_CACHE_LIMIT = 4
const FEED_CACHE_ITEMS = 2000
const FEED_CACHE_IDLE_MS = 30 * 60 * 1000
/** Data checkpoints only: no cached component/Suspense instances. */
export function useFeedCache() {
	const entries = useState<Record<string, FeedCacheEntry>>(
		'feed-cache',
		() => ({}),
	)
	function read(viewer: string) {
		const entry = entries.value[viewer]
		return entry && Date.now() - entry.updatedAt < FEED_CACHE_IDLE_MS
			? entry
			: undefined
	}
	function write(viewer: string, entry: Omit<FeedCacheEntry, 'updatedAt'>) {
		// Keep the last complete checkpoint, including its cursor, if an active feed grows past the memory cap.
		if (entry.items.length > FEED_CACHE_ITEMS) return
		const now = Date.now()
		entries.value = Object.fromEntries(
			[
				[viewer, { ...entry, items: entry.items.slice(), updatedAt: now }],
				...Object.entries(entries.value).filter(
					([key, value]) =>
						key !== viewer && now - value.updatedAt < FEED_CACHE_IDLE_MS,
				),
			].slice(0, FEED_CACHE_LIMIT),
		)
	}
	function clear() {
		entries.value = {}
	}
	return { read, write, clear }
}

export async function useCampus() {
	// Custom async composables do not receive the SFC top-level-await context transform.
	// Capture every Nuxt/Vue composable before awaiting the shared bootstrap promise.
	const nuxtApp = useNuxtApp()
	const { openAuth } = useAuthOverlay()
	const authEpoch = useState('auth-epoch', () => 0)
	const requestFetch = useRequestFetch()
	const feedCache = useFeedCache()
	const postRecords = useState<Record<string, PostView>>(
		'post-records',
		() => ({}),
	)
	const request = useAsyncData('campus', () =>
		requestFetch<Bootstrap>('/api/bootstrap'),
	)
	const { data, status, error, refresh } = request
	const user = computed(() => data.value?.user ?? null)
	watch(
		() => user.value?.id ?? 'guest',
		(next, previous) => {
			if (next !== previous) {
				feedCache.clear()
				postRecords.value = {}
			}
		},
		{ flush: 'sync' },
	)
	async function act(body: Mutation) {
		if (!user.value) {
			await openAuth()
			return
		}
		await $fetch('/api/actions', { method: 'POST', body })
		await nuxtApp.runWithContext(() => refreshNuxtData('sidebar'))
	}
	async function logout() {
		await stopReadingSessions()
		await $fetch('/api/auth/logout', { method: 'POST' })
		feedCache.clear()
		postRecords.value = {}
		authEpoch.value++
		await refresh()
		await nuxtApp.runWithContext(() => refreshNuxtData())
		await nuxtApp.runWithContext(() => navigateTo('/'))
	}
	await request
	return { data, user, status, error, refresh, act, logout }
}

export function useApiError() {
	const { t, te } = useI18n()
	return (error: unknown) => {
		const e = error as { data?: { data?: { code?: string }; code?: string } }
		const code = e?.data?.data?.code ?? e?.data?.code
		if (code === 'UNAUTHORIZED') return t('ui.sessionRequired')
		if (code === 'FORBIDDEN') return t('ui.forbidden')
		return code && te(`community.errors.${code}`)
			? t(`community.errors.${code}`)
			: t('ui.error')
	}
}
export function useCampusDate() {
	const { locale } = useI18n()
	return (value: string) => {
		const date = new Date(value)
		return Number.isFinite(date.getTime())
			? new Intl.DateTimeFormat(locale.value, {
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'Asia/Shanghai',
				}).format(date)
			: ''
	}
}
export function useFieldErrors(prefix: string) {
	const { t } = useI18n()
	const fields = ref<Record<string, string>>({})
	function clear() {
		fields.value = {}
	}
	async function capture(error: unknown) {
		const e = (
			error as {
				data?: {
					data?: { fields?: Record<string, string> }
					fields?: Record<string, string>
				}
			}
		)?.data
		fields.value = Object.fromEntries(
			Object.keys(e?.data?.fields ?? e?.fields ?? {}).map((key) => [
				key,
				t('ui.invalid'),
			]),
		)
		await nextTick()
		const key = Object.keys(fields.value)[0]
		if (key && import.meta.client)
			document.getElementById(`${prefix}-${key}`)?.focus()
	}
	return { fields, clear, capture }
}
export function useTopics() {
	const { t, te } = useI18n()
	const topics = [
		'photography',
		'technology',
		'sports',
		'art',
		'volunteer',
		'reading',
		'music',
		'career',
	]
	const topicLabel = (id: string) =>
		te(`community.topics.${id}`) ? t(`community.topics.${id}`) : id
	const topicId = (label: string) =>
		topics.find((id) => topicLabel(id) === label.trim()) ?? label.trim()
	return { topicLabel, topicId }
}
