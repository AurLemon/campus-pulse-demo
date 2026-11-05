<script setup lang="ts">
withDefaults(defineProps<{ animated?: boolean; compact?: boolean }>(), {
	animated: false,
	compact: false,
})
const { t } = useI18n()
</script>
<template>
	<span
		class="brand-lockup brand-stacked"
		:class="{ 'brand-animated': animated }"
	>
		<svg
			class="brand-mark brand-letter"
			viewBox="0 0 48 48"
			fill="none"
			aria-hidden="true"
		>
			<path
				class="brand-line"
				d="M15 38V11h11c12 0 12 18 0 18H15"
				pathLength="105"
				stroke="currentColor"
				stroke-width="3.2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		<span v-if="!compact" class="brand-words"
			><strong>{{ t('ui.brand') }}</strong></span
		>
	</span>
</template>
