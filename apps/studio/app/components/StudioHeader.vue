<script setup lang="ts">
const { t } = useI18n()
const accountSwitchAvailable = import.meta.dev
</script>
<template>
	<header class="studio-header">
		<NuxtLink to="/" class="studio-brand" :aria-label="t('studio')">
			<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
				<path
					d="M15 38V11h11c12 0 12 18 0 18H15"
					stroke="currentColor"
					stroke-width="3.2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>{{ t('studio') }}</span>
		</NuxtLink>
		<div class="header-meta">
			<StudioAccountSwitcher
				v-if="accountSwitchAvailable"
			/><slot /><StudioThemeSwitcher />
		</div>
	</header>
</template>
