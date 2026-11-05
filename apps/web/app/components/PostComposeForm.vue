<script setup lang="ts">
import type { ActivityView, MediaAsset } from '@campus/contracts'
const { openAuth } = useAuthOverlay()
interface PostDraft {
	title: string
	body: string
	tags: string
	activityId: string
	purpose: string
	posterTemplate: 'orbit' | 'quote' | 'note'
	posterAspect: 'portrait' | 'square' | 'landscape'
	posterHighlight: string
	media: MediaAsset[]
}
const emit = defineEmits<{
	busy: [value: boolean]
	dirty: [value: boolean]
	created: [id: string]
}>()
const apiError = useApiError()

const { t } = useI18n(),
	{ topicId, topicLabel } = useTopics(),
	{ user, data: campus } = await useCampus(),
	fetcher = useRequestFetch()
const { data: activities } = await useAsyncData('compose-activities', () =>
	fetcher<{ items: ActivityView[] }>('/api/activities', { query: { all: 1 } }),
)
const drafts = useState<Record<string, PostDraft>>('post-drafts', () => ({})),
	owner = computed(() => user.value?.id ?? 'guest')
const blank = (): PostDraft => ({
	title: '',
	body: '',
	tags: '',
	activityId: '__none',
	purpose: 'DISCUSSION',
	posterTemplate: 'orbit',
	posterAspect: 'portrait',
	posterHighlight: '',
	media: [],
})
watch(
	owner,
	(value) => {
		drafts.value[value] = { ...blank(), ...drafts.value[value] }
	},
	{ immediate: true, flush: 'sync' },
)
const draft = computed(() => drafts.value[owner.value]!),
	busy = ref(false),
	uploading = ref(false),
	message = ref('')
