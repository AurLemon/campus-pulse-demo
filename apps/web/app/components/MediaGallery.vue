<script setup lang="ts">
import type { MediaAsset, PosterOptions } from '@campus/contracts'
interface SwipeStart {
	pointerId: number
	x: number
	y: number
}
interface GalleryProps extends PosterOptions {
	title: string
	tags?: string[]
	media: MediaAsset[]
}
const props = defineProps<GalleryProps>()
const { t } = useI18n()
const selected = ref(0)
const instructionsId = `gallery-help-${useId()}`
const multiple = computed(() => props.media.length > 1)
const active = computed(() => props.media[selected.value])
const activeKey = computed(() =>
	active.value
		? `${active.value.id}:${active.value.url}`
		: `poster:${props.title}`,
)
let swipe: SwipeStart | undefined
watch(
	() =>
		`${props.title}:${props.media.map((item) => `${item.id}:${item.url}`).join('|')}`,
	() => {
		selected.value = 0
		swipe = undefined
	},
)
function show(index: number) {
	if (multiple.value)
		selected.value = Math.max(0, Math.min(index, props.media.length - 1))
}
function previous() {
	show(selected.value - 1)
}
function next() {
	show(selected.value + 1)
}
function keydown(event: KeyboardEvent) {
	if (!multiple.value || event.altKey || event.ctrlKey || event.metaKey) return
	if (event.key === 'ArrowLeft') previous()
	else if (event.key === 'ArrowRight') next()
	else if (event.key === 'Home') show(0)
	else if (event.key === 'End') show(props.media.length - 1)
	else return
	event.preventDefault()
}
function startSwipe(event: PointerEvent) {
	if (!multiple.value || event.pointerType !== 'touch' || !event.isPrimary)
		return
	if ((event.target as HTMLElement).closest('button, a, input, textarea'))
		return
	swipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
}
function moveSwipe(event: PointerEvent) {
	if (!swipe || swipe.pointerId !== event.pointerId) return
	const dx = event.clientX - swipe.x,
		dy = event.clientY - swipe.y
	if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
		const element = event.currentTarget as HTMLElement
		if (!element.hasPointerCapture(event.pointerId))
			element.setPointerCapture(event.pointerId)
	}
}
function endSwipe(event: PointerEvent) {
	const start = swipe
	swipe = undefined
	if (!start || start.pointerId !== event.pointerId) return
	const dx = event.clientX - start.x,
		dy = event.clientY - start.y
	const element = event.currentTarget as HTMLElement
	if (element.hasPointerCapture(event.pointerId))
		element.releasePointerCapture(event.pointerId)
	const threshold = Math.max(42, element.clientWidth * 0.08)
	if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.2) {
		if (dx < 0) next()
		else previous()
	}
}
function cancelSwipe() {
	swipe = undefined
}
</script>
<template>
	<div
		class="media-gallery"
		role="region"
		:aria-label="t('posts.gallery.label', { title })"
		:tabindex="multiple ? 0 : undefined"
		:aria-describedby="multiple ? instructionsId : undefined"
		@keydown="keydown"
		@pointerdown="startSwipe"
		@pointermove="moveSwipe"
		@pointerup="endSwipe"
		@pointercancel="cancelSwipe"
		@lostpointercapture="cancelSwipe"
		@dragstart.prevent
	>
		<Transition name="gallery-fade"
			><div :key="activeKey" class="media-gallery__slide">
				<ContentCover
					:title="title"
					:tags="tags"
					:media="active"
					:poster-template="posterTemplate"
					:poster-aspect="posterAspect"
					:poster-highlight="posterHighlight"
				/></div
		></Transition>
		<template v-if="multiple">
			<span :id="instructionsId" class="sr-only">{{
				t('posts.gallery.keyboard')
			}}</span>
			<UButton
				class="media-gallery__arrow media-gallery__arrow--previous"
				type="button"
				color="neutral"
				variant="soft"
				icon="i-lucide-chevron-left"
				:aria-label="t('posts.gallery.previous')"
				:disabled="selected === 0"
				@click="previous"
			/>
			<UButton
				class="media-gallery__arrow media-gallery__arrow--next"
				type="button"
				color="neutral"
				variant="soft"
				icon="i-lucide-chevron-right"
				:aria-label="t('posts.gallery.next')"
				:disabled="selected === media.length - 1"
				@click="next"
			/>
			<span
				class="media-gallery__position"
				aria-live="polite"
				aria-atomic="true"
				><span aria-hidden="true">{{ selected + 1 }} / {{ media.length }}</span
				><span class="sr-only">{{
					t('posts.gallery.position', {
						current: selected + 1,
						total: media.length,
					})
				}}</span></span
			>
		</template>
	</div>
</template>
<style scoped>
.media-gallery {
	container-type: inline-size;
	position: relative;
	width: 100%;
	min-width: 0;
	min-height: 0;
	aspect-ratio: 4 / 3;
	overflow: hidden;
	isolation: isolate;
	background: var(--surface-raised);
	touch-action: pan-y pinch-zoom;
	outline-offset: -4px;
}
.media-gallery__slide {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	user-select: none;
}
.media-gallery__slide :deep(.content-cover) {
	width: 100%;
	height: 100%;
	min-height: 0;
	max-height: none;
	aspect-ratio: auto !important;
}
.media-gallery__slide :deep(.content-cover > img) {
	width: 100%;
	height: 100%;
	max-height: none;
	object-fit: cover;
	-webkit-user-drag: none;
}

.media-gallery__arrow {
	position: absolute;
	top: 50%;
	translate: 0 -50%;
	z-index: 2;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	color: #25252d;
	background: rgb(255 255 255 / 0.88);
	box-shadow: 0 1px 6px rgb(0 0 0 / 0.08);
	transition:
		opacity 0.15s,
		background 0.15s;
}
.media-gallery__arrow:hover {
	background: rgb(255 255 255 / 0.97);
}
.media-gallery__arrow:disabled {
	opacity: 0.28;
	cursor: default;
}
.media-gallery__arrow--previous {
	left: 14px;
}
.media-gallery__arrow--next {
	right: 14px;
}
.media-gallery__position {
	position: absolute;
	bottom: 16px;
	left: 50%;
	translate: -50% 0;
	z-index: 2;
	padding: 5px 12px;
	border-radius: 99px;
	background: rgb(24 24 30 / 0.62);
	color: white;
	font-size: 12px;
	line-height: 1.5;
	font-variant-numeric: tabular-nums;
	pointer-events: none;
}
.gallery-fade-enter-active,
.gallery-fade-leave-active {
	transition: opacity 0.18s ease;
}
.gallery-fade-enter-from,
.gallery-fade-leave-to {
	opacity: 0;
}
:global(.dark) .media-gallery__arrow {
	color: #f2f2f4;
	background: rgb(35 35 42 / 0.8);
}
:global(.dark) .media-gallery__arrow:hover {
	background: rgb(45 45 54 / 0.94);
}
@media (max-width: 767px) {
	.media-gallery__arrow {
		width: 42px;
		height: 42px;
	}
	.media-gallery__arrow--previous {
		left: 10px;
	}
	.media-gallery__arrow--next {
		right: 10px;
	}
	.media-gallery__position {
		bottom: 13px;
		font-size: 11px;
	}
}
@media (prefers-reduced-motion: reduce) {
	.gallery-fade-enter-active,
	.gallery-fade-leave-active,
	.media-gallery__arrow {
		transition: none;
	}
}
</style>
