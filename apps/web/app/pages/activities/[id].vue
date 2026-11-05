<script setup lang="ts">
const route = useRoute()
await navigateTo(
	{
		path: '/activities',
		query: { ...route.query, activity: String(route.params.id) },
	},
	{ replace: true, redirectCode: 302 },
)
</script>
<template><span /></template>
