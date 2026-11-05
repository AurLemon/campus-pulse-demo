<script setup lang="ts">
import { CAMPUSES, type MediaAsset } from '@campus/contracts'
const { openAuth } = useAuthOverlay()
const campusChoices: string[] = [...CAMPUSES]
interface Draft {
	title: string
	body: string
	tags: string
	campus: string
	location: string
	startsAt: string
	endsAt: string
	deadline: string
	capacity: number
	cover: MediaAsset | null
}
const emit = defineEmits<{ created: [id: string]; busy: [value: boolean] }>()
const { t } = useI18n(),
	{ topicId } = useTopics(),
	router = useRouter(),
	apiError = useApiError()
const { fields, clear, capture } = useFieldErrors('new-activity')
const drafts = useState<Record<string, Draft>>('activity-drafts', () => ({}))
const { user } = await useCampus()
const key = computed(() => user.value?.id ?? 'guest')
const allowed = computed(
	() => user.value?.role === 'ORGANIZER' || user.value?.role === 'ADMIN',
)
function freshDraft(): Draft {
	return {
		title: '',
		body: '',
		tags: '',
		campus: CAMPUSES.some((campus) => campus === user.value?.campus)
			? user.value!.campus
			: CAMPUSES[0],
		location: '',
		startsAt: '',
		endsAt: '',
		deadline: '',
		capacity: 30,
		cover: null,
	}
}
watch(
	key,
	(value) => {
		if (!drafts.value[value]) drafts.value[value] = freshDraft()
	},
	{ immediate: true, flush: 'sync' },
)
const draft = computed(() => drafts.value[key.value]!)

const submitted = ref(false)
const busy = ref(false),
	uploading = ref(false),
	message = ref('')
