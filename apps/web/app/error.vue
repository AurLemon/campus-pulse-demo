<script setup lang="ts">
import type { NuxtError } from '#app'
const props = defineProps<{ error: NuxtError }>()
const { t } = useI18n()
</script>
<template>
	<main class="error-page">
		<BrandMark />
		<p class="eyebrow">{{ props.error.statusCode ?? 500 }}</p>
		<h1>
			{{ t(props.error.statusCode === 404 ? 'ui.empty' : 'ui.error') }}
		</h1>
		<UButton @click="clearError({ redirect: '/' })">{{
			t('ui.goHome')
		}}</UButton>
	</main>
</template>
