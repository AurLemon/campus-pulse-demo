<script setup lang="ts">
import type { PosterOptions } from '@campus/contracts'
interface CoverMedia {
	url: string
	width?: number
	height?: number
	alt?: string
}
interface CoverProps extends PosterOptions {
	title: string
	tags?: string[]
	media?: CoverMedia | null
	variant?: string
	wide?: boolean
}
const props = defineProps<CoverProps>()
const failed = ref(false)
const cover = ref<HTMLElement>()
const titleBox = ref<HTMLElement>()
const titleText = ref<HTMLElement>()
const fontSize = ref<number>()
const seed = computed(() =>
	Array.from(props.title).reduce((n, c) => n + (c.codePointAt(0) ?? 0), 0),
)
const palette = computed(
	() => ['lilac', 'butter', 'sky', 'mint', 'peach'][seed.value % 5],
)
const template = computed(() => props.posterTemplate ?? 'orbit')
const ratio = computed(() => {
	if (props.wide) return '16 / 8'
	if (props.media && !failed.value && props.media.width && props.media.height)
		return `${props.media.width} / ${Math.min(props.media.height, props.media.width * 1.35)}`
	return { portrait: '3 / 4', square: '1 / 1', landscape: '4 / 3' }[
		props.posterAspect ?? 'portrait'
	]
})
const highlight = computed(() => {
	if (props.posterHighlight && props.title.includes(props.posterHighlight))
		return props.posterHighlight
	return template.value === 'quote' || template.value === 'note'
		? Array.from(props.title.trim()).slice(0, 4).join('')
		: ''
})
const segments = computed(() => {
	const at = highlight.value ? props.title.indexOf(highlight.value) : -1
	return at < 0
		? { before: props.title, mark: '', after: '' }
		: {
				before: props.title.slice(0, at),
				mark: highlight.value,
				after: props.title.slice(at + highlight.value.length),
			}
})
let observer: ResizeObserver | undefined
let frame = 0
let disposed = false
function fitTitle() {
	if (!titleBox.value || !titleText.value || !cover.value) return
	const node = titleText.value,
		box = titleBox.value
	if (!box.clientWidth || !box.clientHeight) return
	let low = 4,
		high = Math.min(64, cover.value.clientWidth * 0.125)
	for (let i = 0; i < 12; i++) {
		const mid = (low + high) / 2
		node.style.fontSize = `${mid}px`
		if (
			node.scrollHeight <= box.clientHeight &&
			node.scrollWidth <= box.clientWidth
		)
			low = mid
		else high = mid
	}
	fontSize.value = Math.floor(low * 10) / 10
	node.style.fontSize = `${fontSize.value}px`
}
function scheduleFit() {
	cancelAnimationFrame(frame)
	frame = requestAnimationFrame(fitTitle)
}
watch(
	() => props.media?.url,
	() => {
		failed.value = false
	},
)
watch(
	() => [
		props.title,
		props.posterTemplate,
		props.posterAspect,
		props.posterHighlight,
		failed.value,
	],
	async () => {
		await nextTick()
		if (import.meta.client && !disposed) {
			scheduleFit()
			void loadTitleFont()
		}
	},
)
async function loadTitleFont() {
	if (props.media && !failed.value) return
	try {
		await document.fonts.load(
			template.value === 'note'
				? '400 24px "ZCOOL KuaiLe"'
				: '700 24px "Noto Sans SC"',
			props.title,
		)
		if (!disposed) scheduleFit()
	} catch {
		// The fallback font remains readable when the CDN font cannot load.
	}
}

