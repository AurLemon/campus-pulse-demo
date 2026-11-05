<script setup lang="ts">
definePageMeta({ alias: '/register' })
const route = useRoute()
await navigateTo(
	{
		path: '/',
		query: {
			auth:
				route.path === '/register' || route.query.register === '1'
					? 'register'
					: 'login',
			...(typeof route.query.next === 'string'
				? { next: route.query.next }
				: {}),
		},
	},
	{ replace: true, redirectCode: 302 },
)
</script>
<template><span /></template>
