<script setup lang="ts">
import type { ActivityDetail } from '@campus/contracts'
const props = withDefaults(
	defineProps<{ activityId: string; embedded?: boolean }>(),
	{ embedded: false },
)
const apiError = useApiError()
const { t } = useI18n(),
	{ topicLabel } = useTopics(),
	fetcher = useRequestFetch(),
	date = useCampusDate()
const { data, error, status, refresh } = await useAsyncData(
	`activity-${props.activityId}`,
	() => fetcher<ActivityDetail>(`/api/activities/${props.activityId}`),
)
const loadError = shallowRef(error.value)
watch(
	[error, status],
	([failure, requestStatus]) => {
		if (failure) loadError.value = failure
		else if (requestStatus === 'success') loadError.value = undefined
	},
	{ flush: 'sync' },
)
if (error.value && !props.embedded && import.meta.server) {
	const failure = error.value as {
		statusCode?: number
		status?: number
		response?: { status?: number }
	}
	const code =
		failure.statusCode ?? failure.status ?? failure.response?.status ?? 500
	setResponseStatus(
		Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500,
	)
}
useReadingSession({ activityId: String(props.activityId) })
</script>
<template>
	<div
		v-if="data"
		class="reading-page activity-detail"
		:class="{ 'embedded-activity': embedded }"
	>
		<NuxtLink v-if="!embedded" to="/activities" class="back-link"
			><UIcon name="i-lucide-arrow-left" />{{ t('ui.activities') }}</NuxtLink
		>
		<div class="activity-content">
			<MediaGallery
				:title="data.activity.title"
				:poster-template="data.activity.posterTemplate"
				:poster-aspect="data.activity.posterAspect"
				:poster-highlight="data.activity.posterHighlight"
				:tags="data.activity.tags"
				:media="data.activity.cover ? [data.activity.cover] : []"
			/>
			<div class="activity-thread" :tabindex="embedded ? 0 : undefined">
				<div class="activity-detail-body">
					<span class="status-pill">{{
						t(`ui.${data.activity.availability}`)
					}}</span>
					<h1>{{ data.activity.title }}</h1>
					<NuxtLink :to="`/users/${data.activity.organizer.id}`" class="author"
						><UserAvatar
							:src="data.activity.organizer.avatar"
							:name="data.activity.organizer.name"
						/>{{ data.activity.organizer.name }}
						<span class="muted">{{ t('ui.organizer') }}</span></NuxtLink
					>
					<dl class="activity-facts">
						<div>
							<dt><UIcon name="i-lucide-clock-3" />{{ t('ui.time') }}</dt>
							<dd>
								{{ date(data.activity.startsAt) }} —
								{{ date(data.activity.endsAt) }}
							</dd>
						</div>
						<div>
							<dt><UIcon name="i-lucide-map-pin" />{{ t('ui.location') }}</dt>
							<dd>{{ data.activity.campus }} / {{ data.activity.location }}</dd>
						</div>
						<div>
							<dt><UIcon name="i-lucide-timer" />{{ t('ui.deadline') }}</dt>
							<dd>{{ date(data.activity.deadline) }}</dd>
						</div>
						<div>
							<dt><UIcon name="i-lucide-users" />{{ t('ui.capacity') }}</dt>
							<dd>
								{{
									t('ui.spots', {
										count: data.activity.stats.registrations,
										capacity: data.activity.capacity,
									})
								}}
							</dd>
						</div>
					</dl>
					<div class="tags">
						<span v-for="tag in data.activity.tags" :key="tag"
							>#{{ topicLabel(tag) }}</span
						>
					</div>
					<div class="article-body">{{ data.activity.body }}</div>
					<div class="activity-action-dock">
						<InteractionBar
							:item="data.activity"
							type="activity"
							@refresh="refresh()"
						/>
					</div>
				</div>
				<section class="related-posts">
					<h2>{{ t('ui.relatedPosts') }}</h2>
					<MasonryFeed v-if="data.posts.length" :items="data.posts"
						><template #default="{ item }"><PostCard :post="item" /></template
					></MasonryFeed>
					<p v-else class="muted">{{ t('ui.empty') }}</p>
				</section>
			</div>
		</div>
	</div>
	<section
		v-else-if="loadError"
		class="detail-error-state post-overlay-error"
		:class="{ 'embedded-detail-error': embedded }"
		role="alert"
		:aria-busy="status === 'pending'"
	>
		<UIcon
			name="i-lucide-cloud-alert"
			class="detail-error-state__icon"
			aria-hidden="true"
		/>
		<h2 class="detail-error-state__title">{{ t('ui.error') }}</h2>
		<p
			v-if="apiError(loadError) !== t('ui.error')"
			class="detail-error-state__message"
		>
			{{ apiError(loadError) }}
		</p>
		<UButton
			class="detail-error-state__retry"
			color="neutral"
			variant="soft"
			:loading="status === 'pending'"
			:disabled="status === 'pending'"
			@click="refresh()"
			>{{ t(status === 'pending' ? 'ui.loading' : 'ui.retry') }}</UButton
		>
	</section>
</template>
