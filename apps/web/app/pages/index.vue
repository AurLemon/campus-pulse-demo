<script setup lang="ts">
import type { FeedPage, PostView } from '@campus/contracts'

const apiError = useApiError()
const { t } = useI18n(),
	{ topicLabel } = useTopics(),
	fetcher = useRequestFetch(),
	route = useRoute(),
	router = useRouter()
const { data: campus, user } = await useCampus()
const feedCache = useFeedCache()
const viewer = computed(() => user.value?.id ?? 'guest')
let owner = viewer.value
function readRouteFilters() {
	return {
		tab: route.query.tab === 'following' ? 'following' : 'recommended',
		query: typeof route.query.q === 'string' ? route.query.q : '',
		tag: typeof route.query.tag === 'string' ? route.query.tag : '',
	}
}
function sameFilters(
	a: { tab: string; query: string; tag: string },
	b: { tab: string; query: string; tag: string },
) {
	return a.tab === b.tab && a.query === b.query && a.tag === b.tag
}
const requestedFilters = readRouteFilters()
const cached = feedCache.read(owner)
const saved =
	cached && sameFilters(cached.filters, requestedFilters) ? cached : undefined
const tab = ref(requestedFilters.tab),
	query = ref(requestedFilters.query),
	tag = ref(requestedFilters.tag)
const { container: tabGroup, style: tabIndicatorStyle } = useSlidingIndicator(
	() => tab.value,
)
const { container: topicGroup, style: topicIndicatorStyle } =
	useSlidingIndicator(() => tag.value)
let routeWrite = 0,
	writingRoute = false
async function syncFilterRoute() {
	const filters = { tab: tab.value, query: query.value, tag: tag.value }
	if (route.path !== '/' || sameFilters(filters, readRouteFilters())) return
	const current = ++routeWrite
	writingRoute = true
	const fields = {
		q: filters.query,
		tag: filters.tag,
		tab: filters.tab === 'following' ? 'following' : '',
	}
	const next = Object.fromEntries([
		...Object.entries(route.query).filter(
			([key]) => !Object.hasOwn(fields, key),
		),
		...Object.entries(fields).filter(([, value]) => !!value),
	])
	try {
		await router.push({ query: next })
	} finally {
		if (current === routeWrite) {
			writingRoute = false
			restoreRouteFilters()
		}
	}
}
function restoreRouteFilters() {
	const next = readRouteFilters()
	if (
		route.path !== '/' ||
		sameFilters(next, { tab: tab.value, query: query.value, tag: tag.value })
	)
		return
	clearTimeout(debounce)
	restoring = true
	tab.value = next.tab
	query.value = next.query
	tag.value = next.tag
	restoring = false
	void load(true)
}

function asPage(entry: FeedCacheEntry): FeedPage {
	return {
		items: entry.items,
		nextCursor: entry.cursor,
		hasMore: entry.hasMore,
		newestAt: entry.newestAt,
		sessionId: entry.sessionId,
	}
}
const { data: initial, error: initialError } = await useAsyncData(
	`feed-initial:${owner}`,
	() =>
		fetcher<FeedPage>('/api/feed', {
			query: { limit: 18, tab: tab.value, q: query.value, tag: tag.value },
		}),
	{
		getCachedData: () => {
			const entry = feedCache.read(owner)
			return entry?.initialized && sameFilters(entry.filters, requestedFilters)
				? asPage(entry)
				: undefined
		},
	},
)
const items = ref<PostView[]>(initial.value?.items ?? []),
	cursor = ref(initial.value?.nextCursor ?? null),
	hasMore = ref(initial.value?.hasMore ?? false),
	newestAt = ref(initial.value?.newestAt ?? null),
	sessionId = ref(initial.value?.sessionId ?? '')
const busy = ref(false),
	expired = ref(false),
	message = ref(initialError.value ? apiError(initialError.value) : ''),
	sentinel = ref<HTMLElement>(),
	newContent = ref(false)
const overlayOpen = computed(() =>
	Boolean(
		route.query.post ||
		route.query.activity ||
		route.query.auth ||
		route.query.compose,
	),
)
const publishRevision = useState('feed-publish-revision', () => 0)
watch(publishRevision, () => {
	void load(true)
})
let automaticTimer: ReturnType<typeof setTimeout> | undefined
let nextAutomaticAt = 0
let generation = 0,
	observer: IntersectionObserver | undefined,
	checkTimer: ReturnType<typeof setInterval> | undefined,
	continuationTimer: ReturnType<typeof setInterval> | undefined,
	debounce: ReturnType<typeof setTimeout> | undefined,
	abort: AbortController | undefined
