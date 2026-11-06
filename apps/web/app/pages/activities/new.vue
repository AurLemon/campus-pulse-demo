<script setup lang="ts">
definePageMeta({
	middleware: (to) => {
		const { post: _post, compose: _compose, book: _book, ...query } = to.query
		return navigateTo(
			{
				path: '/activities',
				query: { ...query, activity: 'new' },
				hash: to.hash,
			},
			{ replace: true, redirectCode: 302 },
		)
	},
})
</script>
<template><span /></template>
