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
			<p class="post-excerpt">{{ post.body }}</p>
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
					><UserAvatar :name="post.author.name" />
					<span>{{ post.author.name }}</span></NuxtLink
				><button
					type="button"
					class="card-heart"
					:class="{ 'is-liked': post.viewer.liked, 'is-bursting': bursting }"
					:aria-label="t(post.viewer.liked ? 'ui.liked' : 'ui.like')"
					:aria-pressed="post.viewer.liked"
					:disabled="liking"
					@click.stop="toggleLike"
				>
					<span class="card-heart-glyph"
						><ReactionIcon kind="heart" :active="post.viewer.liked" /><span
							v-if="bursting"
							class="card-heart-particle"
							aria-hidden="true"
							><ReactionIcon kind="heart" active /></span></span
					>{{ post.stats.likes }}
				</button>
			</div>
			<p v-if="message" class="error" role="alert">{{ message }}</p>
		</div>
	</article>
</template>

<style scoped>
.card-heart-glyph {
	position: relative;
	display: flex;
}
.card-heart-glyph :deep(svg) {
	width: 15px;
	height: 15px;
}
.is-bursting .card-heart-glyph > :first-child {
	animation: card-heart-pop 450ms ease;
}
.card-heart-particle {
	position: absolute;
	inset: 0;
	pointer-events: none;
	animation: card-heart-float 700ms ease-out forwards;
}
@keyframes card-heart-pop {
	0%,
	100% {
		transform: scale(1);
	}
	35% {
		transform: scale(1.3) rotate(-10deg);
	}
	65% {
		transform: scale(0.92);
	}
}
@keyframes card-heart-float {
	0% {
		opacity: 0;
		transform: translateY(0) scale(0.6);
	}
	20% {
		opacity: 0.85;
	}
	100% {
		opacity: 0;
		transform: translate(7px, -30px) scale(0.8) rotate(16deg);
	}
}
@media (prefers-reduced-motion: reduce) {
	.is-bursting .card-heart-glyph > :first-child {
		animation: none;
	}
	.card-heart-particle {
		display: none;
	}
}
</style>