let initialized = !!initial.value,
	restoring = false,
	leaving = false
let loadedFilters = { tab: tab.value, query: query.value, tag: tag.value }
let scroll = saved?.scroll ?? { left: 0, top: 0 }
let positionPending = true,
	restorationScheduled = false,
	scrollObserved = false
let restorationFrame: number | undefined
function persist() {
	const matching =
		initialized &&
		loadedFilters.tab === tab.value &&
		loadedFilters.query === query.value &&
		loadedFilters.tag === tag.value
	feedCache.write(owner, {
		items: matching ? items.value : [],
		cursor: matching ? cursor.value : null,
		hasMore: matching ? hasMore.value : true,
		newestAt: matching ? newestAt.value : null,
		sessionId: matching ? sessionId.value : '',
		filters: { tab: tab.value, query: query.value, tag: tag.value },
		scroll,
		initialized: matching,
	})
}
function recordScroll() {
	if (positionPending || leaving || overlayOpen.value || route.path !== '/')
		return
	scroll = { left: window.scrollX, top: window.scrollY }
	scrollObserved = true
	scheduleMore()
}
function captureScroll() {
	recordScroll()
	persist()
}
function restorePosition() {
	if (!positionPending || restorationScheduled || overlayOpen.value) return
	restorationScheduled = true
	// Masonry has applied its row spans. Wait for the next complete layout/paint, then restore once.
	restorationFrame = requestAnimationFrame(() => {
		restorationFrame = requestAnimationFrame(() => {
			restorationFrame = undefined
			restorationScheduled = false
			if (leaving || overlayOpen.value) return
			window.scrollTo({ ...scroll, behavior: 'instant' })
			positionPending = false
			startObservers()
		})
	})
}