onMounted(() => {
	observer = new ResizeObserver(scheduleFit)
	if (cover.value) observer.observe(cover.value)
	scheduleFit()
	void loadTitleFont()
})
onBeforeUnmount(() => {
	disposed = true
	observer?.disconnect()
	cancelAnimationFrame(frame)
})
</script>
<template>
	<div
		ref="cover"
		class="content-cover"
		:class="[`cover-${palette}`, { 'cover-poster': !media || failed }]"
		:style="{ aspectRatio: ratio }"
	>
		<img
			v-if="media && !failed"
			:src="media.url"
			:alt="media.alt || title"
			:width="media.width || 800"
			:height="media.height || 600"
			loading="lazy"
			decoding="async"
			@error="failed = true"
		/>
		<div
			v-else
			class="poster-art"
			:class="`poster-template-${template}`"
			role="img"
			:aria-label="title"
		>
			<span v-if="template === 'quote'" class="poster-quote" aria-hidden="true"
				>“</span
			>
			<span
				v-else-if="template !== 'note'"
				class="poster-kicker"
				aria-hidden="true"
			/>
			<span
				v-if="template === 'orbit'"
				class="poster-orbit"
				aria-hidden="true"
			/>
			<div ref="titleBox" class="poster-title-box">
				<strong
					ref="titleText"
					:style="fontSize ? { fontSize: `${fontSize}px` } : undefined"
					>{{ segments.before
					}}<mark v-if="segments.mark">{{ segments.mark }}</mark
					>{{ segments.after }}</strong
				>
			</div>
			<span v-if="template !== 'note'" class="poster-footer" aria-hidden="true"
				><span v-if="template === 'orbit'">↗</span
				><span v-else class="poster-quote-bar"
			/></span>
		</div>
		<slot />
	</div>
</template>
<style scoped>
.content-cover {
	container-type: inline-size;
}
.poster-art {
	position: relative;
	display: grid;
	grid-template-rows: auto minmax(0, 1fr) auto;
	gap: 5cqi;
	width: 100%;
	height: 100%;
	min-height: 0;
	padding: 8cqi;
	overflow: hidden;
	background: var(--poster-bg);
	color: var(--poster-ink);
	font-family: 'Noto Sans SC', sans-serif;
}
.poster-kicker {
	position: relative;
	z-index: 1;
	min-height: 1.5em;
	font-size: clamp(8px, 3.5cqi, 14px);
	line-height: 1.5;
}
.poster-title-box {
	position: relative;
	z-index: 1;
	min-height: 0;
	min-width: 0;
	display: flex;
	align-items: center;
}
.poster-title-box > strong {
	display: block;
	width: 100%;
	font-size: 12cqi;
	font-weight: 750;
	line-height: 1.35;
	letter-spacing: 0;
	overflow-wrap: anywhere;
}
.poster-title-box mark {
	color: inherit;
	background: linear-gradient(
		transparent 61%,
		#b9eb73 61%,
		#b9eb73 94%,
		transparent 94%
	);
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}
.poster-footer {
	display: flex;
	justify-content: flex-end;
	align-items: center;
	position: relative;
	z-index: 1;
	height: 7cqi;
	font-size: 8cqi;
	line-height: 1;
}
.poster-orbit {
	position: absolute;
	width: 90cqi;
	height: 90cqi;
	top: -23cqi;
	right: -38cqi;
	border: 10cqi solid currentColor;
	border-radius: 50%;
	opacity: 0.08;
}
.poster-quote {
	font-family: Georgia, serif;
	font-size: 27cqi;
	height: 19cqi;
	line-height: 1;
	opacity: 0.22;
}
.poster-quote-bar {
	display: block;
	width: 13cqi;
	height: 2.2cqi;
	background: currentColor;
	opacity: 0.28;
}
@container (max-width: 90px) {
	.poster-art {
		padding: 7cqi;
		gap: 0;
		grid-template-rows: minmax(0, 1fr);
	}
	.poster-kicker,
	.poster-quote,
	.poster-footer {
		display: none;
	}
}
</style>

<style scoped>
.content-cover:has(> .cover-badge) .poster-art {
	padding-block-start: calc(8cqi + 20px);
}
</style>

<style scoped>
.poster-template-note {
	grid-template-rows: minmax(0, 1fr);
	background: #fcfcfc;
	color: #202124;
	padding: 12cqi 8cqi;
}
.poster-template-note .poster-title-box {
	justify-content: center;
}
.poster-template-note strong {
	text-align: center;
	font-family: 'ZCOOL KuaiLe', 'Noto Sans SC', sans-serif;
	font-weight: 400;
	font-synthesis: none;
	line-height: 1.65;
	text-wrap: balance;
}
.poster-template-note mark {
	color: #3568b9;
	padding-inline: 0.1em;
	margin-inline: -0.1em;
	background: url('/textures/note-marker.svg') center / 100% 100% no-repeat;
}
</style>
