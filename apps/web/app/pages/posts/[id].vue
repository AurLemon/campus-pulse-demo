<script setup lang="ts">
const route = useRoute()
</script>
<template>
	<PostDetailContent
		:key="String(route.params.id)"
		:post-id="String(route.params.id)"
	/>
</template>
