<script setup lang="ts">
const mode = useColorMode()
const { setTheme } = useThemeTransition()
const { t } = useI18n()
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const options = computed(() => [
	{ value: 'light', icon: 'i-lucide-sun', label: t('ui.light') },
	{ value: 'dark', icon: 'i-lucide-moon', label: t('ui.dark') },
	{ value: 'system', icon: 'i-lucide-monitor', label: t('ui.system') },
])
</script>
<template>
	<div class="theme-switcher" role="group" :aria-label="t('ui.theme')">
		<template v-for="option in options" :key="option.value">
			<UTooltip :text="option.label"
				><UButton
					:icon="option.icon"
					color="neutral"
					variant="ghost"
					class="theme-option"
					:class="{
						'theme-active': mounted && mode.preference === option.value,
					}"
					:aria-label="option.label"
					:aria-pressed="mounted && mode.preference === option.value"
					@click="setTheme(option.value)"
			/></UTooltip>
		</template>
	</div>
</template>
