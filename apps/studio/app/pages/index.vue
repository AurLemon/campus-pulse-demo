<script setup lang="ts">
const route = useRoute()
await navigateTo(
	{ path: '/community', query: route.query, hash: route.hash },
	{ replace: true },
)
</script>

<template><div /></template>
