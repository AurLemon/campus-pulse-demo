<script setup lang="ts">
defineProps<{ kind: 'heart' | 'star'; active?: boolean }>()
</script>
<template>
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.7"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		:class="{ 'reaction-icon-active': active }"
	>
		<path
			v-if="kind === 'heart'"
			d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"
		/>
		<path
			v-else
			d="m12 3 2.78 5.63L21 9.54l-4.5 4.39L17.56 20 12 17.08 6.44 20l1.06-6.07L3 9.54l6.22-.91L12 3Z"
		/>
	</svg>
</template>
<style scoped>
svg {
	width: 22px;
	height: 22px;
	flex-shrink: 0;
}
.reaction-icon-active {
	fill: currentColor;
}
</style>
