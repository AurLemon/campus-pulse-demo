<script setup lang="ts">
import { CAMPUSES } from '@campus/contracts'
const campusChoices: string[] = [...CAMPUSES]
const apiError = useApiError()

const props = defineProps<{ mode: 'login' | 'register' }>()
const emit = defineEmits<{
	busy: [value: boolean]
	success: [userId: string]
}>()
const { openAuth } = useAuthOverlay()
const authEpoch = useState('auth-epoch', () => 0)

const { t } = useI18n(),
	{ refresh, user } = await useCampus()
const registering = computed(() => props.mode === 'register'),
	account = ref(''),
	password = ref(''),
	name = ref(''),
	campus = ref('铜盘校区'),
	busy = ref(false),
	message = ref('')
const { fields, clear, capture } = useFieldErrors('auth')
onMounted(() => document.getElementById('auth-account')?.focus())
function switchMode() {
	void openAuth(registering.value ? 'login' : 'register')
	clear()
	message.value = ''
}

async function submit() {
	if (busy.value) return
	busy.value = true
	emit('busy', true)
	message.value = ''
	clear()
	try {
		await $fetch(registering.value ? '/api/auth/register' : '/api/auth/login', {
			method: 'POST',
			body: {
				account: account.value,
				password: password.value,
				...(registering.value
					? { name: name.value, campus: campus.value }
					: {}),
			},
		})
		authEpoch.value++
		await refresh()
		await refreshNuxtData()
		emit('success', user.value?.id ?? '')
	} catch (e) {
		const failure = e as { data?: { data?: { code?: string }; code?: string } }
		const code = failure.data?.data?.code ?? failure.data?.code
		message.value =
			code === 'UNAUTHORIZED'
				? t('ui.loginFailed')
				: registering.value && code === 'CONFLICT'
					? t('ui.accountExists')
					: apiError(e)
		await capture(e)
	} finally {
		busy.value = false
		emit('busy', false)
	}
}
</script>
<template>
	<div class="auth-panel">
		<form class="auth-form" @submit.prevent="submit">
			<h2>{{ t(registering ? 'ui.registerTitle' : 'ui.authTitle') }}</h2>
			<p v-if="registering" class="muted small">
				{{ t('ui.registerAccountHint') }}
			</p>
			<UFormField :label="t('ui.account')" :error="fields.account" required
				><UInput
					id="auth-account"
					v-model="account"
					class="w-full"
					size="lg"
					required
					autocomplete="username"
					:minlength="3"
					:maxlength="32" /></UFormField
			><UFormField
				v-if="registering"
				:label="t('ui.name')"
				:error="fields.name"
				required
				><UInput
					id="auth-name"
					v-model="name"
					class="w-full"
					size="lg"
					required
					:maxlength="32" /></UFormField
			><UFormField
				v-if="registering"
				:label="t('ui.campus')"
				:error="fields.campus"
				required
				><USelect
					id="auth-campus"
					v-model="campus"
					:items="campusChoices"
					class="w-full"
					size="lg"
					required /></UFormField
			><UFormField :label="t('ui.password')" :error="fields.password" required
				><UInput
					id="auth-password"
					v-model="password"
					class="w-full"
					size="lg"
					type="password"
					required
					:minlength="8"
					:maxlength="128"
					:autocomplete="registering ? 'new-password' : 'current-password'"
			/></UFormField>
			<p v-if="message" class="error" role="alert">{{ message }}</p>
			<UButton type="submit" size="lg" block :loading="busy">{{
				t(registering ? 'ui.register' : 'ui.login')
			}}</UButton>
			<p class="auth-switch">
				{{ t(registering ? 'ui.hasAccount' : 'ui.noAccount') }}
				<button type="button" :disabled="busy" @click="switchMode">
					{{ t(registering ? 'ui.login' : 'ui.register') }}
				</button>
			</p>
		</form>
	</div>
</template>
