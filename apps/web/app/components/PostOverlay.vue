<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { origin, closePost } = usePostOverlay()
const { find } = usePostRecords()
const open = ref(false),
	postId = ref('')
const preview = computed(() => find(postId.value))
const viewport = ref({ width: 1200, height: 800 })
function resize() {
	viewport.value = { width: window.innerWidth, height: window.innerHeight }
}
onMounted(() => {
	resize()
	window.addEventListener('resize', resize)
})
onBeforeUnmount(() => window.removeEventListener('resize', resize))
watch(
	() => [route.path, route.query.post],
	() => {
		const id = typeof route.query.post === 'string' ? route.query.post : ''
		if (id) {
			postId.value = id
			open.value = true
		} else open.value = false
	},
	{ immediate: true },
)
function change(value: boolean) {
	if (!value) void closePost()
}
function restoreFocus() {
	if (!open.value && postId.value) {
		document
			.querySelector<HTMLElement>(
				`[data-post-card="${CSS.escape(postId.value)}"] a`,
			)
			?.focus({ preventScroll: true })
		if (origin.value)
			window.scrollTo({
				left: origin.value.scrollX,
				top: origin.value.scrollY,
				behavior: 'instant',
			})
	}
}
const motionStyle = computed(() => {
	const v = viewport.value,
		w = v.width < 768 ? v.width : Math.min(1240, v.width - 96),
		h = v.width < 768 ? v.height : Math.min(900, v.height - 64)
	const left = (v.width - w) / 2,
		top = (v.height - h) / 2,
		r = origin.value
	return {
		'--card-x': `${r ? r.left - left : 0}px`,
		'--card-y': `${r ? r.top - top : 16}px`,
		'--card-sx': r ? String(r.width / w) : '.97',
		'--card-sy': r ? String(r.height / h) : '.97',
	}
})
const contentProps = computed(() => ({
	style: motionStyle.value,
	onOpenAutoFocus: () => undefined,
}))
</script>
<template>
	<UModal
		:open="open"
		:title="preview?.title ?? t('ui.brand')"
		:description="t('ui.relatedPosts')"
		:content="contentProps"
		:ui="{
			content: 'post-overlay-modal ring-0 divide-y-0',
			overlay: 'post-overlay-backdrop',
		}"
		@update:open="change"
		@after:leave="restoreFocus"
	>
		<template #content>
			<UButton
				class="post-overlay-close"
				color="neutral"
				variant="soft"
				icon="i-lucide-x"
				:aria-label="t('ui.close')"
				@click="closePost"
			/>
			<div class="post-overlay-scroll">
				<Suspense>
					<PostDetailContent
						v-if="postId"
						:key="postId"
						:post-id="postId"
						embedded
					/>
					<template #fallback
						><div class="post-overlay-loading">
							<ContentCover
								v-if="preview"
								:title="preview.title"
								:poster-template="preview.posterTemplate"
								:poster-aspect="preview.posterAspect"
								:poster-highlight="preview.posterHighlight"
								:tags="preview.tags"
								:media="preview.media[0]"
							/>
							<section>
								<h1>{{ preview?.title }}</h1>
								<p v-if="preview">{{ preview.body }}</p>
								<p role="status" class="muted">{{ t('ui.loading') }}</p>
							</section>
						</div></template
					>
				</Suspense>
			</div>
		</template>
	</UModal>
</template>
