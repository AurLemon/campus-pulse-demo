<script setup lang="ts">
import { CAMPUSES, type ActivityView, type MediaAsset } from '@campus/contracts'
definePageMeta({ layout: 'admin' })
const apiError = useApiError()
const { openActivity } = useActivityOverlay()
function openCreate(event: MouseEvent) {
	void openActivity(event, 'new')
}

const { t } = useI18n(),
	{ user } = await useCampus(),
	fetcher = useRequestFetch(),
	date = useCampusDate()
const { data, refresh } = await useAsyncData('managed-activities', () =>
	fetcher<{ items: ActivityView[] }>('/api/activities', { query: { all: 1 } }),
)
const allowed = computed(
	() => user.value?.role === 'ORGANIZER' || user.value?.role === 'ADMIN',
)
const query = ref(''),
	open = ref(false),
	busy = ref(false),
	uploading = ref(false),
	message = ref(''),
	editing = ref<string | null>(null),
	fieldErrors = ref<Record<string, string>>({})
interface ActivityForm {
	title: string
	body: string
	tags: string
	campus: string
	location: string
	startsAt: string
	endsAt: string
	deadline: string
	capacity: number
	coverId: string | null
}
const blank = (): ActivityForm => ({
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
	coverId: null,
})
const form = reactive<ActivityForm>(blank()),
	dirty = ref(false),
	cover = ref<MediaAsset | null>(null)
watch(form, () => (dirty.value = true))
const rows = computed(() =>
	(data.value?.items ?? []).filter(
		(a) =>
			(user.value?.role === 'ADMIN' || a.organizerId === user.value?.id) &&
			`${a.title} ${a.location}`.includes(query.value),
	),
)
const columns = computed(() => [
	{ colKey: 'title', title: t('ui.title') },
	{ colKey: 'startsAt', title: t('ui.time') },
	{ colKey: 'location', title: t('ui.location') },
	{ colKey: 'availability', title: t('ui.status') },
	{ colKey: 'actions', title: t('ui.edit'), width: 100 },
])
function localInput(value: string) {
	const date = new Date(value)
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 16)
}

