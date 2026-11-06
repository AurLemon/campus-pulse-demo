<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()
const workspace = computed(() =>
	['/community', '/books', '/agents'].includes(route.path),
)
const mobileControlsOpen = useState('studio-mobile-controls-open', () => false)
const sidebarCollapsed = useState('studio-sidebar-collapsed', () => false)
const controlsId = computed(() =>
	route.path === '/books'
		? 'book-controls'
		: route.path === '/agents'
			? 'agent-controls'
			: 'studio-controls',
)
function toggleMobileControls() {
	mobileControlsOpen.value = !mobileControlsOpen.value
	if (mobileControlsOpen.value) sidebarCollapsed.value = false
}
watch(
	() => route.path,
	() => {
		mobileControlsOpen.value = false
	},
)
const reducedMotion = ref(false)
let motionPreference: MediaQueryList | undefined
function updateMotionPreference() {
	reducedMotion.value = motionPreference?.matches ?? false
}
onMounted(() => {
	motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
	updateMotionPreference()
	motionPreference.addEventListener('change', updateMotionPreference)
})
onBeforeUnmount(() =>
	motionPreference?.removeEventListener('change', updateMotionPreference),
)
const pageTransition = computed(() => ({
	name: 'studio-route',
	mode: 'out-in' as const,
	duration: reducedMotion.value ? 0 : { enter: 220, leave: 120 },
}))
useHead(() => ({
	title: t('studio'),
	link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
}))
</script>

<template>
	<UApp>
		<div :class="{ 'studio-app-workspace': workspace }">
			<StudioHeader v-if="workspace">
				<UButton
					class="mobile-control-button"
					color="neutral"
					variant="ghost"
					icon="i-lucide-sliders-horizontal"
					:aria-label="t('controls')"
					:aria-expanded="mobileControlsOpen"
					:aria-controls="controlsId"
					@click="toggleMobileControls"
				/>
			</StudioHeader>
			<NuxtPage :transition="pageTransition" />
		</div>
	</UApp>
</template>