const dirty = computed(
	() =>
		!!(
			draft.value.title ||
			draft.value.body ||
			draft.value.tags ||
			draft.value.location ||
			draft.value.startsAt ||
			draft.value.endsAt ||
			draft.value.deadline ||
			draft.value.cover ||
			draft.value.capacity !== 30 ||
			draft.value.campus !==
				(CAMPUSES.some((c) => c === user.value?.campus)
					? user.value?.campus
					: CAMPUSES[0])
		),
)
let removeGuard: (() => void) | undefined
let uploadController: AbortController | undefined
function beforeUnload(event: BeforeUnloadEvent) {
	if (submitted.value || (!dirty.value && !busy.value && !uploading.value))
		return
	event.preventDefault()
	event.returnValue = ''
}
onMounted(() => {
	removeGuard = router.beforeEach((to, from) => {
		if (from.query.activity !== 'new' || to.query.activity === 'new')
			return true
		if (submitted.value) return true
		if (busy.value || uploading.value) return false
		return !dirty.value || window.confirm(t('ui.leaveDraft'))
	})
	window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
	removeGuard?.()
	uploadController?.abort()
	window.removeEventListener('beforeunload', beforeUnload)
	emit('busy', false)
})
watch([busy, uploading], () => emit('busy', busy.value || uploading.value), {
	flush: 'sync',
	immediate: true,
})
async function upload(event: Event) {
	const input = event.target as HTMLInputElement,
		file = input.files?.[0]
	if (!file || busy.value || uploading.value) return
	const destination = draft.value
	uploading.value = true
	message.value = ''
	try {
		uploadController = new AbortController()
		const form = new FormData()
		form.append('file', file)
		destination.cover = await $fetch<MediaAsset>('/api/media', {
			method: 'POST',
			body: form,
			signal: uploadController.signal,
		})
	} catch (e) {
		message.value = apiError(e)
	} finally {
		uploadController = undefined
		uploading.value = false
		input.value = ''
	}
}
async function submit() {
	if (busy.value || uploading.value) return
	message.value = ''
	clear()
	const value = draft.value,
		ownerKey = key.value
	for (const name of ['title', 'body', 'location'] as const) {
		if (!value[name].trim()) fields.value[name] = t('ui.required')
	}
	if (!CAMPUSES.some((campus) => campus === value.campus))
		fields.value.campus = t('ui.invalid')
	if (
		!Number.isInteger(value.capacity) ||
		value.capacity < 1 ||
		value.capacity > 10000
	)
		fields.value.capacity = t('ui.invalid')
	const startsAt = Date.parse(value.startsAt),
		endsAt = Date.parse(value.endsAt),
		deadline = Date.parse(value.deadline)
	for (const name of ['startsAt', 'endsAt', 'deadline'] as const) {
		if (!Number.isFinite(Date.parse(value[name])))
			fields.value[name] = t('ui.invalid')
	}
	if (Number.isFinite(startsAt) && startsAt <= Date.now())
		fields.value.startsAt = t('ui.invalid')
	if (
		Number.isFinite(endsAt) &&
		Number.isFinite(startsAt) &&
		endsAt <= startsAt
	)
		fields.value.endsAt = t('ui.invalid')
	if (
		Number.isFinite(deadline) &&
		(deadline <= Date.now() ||
			(Number.isFinite(startsAt) && deadline > startsAt))
	)
		fields.value.deadline = t('ui.invalid')
	if (Object.keys(fields.value).length) {
		await nextTick()
		document
			.getElementById(`new-activity-${Object.keys(fields.value)[0]}`)
			?.focus()
		return
	}
	busy.value = true
	try {
		const result = await $fetch<{ id: string }>('/api/activities', {
			method: 'POST',
			body: {
				...value,
				cover: undefined,
				coverId: value.cover?.id ?? null,
				tags: [
					...new Set(
						value.tags
							.split(/[,，/]/)
							.map(topicId)
							.filter(Boolean),
					),
				],
				startsAt: new Date(value.startsAt).toISOString(),
				endsAt: new Date(value.endsAt).toISOString(),
				deadline: new Date(value.deadline).toISOString(),
			},
		})
		submitted.value = true
		drafts.value[ownerKey] = freshDraft()
		await Promise.allSettled([
			refreshNuxtData(['managed-activities', 'activity-list', 'sidebar']),
		])
		emit('created', result.id)
	} catch (e) {
		message.value = apiError(e)
		await capture(e)
	} finally {
		busy.value = false
	}
}
</script>
<template>
	<form v-if="allowed" class="activity-create-form" @submit.prevent="submit">
		<h1>{{ t('ui.activityCreate') }}</h1>
		<fieldset class="contents" :disabled="busy || uploading">
			<UFormField :label="t('ui.title')" :error="fields.title" required
				><UInput
					id="new-activity-title"
					v-model="draft.title"
					required
					:maxlength="120"
					class="w-full"
			/></UFormField>
			<UFormField :label="t('ui.description')" :error="fields.body" required
				><UTextarea
					id="new-activity-body"
					v-model="draft.body"
					required
					:rows="4"
					:maxlength="10000"
					class="w-full"
			/></UFormField>
			<div class="activity-form-grid">
				<UFormField :label="t('ui.campus')" :error="fields.campus" required
					><USelect
						id="new-activity-campus"
						v-model="draft.campus"
						:items="campusChoices"
						class="w-full" /></UFormField
				><UFormField :label="t('ui.location')" :error="fields.location" required
					><UInput
						id="new-activity-location"
						v-model="draft.location"
						required
						:maxlength="100"
						class="w-full"
				/></UFormField>
			</div>
			<div class="activity-form-grid">
				<UFormField :label="t('ui.startsAt')" :error="fields.startsAt" required
					><UInput
						id="new-activity-startsAt"
						v-model="draft.startsAt"
						type="datetime-local"
						required
						class="w-full" /></UFormField
				><UFormField :label="t('ui.endsAt')" :error="fields.endsAt" required
					><UInput
						id="new-activity-endsAt"
						v-model="draft.endsAt"
						type="datetime-local"
						required
						class="w-full" /></UFormField
				><UFormField
					:label="t('ui.deadlineAt')"
					:error="fields.deadline"
					required
					><UInput
						id="new-activity-deadline"
						v-model="draft.deadline"
						type="datetime-local"
						required
						class="w-full" /></UFormField
				><UFormField
					:label="t('ui.capacityValue')"
					:error="fields.capacity"
					required
					><UInput
						id="new-activity-capacity"
						v-model.number="draft.capacity"
						type="number"
						:min="1"
						:max="10000"
						required
						class="w-full"
				/></UFormField>
			</div>
			<UFormField :label="t('ui.tags')" :error="fields.tags"
				><UInput id="new-activity-tags" v-model="draft.tags" class="w-full"
			/></UFormField>
			<UFormField :label="t('ui.cover')"
				><UInput
					type="file"
					accept="image/jpeg,image/png,image/webp"
					:disabled="busy || uploading"
					:aria-label="t('ui.upload')"
					@change="upload" /><ContentCover
					v-if="draft.cover"
					:title="draft.title"
					:media="draft.cover"
					class="activity-cover-preview"
			/></UFormField>
			<p v-if="message" class="error" role="alert">{{ message }}</p>
			<UButton
				type="submit"
				color="primary"
				variant="soft"
				:loading="busy"
				:disabled="busy || uploading"
				class="activity-create-submit"
				>{{ t('ui.publish') }}</UButton
			>
		</fieldset>
	</form>
	<div v-else class="empty-state">
		<p>{{ t('ui.noPermission') }}</p>
		<UButton v-if="!user" @click="openAuth()">{{ t('ui.login') }}</UButton>
	</div>
</template>
