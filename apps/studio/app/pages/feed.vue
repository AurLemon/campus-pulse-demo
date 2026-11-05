<script setup lang="ts">
import type { StudioState } from '../../shared/contracts'

const { t, te } = useI18n()
const topicLabel = (id: string) => (te(`topics.${id}`) ? t(`topics.${id}`) : id)
const requestFetch = useRequestFetch()
const {
	data: state,
	error,
	refresh,
} = await useAsyncData('studio-feed-state', () =>
	requestFetch<StudioState>('/api/studio/state'),
)
const viewport = ref<HTMLElement>()
const speed = ref(16)
const mode = ref<'idle' | 'playing' | 'paused' | 'takeover' | 'ended'>('idle')
const reducedMotion = ref(false)
const scrollPosition = ref(0)
const maximumScroll = ref(0)
let animation: number | undefined
let previousTime = 0
let precisePosition = 0
let mediaPreference: MediaQueryList | undefined
let resizeObserver: ResizeObserver | undefined
const posts = computed(() =>
	[...(state.value?.snapshot.posts ?? [])].sort(
		(a, b) =>
			b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
	),
)
const users = computed(
	() =>
		new Map(
			state.value?.snapshot.users.map((user) => [user.id, user.name]) ?? [],
		),
)
const progress = computed(() =>
	maximumScroll.value
		? Math.min(100, (scrollPosition.value / maximumScroll.value) * 100)
		: 0,
)

