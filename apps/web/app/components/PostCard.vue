<script setup lang="ts">
import type { Bootstrap, PostView } from '@campus/contracts'
const props = defineProps<{ post: PostView }>()
const { t } = useI18n()
const { openPost } = usePostOverlay()
const { find, remember } = usePostRecords()
const post = computed(() => find(props.post.id) ?? props.post)
function open(event: MouseEvent) {
	remember(post.value)
	openPost(event, props.post.id)
}
function openCard(event: MouseEvent) {
	if (
		event.target instanceof Element &&
		event.target.closest('a, button, details, input, textarea, select')
	)
		return
	open(event)
}
const date = useCampusDate()
const { data: campus } = useNuxtData<Bootstrap>('campus')
const { openAuth } = useAuthOverlay()
const apiError = useApiError()
const liking = ref(false)
const message = ref('')
const bursting = ref(false)
let burstTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(burstTimer))
async function toggleLike() {
	if (liking.value) return
	if (!campus.value?.user) {
		await openAuth()
		return
	}
	const viewerId = campus.value.user.id
	const current = post.value
	liking.value = true
	message.value = ''
	try {
		await $fetch('/api/actions', {
			method: 'POST',
			body: {
				action: 'like',
				targetId: current.id,
				targetType: 'post',
				active: !current.viewer.liked,
			},
		})
		if (campus.value?.user?.id !== viewerId) return
		if (!current.viewer.liked) {
			clearTimeout(burstTimer)
			bursting.value = true
			burstTimer = setTimeout(() => (bursting.value = false), 700)
		}
		remember({
			...current,
			stats: {
				...current.stats,
				likes: Math.max(
					0,
					current.stats.likes + (current.viewer.liked ? -1 : 1),
				),
			},
			viewer: { ...current.viewer, liked: !current.viewer.liked },
		})
	} catch (failure) {
		if (campus.value?.user?.id === viewerId) message.value = apiError(failure)
	} finally {
		liking.value = false
	}
}
const cover = computed(() => post.value.media?.[0] ?? null)
</script>
<template>
	<article
		class="post-card content-card"
		:data-post-card="post.id"
		@click="openCard"
	>
		<NuxtLink
			:to="`/posts/${post.id}`"
			class="card-cover-link"
			:aria-label="post.title"
			@click="open"
		>
			<ContentCover
				:title="post.title"
				:poster-template="post.posterTemplate"
				:poster-aspect="post.posterAspect"
				:poster-highlight="post.posterHighlight"
				:tags="post.tags"
				:media="cover"
			>
				<span
					v-if="
						post.activity &&
						(!post.purpose ||
							post.purpose === 'RECRUITMENT' ||
							post.purpose === 'DISCUSSION')
					"
					class="cover-badge"
					:class="{ 'badge-open': post.activity.availability === 'OPEN' }"
					><UIcon name="i-lucide-calendar-days" />{{
						t(`ui.${post.activity.availability}`)
					}}</span
				>
				<span
					v-else-if="post.purpose && post.purpose !== 'DISCUSSION'"
					class="cover-badge"
					>{{ t(`ui.${post.purpose}`) }}</span
				>
			</ContentCover>
		</NuxtLink>
		<div class="card-copy">
			<NuxtLink :to="`/posts/${post.id}`" @click="open"
				><h2>{{ post.title }}</h2></NuxtLink
			>
			<p class="post-excerpt">
				<MentionText :text="post.body" :mentions="post.bodyMentions" />
			</p>
			<div v-if="post.activity" class="card-activity-meta">
				<span
					><UIcon name="i-lucide-clock-3" />{{
						date(post.activity.startsAt)
					}}</span
				><span
					><UIcon name="i-lucide-map-pin" />{{ post.activity.location }}</span
				>
			</div>
			<div class="card-footer">
				<NuxtLink :to="`/users/${post.author.id}`" class="author"
					><UserAvatar :src="post.author.avatar" :name="post.author.name" />
					<span>{{ post.author.name }}</span></NuxtLink
				><HeartReactionButton
					:liked="post.viewer.liked"
					:count="post.stats.likes"
					:busy="liking"
					:bursting="bursting"
					@click.stop="toggleLike"
				/>
			</div>
			<p v-if="message" class="error" role="alert">{{ message }}</p>
		</div>
	</article>
</template>
