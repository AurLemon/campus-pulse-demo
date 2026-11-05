<script setup lang="ts">
import { CAMPUSES, type PublicUser } from '@campus/contracts'
const props = defineProps<{ profile: PublicUser }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const apiError = useApiError()
const open = ref(false),
	busy = ref(false),
	discard = ref(false),
	message = ref('')
const name = ref(''),
	bio = ref(''),
	campus = ref<string>(CAMPUSES[0])
const choices: string[] = [...CAMPUSES]
const prefix = `profile-edit-${useId()}`
const { fields, clear, capture } = useFieldErrors(prefix)
const dirty = computed(
	() =>
		name.value !== props.profile.name ||
		bio.value !== props.profile.bio ||
		campus.value !== props.profile.campus,
)
function start() {
	name.value = props.profile.name
	bio.value = props.profile.bio
	campus.value = props.profile.campus
	message.value = ''
	discard.value = false
	clear()
	open.value = true
}
function change(value: boolean) {
	if (busy.value) return
	if (!value && dirty.value) discard.value = true
	else open.value = value
}
function abandon() {
	open.value = false
	discard.value = false
}
async function save() {
	if (busy.value) return
	busy.value = true
	message.value = ''
	clear()
	try {
		await $fetch('/api/users/me', {
			method: 'PATCH',
			body: { name: name.value, bio: bio.value, campus: campus.value },
		})
		open.value = false
		emit('saved')
	} catch (error) {
		message.value = apiError(error)
		await capture(error)
	} finally {
		busy.value = false
	}
}
</script>
<template>
	<UButton
		color="neutral"
		variant="soft"
		icon="i-lucide-pencil"
		@click="start"
		>{{ t('profileComments.editProfile') }}</UButton
	>
	<UModal
		:open="open"
		:title="t('profileComments.editProfile')"
		:dismissible="!busy"
		:close="!busy"
		@update:open="change"
	>
		<template #body>
			<form :id="prefix" class="profile-edit-form" @submit.prevent="save">
				<UFormField
					:label="t('profileComments.name')"
					:error="fields.name"
					required
					><UInput
						:id="`${prefix}-name`"
						v-model="name"
						class="w-full"
						:maxlength="40"
						required
						:disabled="busy"
						autofocus
				/></UFormField>
				<UFormField :label="t('profileComments.bio')" :error="fields.bio"
					><UTextarea
						:id="`${prefix}-bio`"
						v-model="bio"
						class="w-full"
						:maxlength="300"
						:rows="3"
						autoresize
						:disabled="busy"
				/></UFormField>
				<UFormField
					:label="t('profileComments.campus')"
					:error="fields.campus"
					required
					><USelect
						:id="`${prefix}-campus`"
						v-model="campus"
						:items="choices"
						class="w-full"
						:disabled="busy"
				/></UFormField>
				<p v-if="message" class="error" role="alert">{{ message }}</p>
				<div v-if="discard" class="profile-edit-discard" role="alert">
					<p>{{ t('profileComments.discard') }}</p>
					<UButton
						type="button"
						color="neutral"
						variant="ghost"
						@click="discard = false"
						>{{ t('profileComments.keepEditing') }}</UButton
					><UButton
						type="button"
						color="neutral"
						variant="soft"
						@click="abandon"
						>{{ t('profileComments.discardAction') }}</UButton
					>
				</div>
			</form>
		</template>
		<template #footer
			><div class="profile-edit-actions">
				<UButton
					color="neutral"
					variant="ghost"
					:disabled="busy"
					@click="change(false)"
					>{{ t('profileComments.cancel') }}</UButton
				><UButton
					:form="prefix"
					type="submit"
					color="neutral"
					variant="soft"
					:loading="busy"
					:disabled="busy || !dirty || !name.trim()"
					>{{ t('profileComments.save') }}</UButton
				>
			</div></template
		>
	</UModal>
</template>
<style scoped>
.profile-edit-form {
	display: grid;
	gap: 18px;
}
.profile-edit-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	width: 100%;
}
.profile-edit-discard {
	padding: 12px;
	border-radius: 12px;
	background: var(--surface-raised);
	font-size: 13px;
}
.profile-edit-discard p {
	margin: 0 0 8px;
}
</style>
