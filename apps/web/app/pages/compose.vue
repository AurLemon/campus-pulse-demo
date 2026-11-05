<script setup lang="ts">
const query = { ...useRoute().query }
delete query.post
delete query.activity
delete query.auth
delete query.next
await navigateTo(
	{ path: '/', query: { ...query, compose: '1' } },
	{ replace: true, redirectCode: 302 },
)
</script>
<template><div /></template>