function filtersMatch() {
	return (
		loadedFilters.tab === tab.value &&
		loadedFilters.query === query.value &&
		loadedFilters.tag === tag.value
	)
}
async function load(reset = false) {
	if (!reset && !filtersMatch()) return
	if (busy.value && !reset) return
	const current = reset ? ++generation : generation,
		requestedOwner = owner
	const filters = { tab: tab.value, query: query.value, tag: tag.value }
	if (reset) {
		clearTimeout(automaticTimer)
		automaticTimer = undefined
		abort?.abort()
		items.value = []
		cursor.value = null
		hasMore.value = false
		initialized = false
		scroll = { left: 0, top: 0 }
		if (import.meta.client)
			window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
	}
	const controller = new AbortController()
	abort = controller
	busy.value = true
	message.value = ''
	expired.value = false
	try {
		const page = await $fetch<FeedPage>('/api/feed', {
			signal: controller.signal,
			query: {
				tab: filters.tab,
				q: filters.query,
				tag: filters.tag,
				limit: 18,
				...(!reset && cursor.value ? { cursor: cursor.value } : {}),
			},
		})
		if (current !== generation || requestedOwner !== owner) return
		items.value = reset
			? page.items
			: [
					...items.value,
					...page.items.filter(
						(p) => !items.value.some((old) => old.id === p.id),
					),
				]
		cursor.value = page.nextCursor
		hasMore.value = page.hasMore
		newestAt.value = page.newestAt
		sessionId.value = page.sessionId
		loadedFilters = filters
		initialized = true
		newContent.value = false
		persist()
	} catch (e) {
		if (
			current === generation &&
			requestedOwner === owner &&
			!controller.signal.aborted
		) {
			const failure = e as {
				data?: { data?: { code?: string }; code?: string }
			}
			expired.value =
				(failure.data?.data?.code ?? failure.data?.code) === 'FEED_EXPIRED'
			message.value = expired.value ? t('ui.feedExpired') : apiError(e)
		}
	} finally {
		if (current === generation && requestedOwner === owner) {
			busy.value = false
			abort = undefined
			if (import.meta.client) void nextTick(scheduleMore)
		}
	}
}
watch(
	() => JSON.stringify(readRouteFilters()),
	() => {
		if (!writingRoute) restoreRouteFilters()
	},
)
watch(
	[tab, tag],
	() => {
		if (!restoring) {
			clearTimeout(debounce)
			void syncFilterRoute()
			void load(true)
		}
	},
	{ flush: 'sync' },
)
watch(
	query,
	() => {
		if (!restoring) {
			clearTimeout(automaticTimer)
			automaticTimer = undefined
			clearTimeout(debounce)
			debounce = setTimeout(() => {
				void syncFilterRoute()
				void load(true)
			}, 300)
		}
	},
	{ flush: 'sync' },
)
watch(
	viewer,
	(value) => {
		generation++
		abort?.abort()
		clearTimeout(debounce)
		owner = value
		const filters = readRouteFilters()
		const candidate = feedCache.read(owner)
		const entry =
			candidate && sameFilters(candidate.filters, filters)
				? candidate
				: undefined
		restoring = true
		tab.value = filters.tab
		query.value = filters.query
		tag.value = filters.tag
		restoring = false
		items.value = entry?.items ?? []
		cursor.value = entry?.cursor ?? null
		hasMore.value = entry?.hasMore ?? false
		newestAt.value = entry?.newestAt ?? null
		sessionId.value = entry?.sessionId ?? ''
		initialized = !!entry?.initialized
		loadedFilters = { tab: tab.value, query: query.value, tag: tag.value }
		scroll = entry?.scroll ?? { left: 0, top: 0 }
		busy.value = false
		message.value = ''
		expired.value = false
		if (import.meta.client) window.scrollTo({ ...scroll, behavior: 'instant' })
		if (!initialized) void load(true)
	},
	{ flush: 'sync' },
)
async function checkNew() {
	if (
		document.hidden ||
		overlayOpen.value ||
		busy.value ||
		query.value ||
		tag.value
	)
		return
	try {
		const page = await $fetch<FeedPage>('/api/feed', {
			query: { tab: tab.value, limit: 1 },
		})
		newContent.value = !!(
			page.newestAt &&
			newestAt.value &&
			page.newestAt > newestAt.value
		)
	} catch {
		/* Polling does not interrupt reading. */
	}
}
function canLoadMore() {
	return (
		!leaving &&
		!document.hidden &&
		!overlayOpen.value &&
		!positionPending &&
		filtersMatch() &&
		hasMore.value &&
		!busy.value &&
		!message.value &&
		!!sentinel.value &&
		sentinel.value.getBoundingClientRect().top <= window.innerHeight + 160
	)
}
function scheduleMore() {
	if (!canLoadMore() || automaticTimer) return
	const wait = Math.max(0, nextAutomaticAt - performance.now())
	automaticTimer = setTimeout(() => {
		automaticTimer = undefined
		if (!canLoadMore()) return
		nextAutomaticAt = performance.now() + 1000
		void load()
	}, wait)
}
function feedMeasured() {
	restorePosition()
	scheduleMore()
}
function startObservers() {
	if (overlayOpen.value || positionPending) return
	observer ??= new IntersectionObserver(
		(entries) => {
			if (entries.some((e) => e.isIntersecting)) scheduleMore()
		},
		{ rootMargin: '160px' },
	)
	if (sentinel.value) observer.observe(sentinel.value)
	if (!checkTimer) checkTimer = setInterval(checkNew, 60000)
	if (!continuationTimer) continuationTimer = setInterval(scheduleMore, 1000)
}

watch(overlayOpen, (value) => {
	if (value) observer?.disconnect()
	else if (positionPending) void nextTick(restorePosition)
	else void nextTick(startObservers)
})
onMounted(async () => {
	window.addEventListener('scroll', recordScroll, { passive: true })
	document.addEventListener('visibilitychange', scheduleMore)
	window.addEventListener('focus', scheduleMore)
	await nextTick()
	if (!items.value.length) restorePosition()
	if (route.query.search)
		document.getElementById('feed-search')?.focus({ preventScroll: true })
})

