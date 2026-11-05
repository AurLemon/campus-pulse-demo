<script setup lang="ts">
import type { ActivityView, PostView } from '@campus/contracts'
const { openAuth } = useAuthOverlay()
const apiError = useApiError()
const { find, remember } = usePostRecords()

const props = defineProps<{
	item: PostView | ActivityView
	type: 'post' | 'activity'
}>()
const emit = defineEmits<{ refresh: []; comment: [] }>()
const { t } = useI18n(),
	{ user } = await useCampus(),
	busy = ref(false),
	message = ref('')
const activityState = shallowRef<ActivityView>()
watch(
	() => props.item,
	() => {
		activityState.value = undefined
	},
)
const post = computed(() =>
		props.type === 'post'
			? (find(props.item.id) ?? (props.item as PostView))
			: null,
	),
	activity = computed(() =>
		props.type === 'activity'
			? (activityState.value ?? (props.item as ActivityView))
			: null,
	)
const pendingAction = ref<'like' | 'favorite' | 'register' | null>(null)
const burst = ref<'like' | 'favorite' | null>(null)
let burstTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(burstTimer))
async function toggle(
	action: 'like' | 'favorite' | 'register',
	active: boolean,
) {
	if (busy.value) return
	if (!user.value) {
		await openAuth()
		return
	}
	const currentPost = post.value
	const currentActivity = activity.value
	const viewerId = user.value.id
	busy.value = true
	pendingAction.value = action
	message.value = ''
	try {
		await $fetch('/api/actions', {
			method: 'POST',
			body: { action, targetId: props.item.id, targetType: props.type, active },
		})
		if (user.value?.id !== viewerId) return
		if (currentPost && (action === 'like' || action === 'favorite')) {
			const stat = action === 'like' ? 'likes' : 'favorites'
			const flag = action === 'like' ? 'liked' : 'favorited'
			remember({
				...currentPost,
				stats: {
					...currentPost.stats,
					[stat]: Math.max(
						0,
						currentPost.stats[stat] +
							(active === currentPost.viewer[flag] ? 0 : active ? 1 : -1),
					),
				},
				viewer: { ...currentPost.viewer, [flag]: active },
			})
		}
		if (currentActivity && (action === 'favorite' || action === 'register')) {
			const stat = action === 'favorite' ? 'favorites' : 'registrations'
			const flag = action === 'favorite' ? 'favorited' : 'registered'
			activityState.value = {
				...currentActivity,
				stats: {
					...currentActivity.stats,
					[stat]: Math.max(
						0,
						currentActivity.stats[stat] +
							(active === currentActivity.viewer[flag] ? 0 : active ? 1 : -1),
					),
				},
				viewer: { ...currentActivity.viewer, [flag]: active },
			}
		}
		if (
			active &&
			(post.value || activity.value) &&
			(action === 'like' || action === 'favorite')
		) {
			clearTimeout(burstTimer)
			burst.value = action
			burstTimer = setTimeout(() => (burst.value = null), 700)
		}
		emit('refresh')
		await refreshNuxtData('sidebar')
	} catch (e) {
		message.value = apiError(e)
	} finally {
		busy.value = false
		pendingAction.value = null
	}
}
</script>
<template>
	<div class="interaction-area">
		<div
			class="interaction-bar"
			:class="{ 'post-interactions': post || activity }"
		>
			<template v-if="post">
				<button
					type="button"
					class="post-reaction"
					:class="{
						'is-liked': post.viewer.liked,
						'is-bursting': burst === 'like',
					}"
					:aria-label="t(post.viewer.liked ? 'ui.liked' : 'ui.like')"
					:aria-pressed="post.viewer.liked"
					:disabled="busy"
					@click="toggle('like', !post.viewer.liked)"
				>
					<span class="reaction-glyph"
						><ReactionIcon kind="heart" :active="post.viewer.liked" /><span
							v-if="burst === 'like'"
							class="reaction-particle"
							aria-hidden="true"
							><ReactionIcon kind="heart" active /></span></span
					>{{ post.stats.likes }}
				</button>
				<button
					type="button"
					class="post-reaction"
					:class="{
						'is-favorited': post.viewer.favorited,
						'is-bursting': burst === 'favorite',
					}"
					:aria-label="
						t(post.viewer.favorited ? 'ui.favorited' : 'ui.favorite')
					"
					:aria-pressed="post.viewer.favorited"
					:disabled="busy"
					@click="toggle('favorite', !post.viewer.favorited)"
				>
					<span class="reaction-glyph"
						><ReactionIcon kind="star" :active="post.viewer.favorited" /><span
							v-if="burst === 'favorite'"
							class="reaction-particle"
							aria-hidden="true"
							><ReactionIcon kind="star" active /></span></span
					>{{ post.stats.favorites }}
				</button>
				<button
					type="button"
					class="post-reaction"
					:aria-label="t('ui.comment')"
					@click="emit('comment')"
				>
					<UIcon name="i-lucide-message-circle" />{{ post.stats.comments }}
				</button>
			</template>
			<button
				v-else-if="activity"
				type="button"
				class="post-reaction"
				:class="{
					'is-favorited': activity.viewer.favorited,
					'is-bursting': burst === 'favorite',
				}"
				:aria-label="
					t(activity.viewer.favorited ? 'ui.favorited' : 'ui.favorite')
				"
				:aria-pressed="activity.viewer.favorited"
				:disabled="busy"
				@click="toggle('favorite', !activity.viewer.favorited)"
			>
				<span class="reaction-glyph"
					><ReactionIcon kind="star" :active="activity.viewer.favorited" /><span
						v-if="burst === 'favorite'"
						class="reaction-particle"
						aria-hidden="true"
						><ReactionIcon kind="star" active /></span></span
				>{{ activity.stats.favorites }}
			</button>
			<UButton
				v-if="activity"
				class="activity-registration"
				:color="activity.viewer.registered ? 'neutral' : 'primary'"
				:variant="activity.viewer.registered ? 'soft' : 'solid'"
				:aria-pressed="activity.viewer.registered"
				size="lg"
				icon="i-lucide-ticket"
				:loading="busy && pendingAction === 'register'"
				:disabled="
					busy ||
					(!activity.viewer.registered && activity.availability !== 'OPEN')
				"
				@click="toggle('register', !activity.viewer.registered)"
				>{{
					t(
						activity.viewer.registered
							? 'ui.unjoin'
							: activity.availability === 'OPEN'
								? 'ui.join'
								: `ui.${activity.availability}`,
					)
				}}</UButton
			>
		</div>
		<p v-if="message" class="error" role="alert">{{ message }}</p>
	</div>
