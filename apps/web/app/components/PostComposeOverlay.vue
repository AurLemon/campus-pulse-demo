<script setup lang="ts">
const route = useRoute(),
	router = useRouter(),
	{ t } = useI18n()
const { closeCompose, origin } = useComposeOverlay()
const { origin: postOrigin } = usePostOverlay()
const postReturnTo = useState<string | null>(
	'post-overlay-return-to',
	() => null,
)
const feedRevision = useState('feed-publish-revision', () => 0)
const feedCache = useFeedCache()
const open = computed(() => route.query.compose === '1')
const busy = ref(false),
	dirty = ref(false),
	completed = ref(false)
const trigger = shallowRef<HTMLElement | null>(null)
watch(
	open,
	(value, previous) => {
		if (value && !previous) {
			busy.value = false
			dirty.value = false
			completed.value = false
			trigger.value =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null
		}
	},
	{ immediate: true },
)
const removeGuard = router.beforeEach((to) => {
	if (!open.value || completed.value || to.fullPath === route.fullPath) return
	if (busy.value) return false
	// Authentication can be layered above a guest publishing form without discarding it.
	if (to.path === route.path && to.query.compose === '1') return
	if (dirty.value && !window.confirm(t('ui.leaveDraft'))) return false
})
function beforeUnload(event: BeforeUnloadEvent) {
	if (!open.value || completed.value || (!busy.value && !dirty.value)) return
	event.preventDefault()
	event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
	removeGuard()
	window.removeEventListener('beforeunload', beforeUnload)
})
function change(value: boolean) {
	if (!value && !busy.value) void closeCompose()
}
function restore() {
	if (
		open.value ||
		route.query.post ||
		route.query.activity ||
		route.query.auth
	)
		return
	if (origin.value?.path === route.path)
		window.scrollTo({
			left: origin.value.left,
			top: origin.value.top,
			behavior: 'instant',
		})
	if (trigger.value?.isConnected) trigger.value.focus({ preventScroll: true })
	trigger.value = null
	origin.value = null
}
async function created(id: string) {
	completed.value = true
	postOrigin.value = null
	postReturnTo.value = null
	busy.value = false
	dirty.value = false
	feedCache.clear()
	feedRevision.value++
	const query = { ...route.query }
	delete query.compose
	delete query.activity
	delete query.auth
	delete query.next
	query.post = id
	await router.replace({ path: route.path, query })
	await refreshNuxtData('sidebar')
}
</script>
<template>
	<UModal
		:open="open"
		:title="t('ui.publish')"
		:dismissible="!busy"
		:ui="{
			content:
				'compose-modal w-[calc(100vw-32px)] max-w-[760px] sm:max-w-[760px] max-h-[calc(100dvh-24px)] p-0 border-0 bg-[var(--surface)] ring-0 divide-y-0 overflow-hidden flex flex-col',
			overlay: 'post-overlay-backdrop',
		}"
		@update:open="change"
		@after:leave="restore"
	>
		<template #content>
			<UButton
				class="compose-close"
				icon="i-lucide-x"
				color="neutral"
				variant="ghost"
				:aria-label="t('ui.close')"
				:disabled="busy"
				@click="closeCompose()"
			/>
			<div class="compose-scroll">
				<Suspense
					><PostComposeForm
						v-if="open"
						@busy="busy = $event"
						@dirty="dirty = $event"
						@created="created"
					/><template #fallback
						><p class="empty-state" role="status">
							{{ t('ui.loading') }}
						</p></template
					></Suspense
				>
			</div>
		</template>
	</UModal>
</template>
<style scoped>
.compose-scroll {
	overflow-y: auto;
	overscroll-behavior: contain;
	min-height: 0;
	scrollbar-width: none;
}
.compose-scroll::-webkit-scrollbar {
	display: none;
}
.compose-close {
	position: absolute;
	top: 12px;
	right: 12px;
	z-index: 2;
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	padding: 0;
}
</style>
