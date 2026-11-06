<script setup lang="ts">
import type { SidebarData } from '@campus/contracts'
const apiError = useApiError()

const { t } = useI18n(),
	date = useCampusDate(),
	{ topicLabel } = useTopics()
const fetcher = useRequestFetch()
const { data, refresh } = await useAsyncData('sidebar', () =>
	fetcher<SidebarData>('/api/sidebar'),
)
const editing = ref(false),
	saving = ref(false),
	error = ref('')
const selected = ref<string[]>([])
const { data: campus } = await useCampus()
function edit() {
	selected.value = Object.keys(data.value?.interests ?? {})
	editing.value = true
}
async function save() {
	saving.value = true
	error.value = ''
	try {
		await $fetch('/api/me/interests', {
			method: 'PATCH',
			body: {
				interests: Object.fromEntries(selected.value.map((tag) => [tag, 1])),
			},
		})
		editing.value = false
		await refresh()
	} catch (e) {
		error.value = apiError(e)
	} finally {
		saving.value = false
	}
}
function toggle(tag: string) {
	selected.value = selected.value.includes(tag)
		? selected.value.filter((t) => t !== tag)
		: [...selected.value, tag]
}
</script>
<template>
	<aside class="community-rail" tabindex="0">
		<section v-if="data?.user" class="rail-panel user-summary">
			<template v-if="data?.user"
				><div class="rail-user">
					<UserAvatar :src="data.user.avatar" :name="data.user.name" large />
					<div>
						<h2>{{ data.user.name }}</h2>
					</div>
				</div>
				<div class="user-counts">
					<NuxtLink :to="`/users/${data.user.id}?tab=registrations`"
						><strong>{{ data.counts.registrations }}</strong
						><span>{{ t('ui.myRegistrations') }}</span></NuxtLink
					><NuxtLink :to="`/users/${data.user.id}?tab=favorites`"
						><strong>{{ data.counts.favorites }}</strong
						><span>{{ t('ui.myFavorites') }}</span></NuxtLink
					><NuxtLink :to="`/users/${data.user.id}`"
						><strong>{{ data.counts.posts }}</strong
						><span>{{ t('ui.myPosts') }}</span></NuxtLink
					>
				</div></template
			>
		</section>
		<section v-if="data?.recommendations.length" class="rail-panel">
			<h2><UIcon name="i-lucide-sparkles" />{{ t('ui.topActivities') }}</h2>
			<ActivityLink
				v-for="(activity, i) in data.recommendations.slice(0, 3)"
				:key="activity.id"
				:id="activity.id"
				class="rail-activity"
				><span class="rail-rank">{{ i + 1 }}</span
				><ContentCover
					:title="activity.title"
					:media="activity.cover"
					:tags="activity.tags" />
				<div>
					<strong>{{ activity.title }}</strong
					><small>{{ date(activity.startsAt) }}</small>
				</div>
				<UIcon name="i-lucide-chevron-right"
			/></ActivityLink>
		</section>
		<section v-if="data?.user" class="rail-panel">
			<div class="rail-heading">
				<h2><UIcon name="i-lucide-calendar-days" />{{ t('ui.schedule') }}</h2>
				<NuxtLink :to="`/users/${data.user.id}?tab=registrations`">{{
					t('ui.seeAll')
				}}</NuxtLink>
			</div>
			<div v-if="data.schedule.length" class="schedule-list">
				<ActivityLink
					v-for="activity in data.schedule.slice(0, 3)"
					:key="activity.id"
					:id="activity.id"
					><span class="schedule-dot" />
					<div>
						<time>{{ date(activity.startsAt) }}</time
						><strong>{{ activity.title }}</strong
						><small>{{ activity.location }}</small>
					</div></ActivityLink
				>
			</div>
			<p v-else class="muted rail-empty">{{ t('ui.scheduleEmpty') }}</p>
		</section>
		<section v-if="data?.user" class="rail-panel">
			<div class="rail-heading">
				<h2><UIcon name="i-lucide-tags" />{{ t('ui.interests') }}</h2>
				<UButton size="xs" variant="ghost" color="neutral" @click="edit">{{
					t('ui.edit')
				}}</UButton>
			</div>
			<div class="interest-tags">
				<span v-for="tag in Object.keys(data.interests)" :key="tag"
					># {{ topicLabel(tag) }}</span
				>
			</div>
			<p v-if="!Object.keys(data.interests).length" class="muted small">
				{{ t('ui.myInterestHint') }}
			</p>
			<div v-if="editing" class="interest-editor">
				<div class="interest-tags">
					<button
						v-for="tag in campus?.topics"
						:key="tag"
						type="button"
						:class="{ selected: selected.includes(tag) }"
						:aria-pressed="selected.includes(tag)"
						@click="toggle(tag)"
					>
						{{ topicLabel(tag) }}
					</button>
				</div>
				<p v-if="error" class="error">{{ error }}</p>
				<UButton size="sm" :loading="saving" @click="save">{{
					t('ui.save')
				}}</UButton
				><UButton
					size="sm"
					variant="ghost"
					color="neutral"
					@click="editing = false"
					>{{ t('ui.cancel') }}</UButton
				>
			</div>
		</section>
	</aside>
</template>
