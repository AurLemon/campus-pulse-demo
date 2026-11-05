<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { closeAuth } = useAuthOverlay()
const mode = computed(() =>
	route.query.auth === 'register' ? 'register' : 'login',
)
const open = computed(
	() => route.query.auth === 'login' || route.query.auth === 'register',
)
const busy = ref(false)
const trigger = shallowRef<HTMLElement | null>(null)
watch(
	open,
	(value, previous) => {
		if (value && !previous)
			trigger.value =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null
	},
	{ immediate: true },
)
function restoreFocus() {
	if (trigger.value?.isConnected) trigger.value.focus({ preventScroll: true })
	trigger.value = null
}
const removeGuard = router.beforeEach((to) => {
	if (busy.value && open.value && to.fullPath !== route.fullPath) return false
})
onBeforeUnmount(removeGuard)
async function success(userId: string) {
	busy.value = false
	const next = typeof route.query.next === 'string' ? route.query.next : ''
	if (next === 'profile' && userId)
		await navigateTo(`/users/${userId}`, { replace: true })
	else if (
		next.startsWith('/') &&
		!next.startsWith('//') &&
		!next.includes('\\') &&
		!next.startsWith('/login') &&
		!next.startsWith('/register')
	)
		await navigateTo(next, { replace: true })
	else await closeAuth(true)
}
function change(value: boolean) {
	if (!value && !busy.value) void closeAuth()
}
</script>
<template>
	<UModal
		:open="open"
		:title="t(mode === 'register' ? 'ui.registerTitle' : 'ui.authTitle')"
		:dismissible="!busy"
		:ui="{ content: 'auth-modal ring-0 divide-y-0', overlay: 'auth-backdrop' }"
		@update:open="change"
		@after:leave="restoreFocus"
	>
		<template #content>
			<UButton
				class="auth-close"
				icon="i-lucide-x"
				color="neutral"
				variant="ghost"
				:disabled="busy"
				:aria-label="t('ui.close')"
				@click="closeAuth()"
			/>
			<Suspense>
				<AuthForm
					v-if="open"
					:mode="mode"
					@busy="busy = $event"
					@success="success"
				/>
				<template #fallback
					><p class="empty-state" role="status">
						{{ t('ui.loading') }}
					</p></template
				>
			</Suspense>
		</template>
	</UModal>
</template>
