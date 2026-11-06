<script setup lang="ts">
definePageMeta({
	middleware: (to) => {
		const {
			activity: _activity,
			compose: _compose,
			book: _book,
			...query
		} = to.query
		return navigateTo(
			{
				path: '/',
				query: { ...query, post: String(to.params.id) },
				hash: to.hash,
			},
			{ replace: true, redirectCode: 302 },
		)
	},
})
</script>
<template><span /></template>
