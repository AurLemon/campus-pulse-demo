<script setup lang="ts">
const props = defineProps<{ name: string; large?: boolean }>()
const hue = computed(() =>
	Array.from(props.name).reduce(
		(n, c) => (n * 31 + (c.codePointAt(0) ?? 0)) % 360,
		0,
	),
)
const initial = computed(() => Array.from(props.name)[0] ?? '?')
</script>
<template>
	<span
		class="avatar user-avatar"
		:class="{ large }"
		:style="{ '--avatar-hue': hue }"
		aria-hidden="true"
		>{{ initial }}</span
	>
</template>
<style scoped>
.user-avatar {
	background: hsl(var(--avatar-hue) 48% 94%);
	color: hsl(var(--avatar-hue) 40% 35%);
}
:global(.dark) .user-avatar {
	background: hsl(var(--avatar-hue) 25% 24%);
	color: hsl(var(--avatar-hue) 50% 80%);
}
</style>
