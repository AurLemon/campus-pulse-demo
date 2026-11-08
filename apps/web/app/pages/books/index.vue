<script setup lang="ts">
import type { BookView } from '@campus/contracts/books'
const { t } = useI18n(),
	{ topicLabel } = useTopics(),
	route = useRoute(),
	router = useRouter(),
	request = useRequestFetch(),
	{ user } = await useCampus()
interface BookPage {
	items: BookView[]
	total: number
	hasMore: boolean
	tags: string[]
}
function readFilters() {
	return {
		q: String(route.query.q ?? ''),
		mode: String(route.query.mode ?? 'hybrid'),
		tag: String(route.query.tag || '__all'),
		academic: route.query.academic === '1',
		crossDomain: route.query.crossDomain !== '0',
	}
}
const filters = reactive(readFilters())
const { q, mode, tag, academic, crossDomain } = toRefs(filters)
const query = computed(() => ({
	q: q.value,
	mode: mode.value,
	tag: tag.value === '__all' ? '' : tag.value,
	academic: academic.value ? '1' : '',
	crossDomain: crossDomain.value ? '1' : '0',
}))
const { data: initial, error: initialError } = await useAsyncData(
	'book-list',
	() => request<BookPage>('/api/books', { query: { ...query.value, page: 1 } }),
)
const items = ref(initial.value?.items ?? [])
const total = ref(initial.value?.total ?? 0)
const tags = ref(initial.value?.tags ?? [])
const hasMore = ref(initial.value?.hasMore ?? false)
const busy = ref(false)
const error = ref(!!initialError.value)
const sentinel = ref<HTMLElement>()
const selectedBook = computed(() =>
	typeof route.query.book === 'string' ? route.query.book : '',
)
let page = 1
let generation = 0
let controller: AbortController | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
let continuation: ReturnType<typeof setTimeout> | undefined
let observer: IntersectionObserver | undefined
let disposed = false
let pendingReset = false
let nextAutomaticAt = 0
function canContinue() {
	return (
		!disposed &&
		!document.hidden &&
		!selectedBook.value &&
		!pendingReset &&
		!busy.value &&
		!error.value &&
		hasMore.value &&
		!!sentinel.value &&
		sentinel.value.getBoundingClientRect().top <= innerHeight + 180
	)
}
function scheduleMore() {
	if (!canContinue() || continuation) return
	continuation = setTimeout(
		() => {
			continuation = undefined
			if (!canContinue()) return
			nextAutomaticAt = performance.now() + 1000
			void load()
		},
		Math.max(0, nextAutomaticAt - performance.now()),
	)
}
async function load(reset = false) {
	if (disposed || (!reset && (busy.value || pendingReset || !hasMore.value)))
		return
	if (reset) {
		generation++
		controller?.abort()
		page = 0
		items.value = []
		hasMore.value = false
		pendingReset = false
	}
	const version = generation
	const nextPage = page + 1
	const requestController = new AbortController()
	controller = requestController
	busy.value = true
	error.value = false
	try {
		const result = await request<BookPage>('/api/books', {
			query: { ...query.value, page: nextPage },
			signal: requestController.signal,
		})
		if (disposed || version !== generation) return
		const known = new Set(items.value.map((book) => book.id))
		items.value.push(...result.items.filter((book) => !known.has(book.id)))
		total.value = result.total
		tags.value = result.tags
		hasMore.value = result.hasMore
		page = nextPage
	} catch {
		if (
			!disposed &&
			version === generation &&
			!requestController.signal.aborted
		)
			error.value = true
	} finally {
		if (!disposed && version === generation) {
			busy.value = false
			controller = undefined
			await nextTick()
			scheduleMore()
		}
	}
}
function reset() {
	clearTimeout(debounce)
	clearTimeout(continuation)
	continuation = undefined
	generation++
	controller?.abort()
	controller = undefined
	busy.value = true
	pendingReset = true
	error.value = false
	items.value = []
	hasMore.value = false
	total.value = 0
	debounce = setTimeout(() => {
		const { page: _page, ...rest } = route.query
		void router.replace({ query: { ...rest, ...query.value } })
		void load(true)
	}, 300)
}
watch(query, reset, { flush: 'sync' })
watch(() => user.value?.id, reset, { flush: 'sync' })
watch(
	() => [
		route.query.q,
		route.query.mode,
		route.query.tag,
		route.query.academic,
		route.query.crossDomain,
	],
	() => {
		const next = readFilters()
		if (JSON.stringify(next) !== JSON.stringify(filters))
			Object.assign(filters, next)
	},
)
watch(selectedBook, () => void nextTick(scheduleMore))
onMounted(() => {
	observer = new IntersectionObserver(scheduleMore, { rootMargin: '180px' })
	if (sentinel.value) observer.observe(sentinel.value)
	window.addEventListener('scroll', scheduleMore, { passive: true })
	window.addEventListener('resize', scheduleMore)
	document.addEventListener('visibilitychange', scheduleMore)
	scheduleMore()
})
onBeforeUnmount(() => {
	disposed = true
	generation++
	controller?.abort()
	clearTimeout(debounce)
	clearTimeout(continuation)
	observer?.disconnect()
	window.removeEventListener('scroll', scheduleMore)
	window.removeEventListener('resize', scheduleMore)
	document.removeEventListener('visibilitychange', scheduleMore)
})
const modes = computed(() =>
	['all', 'hybrid', 'user', 'item', 'content', 'mine'].map((value) => ({
		value,
		label: t(`books.${value}`),
	})),
)
const topics = computed(() => [
	{ value: '__all', label: t('books.allTags') },
	...tags.value.map((value) => ({
		value,
		label: topicLabel(value),
	})),
])
const open = computed({
	get: () => !!selectedBook.value,
	set: (value: boolean) => {
		if (!value) {
			const { book: _book, ...rest } = route.query
			void router.push({ query: rest })
		}
	},
})
</script>
<template>
	<div>
		<div class="book-filters">
			<UInput
				v-model="q"
				icon="i-lucide-search"
				:placeholder="t('books.search')"
				:aria-label="t('books.search')"
				:maxlength="120"
				class="feed-search book-search"
				size="lg"
			/><USelect
				v-model="mode"
				:items="modes"
				:aria-label="t('books.title')"
			/><USelect
				v-model="tag"
				:items="topics"
				:aria-label="t('books.allTags')"
			/>
			<UPopover :content="{ align: 'end', side: 'bottom' }">
				<UButton
					color="neutral"
					variant="ghost"
					icon="i-lucide-sliders-horizontal"
					:aria-label="t('ui.filter')"
					:aria-pressed="academic || !crossDomain"
				/>
				<template #content>
					<div class="book-filter-options">
						<UCheckbox v-model="academic" :label="t('books.academic')" />
						<UCheckbox v-model="crossDomain" :label="t('books.crossDomain')" />
					</div>
				</template>
			</UPopover>
			<NuxtLink v-if="user" to="/books/history"
				><UButton color="neutral" variant="ghost" icon="i-lucide-history">{{
					t('books.history')
				}}</UButton></NuxtLink
			>
		</div>
		<p v-if="!busy || items.length" class="book-count">
			{{ t('books.count', { count: total }) }}
		</p>
		<div v-if="items.length" class="book-grid">
			<BookCard v-for="book in items" :key="book.id" :book="book" />
		</div>
		<p v-else-if="!busy && !error" class="empty-state">
			{{ t('books.empty') }}
		</p>
		<div ref="sentinel" class="book-pagination" aria-live="polite">
			<p v-if="busy" role="status" class="brand-loading">
				<BrandMark compact />{{ t('books.loading') }}
			</p>
			<template v-else-if="error">
				<p role="alert">{{ t('books.error') }}</p>
				<UButton color="neutral" variant="soft" @click="load(!items.length)">{{
					t('books.retry')
				}}</UButton>
			</template>
			<p v-else-if="items.length && !hasMore" class="muted">
				{{ t('ui.feedFinished') }}
			</p>
		</div>
		<UModal
			v-model:open="open"
			:title="t('books.title')"
			:ui="{
				content: 'post-overlay-modal book-overlay-modal ring-0 divide-y-0',
				overlay: 'post-overlay-backdrop',
			}"
		>
			<template #content>
				<UButton
					class="post-overlay-close"
					icon="i-lucide-x"
					color="neutral"
					variant="soft"
					:aria-label="t('ui.close')"
					@click="open = false"
				/>
				<Suspense>
					<BookDetail
						v-if="selectedBook"
						:key="selectedBook"
						:id="selectedBook"
						@changed="load(true)"
					/>
					<template #fallback>
						<p class="empty-state" role="status">{{ t('books.loading') }}</p>
					</template>
				</Suspense>
			</template>
		</UModal>
	</div>
</template>
<style scoped>
.book-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	align-items: center;
	margin-bottom: 16px;
}
.book-search {
	flex: 1;
	width: auto;
	min-width: 220px;
	max-width: none;
}
.book-filter-options {
	display: grid;
	gap: 18px;
	padding: 20px;
}
.book-count {
	margin-bottom: 24px;
	color: var(--ui-text-muted);
	font-size: 12px;
	text-align: right;
}
:global(.book-overlay-modal) {
	--card-x: 0px;
	--card-y: 12px;
	--card-sx: 0.98;
	--card-sy: 0.98;
	width: min(1040px, calc(100vw - 96px));
	height: min(760px, calc(100dvh - 64px));
}
.book-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 18px;
}
.book-pagination {
	display: flex;
	justify-content: center;
	gap: 18px;
	align-items: center;
	padding: 30px 0;
	font-size: 13px;
}
@media (min-width: 1400px) {
	.book-grid {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
}
@media (max-width: 700px) {
	.book-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.book-search {
		flex-basis: 100%;
	}
	:global(.book-overlay-modal) {
		width: calc(100vw - 24px);
		height: calc(100dvh - 24px);
		border-radius: 16px;
	}
}
</style>