watch(
	() => route.query.search,
	async (value) => {
		if (value) {
			await nextTick()
			document.getElementById('feed-search')?.focus()
		}
	},
)
onBeforeRouteUpdate(() => {
	captureScroll()
})
// A canonical link may begin leaving before the query modal replaces its navigation.
// Only a completed navigation away should keep automatic loading suspended.
const removeNavigationSettled = router.afterEach((to, _from, failure) => {
	if (failure || to.path === '/') {
		leaving = false
		if (import.meta.client) void nextTick(scheduleMore)
	}
})
onBeforeRouteLeave(() => {
	if (!scrollObserved) recordScroll()
	persist()
	leaving = true
})
onBeforeUnmount(() => {
	removeNavigationSettled()
	window.removeEventListener('scroll', recordScroll)
	document.removeEventListener('visibilitychange', scheduleMore)
	window.removeEventListener('focus', scheduleMore)
	if (continuationTimer) clearInterval(continuationTimer)
	if (restorationFrame !== undefined) cancelAnimationFrame(restorationFrame)
	if (!leaving) captureScroll()
	else persist()
	observer?.disconnect()
	clearTimeout(automaticTimer)
	if (checkTimer) clearInterval(checkTimer)
	clearTimeout(debounce)
	generation++
	abort?.abort()
})
persist()
</script>
<template>
	<div class="discovery-page">
		<header class="discovery-header">
			<div ref="tabGroup" class="feed-tabs sliding-group">
				<span
					class="feed-tab-indicator"
					:style="tabIndicatorStyle"
					aria-hidden="true"
				/>
				<button
					data-value="recommended"
					:class="{ active: tab === 'recommended' }"
					:aria-pressed="tab === 'recommended'"
					@click="tab = 'recommended'"
				>
					{{ t('ui.recommend') }}</button
				><button
					data-value="following"
					:class="{ active: tab === 'following' }"
					:aria-pressed="tab === 'following'"
					@click="tab = 'following'"
				>
					{{ t('ui.following') }}
				</button>
			</div>
			<UInput
				id="feed-search"
				:maxlength="120"
				v-model="query"
				class="feed-search"
				icon="i-lucide-search"
				:placeholder="t('ui.search')"
				:aria-label="t('ui.search')"
				size="lg"
			/>
			<UButton
				class="feed-refresh"
				icon="i-lucide-refresh-cw"
				color="neutral"
				variant="ghost"
				:aria-label="t('ui.refresh')"
				:loading="busy"
				@click="load(true)"
			/>
		</header>
		<div ref="topicGroup" class="topic-filter sliding-group">
			<span
				class="topic-indicator"
				:style="topicIndicatorStyle"
				aria-hidden="true"
			/>
			<button data-value="" :class="{ active: !tag }" @click="tag = ''">
				{{ t('ui.all') }}</button
			><button
				v-for="topic in campus?.topics"
				:key="topic"
				:data-value="topic"
				:class="{ active: tag === topic }"
				@click="tag = topic"
			>
				{{ topicLabel(topic) }}
			</button>
		</div>
		<UButton
			v-if="newContent"
			class="new-content-banner"
			variant="soft"
			block
			icon="i-lucide-arrow-up"
			@click="load(true)"
			>{{ t('ui.newContent') }}</UButton
		>
		<MasonryFeed v-if="items.length" :items="items" @measured="feedMeasured"
			><template #default="{ item }"><PostCard :post="item" /></template
		></MasonryFeed>
		<div v-else-if="!busy && !message" class="empty-state">
			<UIcon name="i-lucide-telescope" />
			<h2>{{ t('ui.empty') }}</h2>
			<p>{{ t('ui.emptyHint') }}</p>
			<UButton to="/activities" variant="soft">{{
				t('ui.activities')
			}}</UButton>
		</div>
		<div ref="sentinel" class="feed-sentinel">
			<p v-if="busy" role="status" class="brand-loading">
				<BrandMark compact />{{ t('ui.loading') }}
			</p>
			<template v-else-if="message"
				><p class="error" role="alert">{{ message }}</p>
				<UButton @click="load(expired || !items.length)">{{
					t(expired ? 'ui.refresh' : 'ui.retry')
				}}</UButton></template
			>
			<p v-else-if="items.length && !hasMore" class="muted small" role="status">
				{{ t('ui.feedFinished') }}
			</p>
			<p v-else-if="items.length && hasMore" class="muted small" role="status">
				{{ t('ui.feedContinue') }}
			</p>
			<UButton
				v-if="items.length && !hasMore && !busy && !message"
				color="neutral"
				variant="ghost"
				size="sm"
				@click="load(true)"
				>{{ t('ui.refresh') }}</UButton
			>
		</div>
	</div>
</template>
