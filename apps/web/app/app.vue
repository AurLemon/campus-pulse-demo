<script setup lang="ts">
import { zh_cn } from '@nuxt/ui/locale'
const { t } = useI18n()
useHead(() => ({
	title: t('app.title'),
	link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
	meta: [{ name: 'theme-color', content: '#101722' }],
}))
</script>
<template>
	<UApp :locale="zh_cn">
		<NuxtLayout
			><NuxtPage
				:keepalive="false"
				:transition="{ name: 'page', mode: 'out-in' }"
		/></NuxtLayout>
		<ClientOnly>
			<PostOverlay />
			<ActivityOverlay />
			<AuthOverlay />
			<PostComposeOverlay />
		</ClientOnly>
	</UApp>
</template>
