<script setup lang="ts">
const route = useRoute(),
	router = useRouter(),
	{ t } = useI18n()
const { origin, closeActivity } = useActivityOverlay()
const open = ref(false),
	activityId = ref(''),
	busy = ref(false)
watch(
	() => route.query.activity,
	(value) => {
		if (typeof value === 'string' && value) {
			activityId.value = value
			open.value = true
		} else {
			open.value = false
			busy.value = false
		}
	},
	{ immediate: true },
)
function change(value: boolean) {
	if (!value && !busy.value) void closeActivity()
}
async function created(id: string) {
	busy.value = false
	await router.replace({
		path: route.path,
		query: { ...route.query, activity: id },
	})
}
function restore() {
	if (!open.value && origin.value && !route.query.post)
		window.scrollTo({
			left: origin.value.scrollX,
			top: origin.value.scrollY,
			behavior: 'instant',
		})
}
const motionStyle = computed(() => ({
	'--card-x': '0px',
	'--card-y': '12px',
	'--card-sx': '.98',
	'--card-sy': '.98',
}))
const contentProps = computed(() => ({
	style: motionStyle.value,
	onOpenAutoFocus: () => undefined,
}))
</script>
<template>
	<UModal
		:open="open"
		:title="t(activityId === 'new' ? 'ui.activityCreate' : 'ui.viewActivity')"
		:description="t('ui.activities')"
		:dismissible="!busy"
		:content="contentProps"
		:ui="{
			content: `post-overlay-modal ring-0 divide-y-0 activity-overlay-modal ${activityId === 'new' ? 'activity-create-modal' : ''}`,
			overlay: 'post-overlay-backdrop',
		}"
		@update:open="change"
		@after:leave="restore"
	>
		<template #content
			><UButton
				class="post-overlay-close"
				icon="i-lucide-x"
				color="neutral"
				variant="soft"
				:aria-label="t('ui.close')"
				:disabled="busy"
				@click="closeActivity"
			/>
			<div class="activity-overlay-scroll">
				<Suspense
					><ActivityForm
						v-if="activityId === 'new'"
						@created="created"
						@busy="busy = $event"
					/><ActivityDetailContent
						v-else-if="activityId"
						:key="activityId"
						:activity-id="activityId"
						embedded
					/><template #fallback
						><p class="empty-state" role="status">
							{{ t('ui.loading') }}
						</p></template
					></Suspense
				>
			</div></template
		>
	</UModal>
</template>
