<script setup lang="ts">
const route = useRoute()
await navigateTo(
	{ path: '/books', query: { ...route.query, book: String(route.params.id) } },
	{ replace: true, redirectCode: 302 },
)
</script>
<template><span /></template>
