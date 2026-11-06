<script setup lang="ts">
import type { MediaAsset } from '@campus/contracts'
const media = defineModel<MediaAsset[]>({ default: () => [] })
const props = defineProps<{ disabled?: boolean; scope?: string }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { t } = useI18n()
const error = ref('')
const apiError = useApiError()
const loading = ref(false)
let disposed = false
const controller = new AbortController()
onBeforeUnmount(() => {
	disposed = true
	controller.abort()
})
async function upload(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	const scope = props.scope
	if (!file) return
	loading.value = true
	emit('busy', true)
	error.value = ''
	try {
		const form = new FormData()
		form.append('file', file)
		form.append('alt', file.name)
		const asset = await $fetch<MediaAsset>('/api/media', {
			method: 'POST',
			body: form,
			signal: controller.signal,
		})
		if (!disposed && props.scope === scope)
			media.value = [...media.value, asset]
	} catch (failure) {
		if (!disposed && props.scope === scope) error.value = apiError(failure)
	} finally {
		loading.value = false
		if (!disposed && props.scope === scope) emit('busy', false)
		input.value = ''
	}
}
</script>
<template>
	<div class="message-media-picker">
		<div v-if="media.length" class="message-media-picker__images">
			<div v-for="asset in media" :key="asset.id">
				<img :src="asset.url" :alt="asset.alt" /><UButton
					icon="i-lucide-x"
					size="xs"
					color="neutral"
					variant="soft"
					:aria-label="t('ui.cancel')"
					:disabled="disabled || loading"
					@click="media = media.filter((row) => row.id !== asset.id)"
				/>
			</div>
		</div>
		<label v-if="media.length < 4" class="message-media-picker__upload"
			><UIcon name="i-lucide-image-plus" /><span>{{
				t('messages.addImage')
			}}</span
			><input
				type="file"
				accept="image/jpeg,image/png,image/webp"
				:disabled="disabled || loading"
				@change="upload"
		/></label>
		<p v-if="error" class="error" role="alert">{{ error }}</p>
	</div>
</template>
<style scoped>
.message-media-picker__images {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	margin: 8px 0;
}
.message-media-picker__images > div {
	position: relative;
}
.message-media-picker__images img {
	width: 72px;
	height: 72px;
	object-fit: cover;
	border-radius: 8px;
}
.message-media-picker__images button {
	position: absolute;
	right: 0;
	top: 0;
}
.message-media-picker__upload {
	display: inline-flex;
	position: relative;
	gap: 6px;
	align-items: center;
	min-height: 36px;
	font-size: 12px;
	color: var(--muted);
	cursor: pointer;
}
.message-media-picker__upload input {
	position: absolute;
	inset: 0;
	opacity: 0;
	width: 100%;
	cursor: pointer;
}
</style>