function edit(a?: ActivityView) {
	if (busy.value || uploading.value) return
	editing.value = a?.id ?? null
	cover.value = a?.cover ?? null
	Object.assign(
		form,
		a
			? {
					title: a.title,
					body: a.body,
					tags: a.tags.join(', '),
					campus: a.campus,
					location: a.location,
					startsAt: localInput(a.startsAt),
					endsAt: localInput(a.endsAt),
					deadline: localInput(a.deadline),
					capacity: a.capacity,
					coverId: a.coverId ?? null,
				}
			: blank(),
	)
	message.value = ''
	fieldErrors.value = {}
	open.value = true
	nextTick(() => (dirty.value = false))
}
function close() {
	if (busy.value || uploading.value) return
	if (dirty.value && !window.confirm(t('ui.leaveDraft'))) return
	open.value = false
}
async function upload(event: Event) {
	const input = event.target as HTMLInputElement,
		file = input.files?.[0]
	if (!file || busy.value || uploading.value) return
	uploading.value = true
	message.value = ''
	const body = new FormData()
	body.append('file', file)
	try {
		cover.value = await $fetch<MediaAsset>('/api/media', {
			method: 'POST',
			body,
		})
		form.coverId = cover.value.id
	} catch (e) {
		message.value = apiError(e)
	} finally {
		uploading.value = false
		input.value = ''
	}
}
async function save() {
	if (busy.value || uploading.value) return
	busy.value = true
	message.value = ''
	fieldErrors.value = {}
	for (const key of [
		'title',
		'body',
		'campus',
		'location',
		'startsAt',
		'endsAt',
		'deadline',
	] as const)
		if (!form[key].trim()) fieldErrors.value[key] = t('ui.required')
	if (Object.keys(fieldErrors.value).length) {
		busy.value = false
		await nextTick()
		document
			.getElementById(`activity-${Object.keys(fieldErrors.value)[0]}`)
			?.focus()
		return
	}
	try {
		const body = {
			...form,
			tags: form.tags
				.split(/[,，/]/)
				.map((v) => v.trim())
				.filter(Boolean),
			startsAt: new Date(form.startsAt).toISOString(),
			endsAt: new Date(form.endsAt).toISOString(),
			deadline: new Date(form.deadline).toISOString(),
		}
		await $fetch(
			editing.value ? `/api/activities/${editing.value}` : '/api/activities',
			{ method: editing.value ? 'PATCH' : 'POST', body },
		)
		open.value = false
		dirty.value = false
		await Promise.allSettled([
			refresh(),
			refreshNuxtData([
				'activity-list',
				'sidebar',
				...(editing.value ? [`activity-${editing.value}`] : []),
			]),
		])
	} catch (e) {
		message.value = apiError(e)
		const err = e as { data?: { data?: { fields?: Record<string, string> } } }
		fieldErrors.value = Object.fromEntries(
			Object.keys(err.data?.data?.fields ?? {}).map((k) => [
				k,
				t('ui.invalid'),
			]),
		)
	} finally {
		busy.value = false
	}
}
async function cancel(a: ActivityView) {
	if (busy.value || uploading.value) return
	if (!window.confirm(`${t('ui.cancelActivity')}：${a.title}？`)) return
	busy.value = true
	try {
		await $fetch(`/api/activities/${a.id}`, {
			method: 'PATCH',
			body: { status: 'CANCELLED' },
		})
		await Promise.allSettled([
			refresh(),
			refreshNuxtData(['activity-list', 'sidebar', `activity-${a.id}`]),
		])
	} catch (e) {
		message.value = apiError(e)
	} finally {
		busy.value = false
	}
}
onBeforeRouteLeave(() => {
	if (!open.value) return true
	if (busy.value || uploading.value) return false
	return !dirty.value || window.confirm(t('ui.leaveDraft'))
})
</script>
<template>
	<div v-if="allowed">
		<div class="admin-page-heading">
			<TButton @click="openCreate">{{ t('ui.activityCreate') }}</TButton>
		</div>
		<div class="admin-filter-bar">
			<TInput v-model="query" :placeholder="t('ui.search')" clearable /><TButton
				variant="outline"
				@click="refresh()"
				>{{ t('ui.refresh') }}</TButton
			>
		</div>
		<TAlert v-if="message && !open" theme="error" :message="message" /><TTable
			:data="rows"
			:columns="columns"
			row-key="id"
			hover
			><template #startsAt="{ row }">{{ date(row.startsAt) }}</template
			><template #availability="{ row }"
				><TTag variant="light">{{
					t(`ui.${row.availability}`)
				}}</TTag></template
			><template #actions="{ row }"
				><TButton variant="text" size="small" @click="edit(row)">{{
					t('ui.edit')
				}}</TButton
				><TButton
					v-if="row.status !== 'CANCELLED'"
					variant="text"
					theme="danger"
					size="small"
					@click="cancel(row)"
					>{{ t('ui.cancel') }}</TButton
				></template
			></TTable
		><TDrawer
			:visible="open"
			:header="t(editing ? 'ui.activityEdit' : 'ui.activityCreate')"
			size="min(560px, 100vw)"
			:close-on-overlay-click="false"
			:close-btn="!busy && !uploading"
			:close-on-esc-keydown="!busy && !uploading"
			@close="close"
			><TForm
				label-align="top"
				class="admin-activity-form"
				:disabled="busy || uploading"
				><TFormItem :label="t('ui.title')" :help="fieldErrors.title"
					><TInput
						id="activity-title"
						v-model="form.title"
						:maxlength="120" /></TFormItem
				><TFormItem :label="t('ui.description')" :help="fieldErrors.body"
					><TTextarea
						id="activity-body"
						v-model="form.body"
						:autosize="{ minRows: 5, maxRows: 12 }" /></TFormItem
				><TFormItem :label="t('ui.cover')"
					><UInput
						:disabled="busy || uploading"
						type="file"
						accept="image/jpeg,image/png,image/webp"
						:aria-label="t('ui.upload')"
						@change="upload" /><img
						v-if="cover"
						:src="cover.url"
						:alt="cover.alt"
						class="admin-cover-preview" /></TFormItem
				><TFormItem :label="t('ui.tags')"
					><TInput v-model="form.tags" /></TFormItem
				><TFormItem :label="t('ui.campus')" :help="fieldErrors.campus"
					><TSelect
						id="activity-campus"
						v-model="form.campus"
						:options="
							CAMPUSES.map((value) => ({ label: value, value }))
						" /></TFormItem
				><TFormItem :label="t('ui.location')" :help="fieldErrors.location"
					><TInput id="activity-location" v-model="form.location" /></TFormItem
				><TFormItem :label="t('ui.startsAt')" :help="fieldErrors.startsAt"
					><UInput
						:disabled="busy || uploading"
						id="activity-startsAt"
						v-model="form.startsAt"
						type="datetime-local"
						class="w-full" /></TFormItem
				><TFormItem :label="t('ui.endsAt')" :help="fieldErrors.endsAt"
					><UInput
						:disabled="busy || uploading"
						id="activity-endsAt"
						v-model="form.endsAt"
						type="datetime-local"
						class="w-full" /></TFormItem
				><TFormItem :label="t('ui.deadlineAt')" :help="fieldErrors.deadline"
					><UInput
						:disabled="busy || uploading"
						id="activity-deadline"
						v-model="form.deadline"
						type="datetime-local"
						class="w-full" /></TFormItem
				><TFormItem :label="t('ui.capacityValue')"
					><TInputNumber
						v-model="form.capacity"
						:min="1"
						:max="10000" /></TFormItem></TForm
			><TAlert v-if="message" theme="error" :message="message" /><template
				#footer
				><TButton :loading="busy" :disabled="uploading" @click="save">{{
					t('ui.save')
				}}</TButton
				><TButton
					variant="outline"
					:disabled="busy || uploading"
					@click="close"
					>{{ t('ui.cancel') }}</TButton
				></template
			></TDrawer
		>
	</div>
	<div v-else class="empty-state">
		<h1>{{ t('ui.noPermission') }}</h1>
		<UButton to="/">{{ t('ui.goHome') }}</UButton>
	</div>
</template>