const coverLines = (title: string) => {
	const characters = Array.from(title)
	return Array.from(
		{ length: Math.min(5, Math.ceil(characters.length / 8)) },
		(_, index) => characters.slice(index * 8, (index + 1) * 8).join(''),
	)
}
function measure() {
	const element = viewport.value
	if (!element) return
	maximumScroll.value = Math.max(0, element.scrollHeight - element.clientHeight)
	scrollPosition.value = element.scrollTop
}
function stop(nextMode: typeof mode.value = 'paused') {
	if (animation !== undefined) cancelAnimationFrame(animation)
	animation = undefined
	previousTime = 0
	mode.value = nextMode
}
function tick(time: number) {
	const element = viewport.value
	if (!element || mode.value !== 'playing') return
	const elapsed = previousTime ? Math.min(80, time - previousTime) : 0
	previousTime = time
	precisePosition += (elapsed * speed.value) / 1000
	element.scrollTop = precisePosition
	measure()
	if (element.scrollTop >= maximumScroll.value - 1) {
		stop('ended')
		return
	}
	animation = requestAnimationFrame(tick)
}
function play() {
	if (mode.value === 'playing') {
		stop()
		return
	}
	if (reducedMotion.value || !viewport.value || !posts.value.length) return
	measure()
	if (scrollPosition.value >= maximumScroll.value - 1) {
		stop('ended')
		return
	}
	precisePosition = viewport.value.scrollTop
	previousTime = 0
	mode.value = 'playing'
	animation = requestAnimationFrame(tick)
}
function rewind() {
	stop('idle')
	if (viewport.value) viewport.value.scrollTop = 0
	precisePosition = 0
	measure()
}
function takeover() {
	if (mode.value === 'playing') stop('takeover')
}
function onKey(event: KeyboardEvent) {
	if (
		['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(
			event.key,
		)
	)
		takeover()
}
function onVisibility() {
	if (document.hidden && mode.value === 'playing') stop()
}
function onPreference() {
	reducedMotion.value = mediaPreference?.matches ?? false
	if (reducedMotion.value && mode.value === 'playing') stop()
}
onMounted(() => {
	mediaPreference = matchMedia('(prefers-reduced-motion: reduce)')
	onPreference()
	mediaPreference.addEventListener('change', onPreference)
	document.addEventListener('visibilitychange', onVisibility)
	resizeObserver = new ResizeObserver(measure)
	if (viewport.value) resizeObserver.observe(viewport.value)
	measure()
})
watch(posts, async () => {
	stop('idle')
	await nextTick()
	measure()
})
onBeforeUnmount(() => {
	stop()
	resizeObserver?.disconnect()
	mediaPreference?.removeEventListener('change', onPreference)
	document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
	<div class="studio-shell">
		<StudioHeader
			><UButton
				to="/"
				color="neutral"
				variant="ghost"
				icon="i-lucide-arrow-left"
				:aria-label="t('studio')"
				><span class="feed-link-text">{{ t('studio') }}</span></UButton
			></StudioHeader
		>
		<main class="feed-demo-main">
			<h1 class="feed-demo-title">{{ t('feedDemo') }}</h1>
			<div class="feed-demo-controls">
				<UButton
					:icon="mode === 'playing' ? 'i-lucide-pause' : 'i-lucide-play'"
					:disabled="reducedMotion || !posts.length || mode === 'ended'"
					@click="play"
					>{{ t(mode === 'playing' ? 'pause' : 'feedStart') }}</UButton
				>
				<UButton
					color="neutral"
					variant="soft"
					icon="i-lucide-rotate-ccw"
					@click="rewind"
					>{{ t('rewind') }}</UButton
				>
				<UFormField :label="t('feedSpeed')" orientation="horizontal"
					><USelect
						v-model="speed"
						:items="[
							{ value: 8, label: '8 px/s' },
							{ value: 16, label: '16 px/s' },
							{ value: 24, label: '24 px/s' },
							{ value: 32, label: '32 px/s' },
						]"
						class="feed-speed"
				/></UFormField>
				<span class="feed-demo-status" role="status" aria-live="polite">{{
					t(`feedMode.${mode}`)
				}}</span>
			</div>
			<p v-if="reducedMotion" class="studio-alert">
				{{ t('feedReducedMotion') }}
			</p>
			<p v-if="error" class="studio-alert" role="alert">
				{{ t('loadError') }}
				<UButton color="neutral" variant="ghost" @click="refresh()">{{
					t('retry')
				}}</UButton>
			</p>
			<div class="feed-demo-frame">
				<div class="feed-demo-topline">
					<span>{{ posts.length }} {{ t('feedItems') }}</span
					><span>{{ progress.toFixed(0) }}%</span>
				</div>
				<div
					ref="viewport"
					class="feed-demo-viewport"
					tabindex="0"
					:aria-label="t('feedViewport')"
					@wheel.passive="takeover"
					@touchstart.passive="takeover"
					@pointerdown="takeover"
					@keydown="onKey"
					@scroll.passive="measure"
				>
					<StudioMasonryFeed :items="posts" @measured="measure"
						><template #default="{ item: post, index }"
							><article class="feed-demo-card">
								<svg
									:viewBox="`0 0 400 ${index % 3 === 0 ? 460 : 390}`"
									role="img"
									:aria-label="post.title"
								>
									<circle
										cx="360"
										cy="35"
										r="120"
										class="feed-poster-accent"
										opacity=".65"
									/>
									<path
										d="M-50 350 Q150 210 450 460"
										fill="none"
										stroke="currentColor"
										stroke-width="1"
										opacity=".2"
									/>
									<path
										d="M-50 370 Q150 230 450 480"
										fill="none"
										stroke="currentColor"
										stroke-width="1"
										opacity=".2"
									/>
									<text
										x="32"
										y="48"
										fill="currentColor"
										class="feed-poster-kicker"
									>
										{{
											post.tags[0] ? topicLabel(post.tags[0]) : t('activity')
										}}
									</text>
									<text
										x="30"
										y="125"
										fill="currentColor"
										class="feed-poster-title"
									>
										<tspan
											v-for="(line, lineIndex) in coverLines(post.title)"
											:key="lineIndex"
											x="30"
											:dy="lineIndex === 0 ? 0 : 48"
										>
											{{ line }}
										</tspan>
									</text>
									<text
										x="32"
										:y="index % 3 === 0 ? 425 : 355"
										fill="currentColor"
										class="feed-poster-footer"
									>
										{{ t('brand') }} / CAMPUS PULSE
									</text>
								</svg>
								<div class="feed-demo-card-body">
									<h2>{{ post.title }}</h2>
									<p>{{ post.body }}</p>
									<div>
										<span>{{ users.get(post.authorId) ?? post.authorId }}</span
										><span>{{
											post.tags.slice(0, 2).map(topicLabel).join(' / ')
										}}</span>
									</div>
								</div>
							</article></template
						></StudioMasonryFeed
					>
					<p class="feed-demo-end">
						{{ posts.length ? t('feedEnd') : t('noCandidates') }}
					</p>
				</div>
			</div>
		</main>
	</div>
</template>
