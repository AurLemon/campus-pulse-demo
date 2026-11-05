<script setup lang="ts">
definePageMeta({ layout: false })
if (!import.meta.dev)
	throw createError({ statusCode: 404, statusMessage: 'Not Found' })
const { t } = useI18n()
const failed = ref(false)
onMounted(async () => {
	const ticket = new URLSearchParams(window.location.hash.slice(1)).get(
		'ticket',
	)
	window.history.replaceState(
		window.history.state,
		'',
		window.location.pathname,
	)
	if (!ticket || !/^[A-Za-z0-9_-]{40,128}$/.test(ticket)) {
		failed.value = true
		return
	}
	try {
		await $fetch('/api/dev/studio/consume', {
			method: 'POST',
			body: { ticket },
			headers: { 'x-campus-studio': '1' },
			retry: 0,
			timeout: 8000,
		})
		window.location.replace('/')
	} catch {
		failed.value = true
	}
})
</script>
<template>
	<main class="studio-login-page">
		<BrandMark :animated="!failed" />
		<p :role="failed ? 'alert' : 'status'">
			{{ t(failed ? 'ui.studioLoginInvalid' : 'ui.studioLoginWorking') }}
		</p>
		<UButton v-if="failed" to="/" color="neutral" variant="soft">{{
			t('ui.studioLoginReturn')
		}}</UButton>
	</main>
</template>
<style scoped>
.studio-login-page {
	min-height: 100dvh;
	padding: 32px;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 24px;
	text-align: center;
	background: var(--canvas);
	color: var(--muted);
}
.studio-login-page p {
	max-width: 30rem;
}
</style>