</template>

<style scoped>
.post-interactions {
	justify-content: flex-end;
	gap: 24px;
}
.post-reaction {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	padding: 8px 0;
	border: 0;
	background: transparent;
	color: var(--ink);
	font-size: 14px;
	font-weight: 400;
	font-variant-numeric: tabular-nums;
}
.post-reaction > .iconify {
	width: 22px;
	height: 22px;
}
.post-reaction.is-liked {
	color: #e74760;
}
.post-reaction.is-favorited {
	color: #d99a24;
}
.post-reaction:focus-visible {
	outline: 1px solid var(--accent);
	outline-offset: 4px;
	border-radius: 4px;
}
.reaction-glyph {
	position: relative;
	display: flex;
}
.is-bursting .reaction-glyph > :first-child {
	animation: reaction-pop 450ms ease;
}
.reaction-particle {
	position: absolute;
	inset: 0;
	pointer-events: none;
	animation: reaction-float 700ms ease-out forwards;
}
@keyframes reaction-pop {
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
@keyframes reaction-float {
	0% {
		opacity: 0;
		transform: translateY(0) scale(0.6);
	}
	20% {
		opacity: 0.85;
	}
	100% {
		opacity: 0;
		transform: translate(7px, -38px) scale(0.8) rotate(16deg);
	}
}
@media (prefers-reduced-motion: reduce) {
	.is-bursting .reaction-glyph > :first-child {
		animation: none;
	}
	.reaction-particle {
		display: none;
	}
}
</style>

<style scoped>
.activity-registration {
	min-height: 40px;
	padding: 9px 18px;
	border-radius: 10px;
}
.activity-registration[aria-pressed='false'] {
	background: var(--accent);
	color: white;
}
.activity-registration[aria-pressed='false']:hover:not(:disabled) {
	background: color-mix(in srgb, var(--accent) 88%, black);
}
</style>