let epoch = 0
let controller: AbortController | undefined
watch(
	owner,
	() => {
		epoch++
		controller?.abort()
		busy.value = false
		uploading.value = false
		message.value = ''
		clear()
	},
	{ flush: 'sync' },
)
watch(
	[busy, uploading],
	([saving, sending]) => emit('busy', saving || sending),
	{ immediate: true },
)
watch(
	draft,
	(value) =>
		emit(
			'dirty',
			!!(
				value.title ||
				value.body ||
				value.tags ||
				value.media.length ||
				value.activityId !== '__none' ||
				value.purpose !== 'DISCUSSION' ||
				value.posterTemplate !== 'orbit' ||
				value.posterAspect !== 'portrait' ||
				value.posterHighlight
			),
		),
	{ deep: true, immediate: true },
)
onBeforeUnmount(() => {
	epoch++
	controller?.abort()
})
const { fields, clear, capture } = useFieldErrors('post')
const purposeItems = computed(() =>
	['DISCUSSION', 'RECRUITMENT', 'REVIEW', 'GUIDE'].map((value) => ({
		value,
		label: t(`ui.${value}`),
	})),
)
const activityItems = computed(() => [
	{ label: t('ui.noActivity'), value: '__none' },
	...(activities.value?.items ?? []).map((a) => ({
		value: a.id,
		label: a.title,
	})),
])
async function upload(event: Event) {
	const input = event.target as HTMLInputElement
	if (!input.files?.length || busy.value || uploading.value || !user.value)
		return
	const current = draft.value,
		requestEpoch = epoch
	controller = new AbortController()
	const signal = controller.signal
	uploading.value = true
	message.value = ''
	try {
		for (const file of Array.from(input.files).slice(
			0,
			8 - current.media.length,
		)) {
			const form = new FormData()
			form.append('file', file)
			const media = await $fetch<MediaAsset>('/api/media', {
				method: 'POST',
				body: form,
				signal,
			})
			if (requestEpoch !== epoch) return
			current.media.push(media)
		}
	} catch (e) {
		if (requestEpoch === epoch && !signal.aborted) message.value = apiError(e)
	} finally {
		if (requestEpoch === epoch) uploading.value = false
		input.value = ''
	}
}
async function submit() {
	if (
		busy.value ||
		uploading.value ||
		!user.value ||
		!draft.value.title.trim() ||
		!draft.value.body.trim()
	)
		return
	const current = structuredClone(toRaw(draft.value)),
		requestOwner = owner.value,
		requestEpoch = epoch
	clear()
	if (
		current.posterHighlight.trim() &&
		!current.title.includes(current.posterHighlight.trim())
	) {
		fields.value.posterHighlight = t('compose.highlightInvalid')
		await nextTick()
		document.getElementById('post-posterHighlight')?.focus()
		return
	}
	controller = new AbortController()
	const signal = controller.signal
	busy.value = true
	message.value = ''
	clear()
	try {
		const result = await $fetch<{ id: string }>('/api/posts', {
			method: 'POST',
			signal,
			body: {
				title: current.title,
				body: current.body,
				tags: [
					...new Set(
						current.tags
							.split(/[,，/]/)
							.map(topicId)
							.filter(Boolean),
					),
				],
				activityId: current.activityId === '__none' ? null : current.activityId,
				purpose: current.purpose,
				kind: current.body.length > 600 ? 'ARTICLE' : 'TEXT',
				mediaIds: current.media.map((m) => m.id),
				posterTemplate: current.posterTemplate,
				posterAspect: current.posterAspect,
				posterHighlight: current.posterHighlight.trim(),
			},
		})
		if (requestEpoch !== epoch || owner.value !== requestOwner) return
		drafts.value[requestOwner] = blank()
		busy.value = false
		emit('busy', false)
		emit('dirty', false)
		emit('created', result.id)
	} catch (e) {
		if (requestEpoch === epoch && !signal.aborted) {
			message.value = apiError(e)
			await capture(e)
		}
	} finally {
		if (requestEpoch === epoch) busy.value = false
	}
}
</script>
<template>
	<div class="reading-page compose-page">
		<h1>{{ t('ui.publish') }}</h1>
		<p class="muted">{{ t('ui.draftHint') }}</p>
		<div v-if="!user" class="empty-state">
			<p>{{ t('ui.loginRequired') }}</p>
			<UButton @click="openAuth()">{{ t('ui.login') }}</UButton>
		</div>
		<form v-else class="editor-form" @submit.prevent="submit">
			<fieldset :disabled="busy || uploading" class="compose-fields">
				<div class="compose-preview">
					<ContentCover
						:title="draft.title || t('ui.titlePlaceholder')"
						:media="draft.media[0]"
						:tags="draft.tags.split(/[,，/]/)"
						:poster-template="draft.posterTemplate"
						:poster-aspect="draft.posterAspect"
						:poster-highlight="draft.posterHighlight.trim()"
					/>
					<div>
						<h2>{{ t('ui.cover') }}</h2>
						<p class="muted small">{{ t('ui.imageRequired') }}</p>
						<UInput
							type="file"
							accept="image/jpeg,image/png,image/webp"
							multiple
							:disabled="busy || uploading || draft.media.length >= 8"
							:aria-label="t('ui.upload')"
							@change="upload"
						/>
						<p class="muted small">{{ t('ui.uploadHint') }}</p>
						<p v-if="uploading" role="status">{{ t('ui.uploading') }}</p>
					</div>
				</div>
				<div v-if="draft.media.length" class="upload-thumbnails">
					<div v-for="(image, i) in draft.media" :key="image.id">
						<img :src="image.url" :alt="image.alt" /><UButton
							icon="i-lucide-x"
							size="xs"
							color="neutral"
							:aria-label="t('ui.remove')"
							:disabled="busy || uploading"
							@click="draft.media.splice(i, 1)"
						/>
					</div>
				</div>
				<div class="poster-options">
					<UFormField
						:label="t('compose.template')"
						:error="fields.posterTemplate"
						><USelect
							id="post-posterTemplate"
							v-model="draft.posterTemplate"
							:items="[
								{ value: 'orbit', label: t('compose.orbit') },
								{ value: 'quote', label: t('compose.quote') },
								{ value: 'note', label: t('compose.note') },
							]"
							class="w-full"
					/></UFormField>
					<UFormField :label="t('compose.aspect')" :error="fields.posterAspect"
						><USelect
							id="post-posterAspect"
							v-model="draft.posterAspect"
							:items="[
								{ value: 'portrait', label: t('compose.portrait') },
								{ value: 'square', label: t('compose.square') },
								{ value: 'landscape', label: t('compose.landscape') },
							]"
							class="w-full"
					/></UFormField>
					<UFormField
						:label="t('compose.highlight')"
						:error="fields.posterHighlight"
						:description="t('compose.highlightHint')"
						><UInput
							id="post-posterHighlight"
							v-model="draft.posterHighlight"
							:maxlength="40"
							class="w-full"
					/></UFormField>
				</div>
				<UFormField :label="t('ui.title')" :error="fields.title" required
					><UInput
						id="post-title"
						v-model="draft.title"
						class="w-full"
						size="xl"
						required
						:maxlength="120"
						:placeholder="t('ui.titlePlaceholder')" /></UFormField
				><UFormField :label="t('ui.contentType')" :error="fields.purpose"
					><USelect
						id="post-purpose"
						v-model="draft.purpose"
						:items="purposeItems"
						class="w-full sm:w-56" /></UFormField
				><UFormField :label="t('ui.body')" :error="fields.body" required
					><UTextarea
						id="post-body"
						v-model="draft.body"
						class="w-full"
						:rows="10"
						required
						:maxlength="20000"
						:placeholder="t('ui.bodyPlaceholder')"
					/><span class="field-counter"
						>{{ draft.body.length }} / 20000</span
					></UFormField
				><UFormField
					:label="t('ui.tags')"
					:error="fields.tags"
					:description="t('ui.tagsHint')"
					><UInput id="post-tags" v-model="draft.tags" class="w-full" />
					<div class="suggested-topics">
						<UButton
							v-for="topic in campus?.topics"
							:key="topic"
							size="xs"
							color="neutral"
							variant="soft"
							@click="
								draft.tags = [
									...new Set([
										...draft.tags.split(/[,，/]/).filter(Boolean),
										topicLabel(topic),
									]),
								].join(', ')
							"
							>#{{ topicLabel(topic) }}</UButton
						>
					</div></UFormField
				><UFormField :label="t('ui.related')" :error="fields.activityId"
					><USelect
						id="post-activityId"
						v-model="draft.activityId"
						:items="activityItems"
						class="w-full"
				/></UFormField>
			</fieldset>
			<p v-if="message" class="error" role="alert">{{ message }}</p>
			<UButton
				type="submit"
				color="primary"
				variant="soft"
				size="lg"
				icon="i-lucide-send"
				:loading="busy"
				:disabled="
					busy || uploading || !draft.title.trim() || !draft.body.trim()
				"
				>{{ t('ui.publish') }}</UButton
			>
		</form>
	</div>
</template>

<style scoped>
.compose-page {
	width: 100%;
	max-width: none;
	padding: 24px;
}
.compose-page h1 {
	font-size: 1.35rem;
	margin: 0 36px 8px 0;
}
.compose-fields {
	display: grid;
	gap: 20px;
	min-width: 0;
	border: 0;
	padding: 0;
	margin: 0;
}
.poster-options {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}
.poster-options > :last-child {
	grid-column: 1/-1;
}
.compose-preview {
	display: grid;
	grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
	gap: 20px;
	align-items: start;
}
.compose-preview :deep(.content-cover) {
	width: 100%;
	height: auto;
}
@media (max-width: 600px) {
	.compose-page {
		padding: 20px 16px;
	}
	.compose-preview {
		grid-template-columns: minmax(0, 120px) minmax(0, 1fr);
		gap: 12px;
	}
}
</style>
