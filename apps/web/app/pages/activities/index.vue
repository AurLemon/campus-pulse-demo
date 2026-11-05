<script setup lang="ts">
import type { ActivityView } from '@campus/contracts'
const apiError = useApiError()

const { t } = useI18n(),
	{ topicLabel } = useTopics(),
	fetcher = useRequestFetch(),
	route = useRoute(),
	router = useRouter()
const { data: campus, user } = await useCampus()
const { openActivity } = useActivityOverlay()
function create(event: MouseEvent) {
	void openActivity(event, 'new')
}
function routeFilters() {
	return {
		query: typeof route.query.q === 'string' ? route.query.q : '',
		tag: typeof route.query.tag === 'string' ? route.query.tag : '__all',
		location:
			typeof route.query.campus === 'string' ? route.query.campus : '__all',
	}
}
const initial = routeFilters()
const query = ref(initial.query),
	tag = ref(initial.tag),
	location = ref(initial.location)
const applied = reactive({ ...initial })
let debounce: ReturnType<typeof setTimeout> | undefined
let restoring = false,
	writing = false,
	writeSequence = 0
function restoreFilters() {
	if (route.path !== '/activities') return
	const next = routeFilters()
	if (
		next.query === query.value &&
		next.tag === tag.value &&
		next.location === location.value
	)
		return
	clearTimeout(debounce)
	restoring = true
	query.value = next.query
	tag.value = next.tag
	location.value = next.location
	Object.assign(applied, next)
	restoring = false
}
async function commitFilters() {
	Object.assign(applied, {
		query: query.value,
		tag: tag.value,
		location: location.value,
	})
	const fields = {
		q: query.value,
		tag: tag.value === '__all' ? '' : tag.value,
		campus: location.value === '__all' ? '' : location.value,
	}
	const next = Object.fromEntries([
		...Object.entries(route.query).filter(
			([key]) => !Object.hasOwn(fields, key),
		),
		...Object.entries(fields).filter(([, value]) => !!value),
	])
	if (JSON.stringify(next) === JSON.stringify(route.query)) return
	const sequence = ++writeSequence
	writing = true
	try {
		await router.push({ query: next })
	} finally {
		if (sequence === writeSequence) {
			writing = false
			restoreFilters()
		}
	}
}
watch(
	[query, tag, location],
	(next, previous) => {
		if (restoring) return
		clearTimeout(debounce)
		if (next[1] !== previous[1] || next[2] !== previous[2]) void commitFilters()
		else debounce = setTimeout(() => void commitFilters(), 300)
	},
	{ flush: 'sync' },
)
watch(
	() => JSON.stringify(routeFilters()),
	() => {
		if (!writing) restoreFilters()
	},
)
onBeforeUnmount(() => clearTimeout(debounce))
const { data, status, error, refresh } = await useAsyncData(
	'activity-list',
	() =>
		fetcher<{ items: ActivityView[] }>('/api/activities', {
			query: {
				q: applied.query,
				tag: applied.tag === '__all' ? '' : applied.tag,
				campus: applied.location === '__all' ? '' : applied.location,
				all: 1,
			},
		}),
	{ watch: [() => JSON.stringify(applied)] },
)
const topicItems = computed(() => [
	{ label: t('ui.allTopics'), value: '__all' },
	...(campus.value?.topics ?? []).map((value) => ({
		value,
		label: topicLabel(value),
	})),
])
const campusItems = computed(() => [
	{ label: t('ui.allCampuses'), value: '__all' },
	...(campus.value?.campuses ?? []).map((value) => ({ value, label: value })),
])
</script>
<template>
	<div>
		<div class="activity-filters discovery-header">
			<UInput
				id="activity-search"
				v-model="query"
				:maxlength="120"
				class="feed-search activity-search"
				size="lg"
				icon="i-lucide-search"
				:placeholder="t('ui.search')"
				:aria-label="t('ui.search')"
			/><USelect
				v-model="location"
				class="activity-filter-select"
				:items="campusItems"
				:aria-label="t('ui.campus')"
			/><USelect
				v-model="tag"
				class="activity-filter-select"
				:items="topicItems"
				:aria-label="t('ui.interests')"
			/>
			<UButton
				v-if="user?.role === 'ORGANIZER' || user?.role === 'ADMIN'"
				icon="i-lucide-plus"
				color="primary"
				variant="soft"
				@click="create"
				>{{ t('ui.activityCreate') }}</UButton
			>
		</div>
		<p v-if="status === 'pending'" class="empty-state">{{ t('ui.loading') }}</p>
		<div v-else-if="error" class="empty-state">
			<p class="error">{{ apiError(error) }}</p>
			<UButton @click="refresh()">{{ t('ui.retry') }}</UButton>
		</div>
		<MasonryFeed v-else-if="data?.items.length" :items="data.items"
			><template #default="{ item }"><ActivityCard :activity="item" /></template
		></MasonryFeed>
		<div v-else class="empty-state">
			<h2>{{ t('ui.noResult') }}</h2>
			<p>{{ t('ui.emptyHint') }}</p>
		</div>
	</div>
</template>
