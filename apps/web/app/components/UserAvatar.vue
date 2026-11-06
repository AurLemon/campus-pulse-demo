<script setup lang="ts">
import { defaultUserAvatar } from '@campus/contracts'
const props = defineProps<{
	name: string
	large?: boolean
	src?: string | null
}>()
const index = useState<Record<string, string>>(
	'public-avatar-index',
	() => ({}),
)
const failed = ref(false)
const fallback = computed(() => defaultUserAvatar(`display:${props.name}`))
const source = computed(() =>
	failed.value
		? fallback.value
		: props.src || index.value[props.name] || fallback.value,
)
watch(
	() => [props.src, props.name],
	() => {
		failed.value = false
	},
)
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
		><img
			v-if="source"
			:src="source"
			alt=""
			loading="lazy"
			decoding="async"
			@error="failed = true"
		/><template v-else>{{ initial }}</template></span
	>
</template>
<style scoped>
.user-avatar img {
	width: 100%;
	height: 100%;
	display: block;
	object-fit: cover;
	border-radius: inherit;
}
.user-avatar {
	overflow: hidden;
	background: hsl(var(--avatar-hue) 48% 94%);
	color: hsl(var(--avatar-hue) 40% 35%);
}
:global(.dark) .user-avatar {
	background: hsl(var(--avatar-hue) 25% 24%);
	color: hsl(var(--avatar-hue) 50% 80%);
}
</style>
