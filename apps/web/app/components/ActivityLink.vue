<script setup lang="ts">
const props = defineProps<{ id: string }>()
const { openActivity } = useActivityOverlay()
function open(event: MouseEvent) {
	void openActivity(event, props.id)
}
</script>
<template>
	<NuxtLink :to="`/activities/${id}`" :data-activity-link="id" @click="open"
		><slot
	/></NuxtLink>
</template>
