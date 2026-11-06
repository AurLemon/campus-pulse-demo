<script setup lang="ts">
import type { ActivityView } from '@campus/contracts'
const props = defineProps<{ activity: ActivityView }>()
const { openActivity } = useActivityOverlay()
function openCard(event: MouseEvent) {
	if (
		event.target instanceof Element &&
		event.target.closest('a, button, details, input, textarea, select')
	)
		return
	void openActivity(event, props.activity.id)
}
const { t } = useI18n(),
	date = useCampusDate()
</script>
<template>
	<article
		class="activity-card content-card"
		:data-activity-card="activity.id"
		@click="openCard"
	>
		<ActivityLink :id="activity.id" class="card-cover-link"
			><ContentCover
				:title="activity.title"
				:poster-template="activity.posterTemplate"
				:poster-aspect="activity.posterAspect"
				:poster-highlight="activity.posterHighlight"
				:tags="activity.tags"
				:media="activity.cover"
				><span
					class="cover-badge"
					:class="{ 'badge-open': activity.availability === 'OPEN' }"
					>{{ t(`ui.${activity.availability}`) }}</span
				></ContentCover
			></ActivityLink
		>
		<div class="card-copy">
			<ActivityLink :id="activity.id"
				><h2>{{ activity.title }}</h2></ActivityLink
			>
			<p class="post-excerpt">{{ activity.body }}</p>
			<div class="card-activity-meta">
				<span
					><UIcon name="i-lucide-clock-3" />{{ date(activity.startsAt) }}</span
				><span><UIcon name="i-lucide-map-pin" />{{ activity.location }}</span>
			</div>
			<div class="card-footer">
				<NuxtLink :to="`/users/${activity.organizer.id}`" class="author"
					><UserAvatar
						:src="activity.organizer.avatar"
						:name="activity.organizer.name"
					/><span>{{ activity.organizer.name }}</span></NuxtLink
				><span class="small muted">{{
					t('ui.spots', {
						count: activity.stats.registrations,
						capacity: activity.capacity,
					})
				}}</span>
			</div>
		</div>
	</article>
</template>
