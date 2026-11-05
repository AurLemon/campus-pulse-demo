<script setup lang="ts">
const { t } = useI18n()
useHead(() => ({
	title: t('studio'),
	link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
}))
</script>

<template>
	<UApp><NuxtPage /></UApp>
</template>
