<script setup lang="ts">
const { mode, selectTheme } = useStudioTheme()
const { t } = useI18n()
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const options = computed(() => [
	{ value: 'light' as const, icon: 'i-lucide-sun', label: t('light') },
	{ value: 'dark' as const, icon: 'i-lucide-moon', label: t('dark') },
	{ value: 'system' as const, icon: 'i-lucide-monitor', label: t('system') },
])
</script>
<template>
	<div class="studio-theme-switcher" role="group" :aria-label="t('theme')">
		<UTooltip
			v-for="option in options"
			:key="option.value"
			:text="option.label"
		>
			<UButton
				:icon="option.icon"
				color="neutral"
				variant="ghost"
				class="studio-theme-option"
				:class="{ active: mounted && mode.preference === option.value }"
				:aria-label="option.label"
				:aria-pressed="mounted && mode.preference === option.value"
				@click="selectTheme(option.value)"
			/>
		</UTooltip>
	</div>
</template>
