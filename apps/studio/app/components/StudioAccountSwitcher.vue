<script setup lang="ts">
import type { StudioUserSearchRequest } from '../utils/user-search'
import type {
	StudioAccount,
	StudioAccountsResponse,
	StudioLoginLink,
} from '@campus/contracts'
const { t } = useI18n()
const open = ref(false)
const selected = ref<StudioAccount | null>(null)
const link = ref<StudioLoginLink | null>(null)
const preparing = ref(false)
const linkError = ref(false)
const now = ref(Date.now())
let linkSequence = 0
let linkController: AbortController | undefined
let clock: ReturnType<typeof setInterval> | undefined
const expired = computed(
	() => !!link.value && Date.parse(link.value.expiresAt) <= now.value,
)
async function loadUsers(request: StudioUserSearchRequest) {
	return await $fetch<StudioAccountsResponse>('/api/studio/accounts', {
		query: {
			q: request.q,
			page: request.page,
			pageSize: request.pageSize,
			all: request.all,
		},
		headers: { 'x-campus-studio': '1' },
		signal: request.signal,
		retry: 0,
		timeout: 8000,
	})
}
async function choose(account: StudioAccount) {
	selected.value = account
	link.value = null
	linkError.value = false
	linkController?.abort()
	const controller = new AbortController()
	linkController = controller
	const current = ++linkSequence
	preparing.value = true
	try {
		const response = await $fetch<StudioLoginLink>('/api/studio/account-link', {
			method: 'POST',
			body: { userId: account.id },
			headers: { 'x-campus-studio': '1' },
			signal: controller.signal,
			retry: 0,
			timeout: 8000,
		})
		if (current === linkSequence && open.value) {
			link.value = response
			now.value = Date.now()
		}
	} catch {
		if (current === linkSequence && !controller.signal.aborted)
			linkError.value = true
	} finally {
		if (current === linkSequence) preparing.value = false
	}
}
function stop() {
	linkSequence++
	linkController?.abort()
	if (clock) clearInterval(clock)
	clock = undefined
	preparing.value = false
	link.value = null
}
watch(open, (value) => {
	if (!value) {
		stop()
		return
	}
	selected.value = null
	linkError.value = false
	clock = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(stop)
</script>
<template>
	<UModal
		v-model:open="open"
		:title="t('access.title')"
		:ui="{
			content: 'studio-account-modal ring-0 divide-y-0',
			body: 'p-4 sm:p-5',
			header: 'p-4 sm:p-5',
			footer: 'p-4 sm:p-5',
		}"
	>
		<UButton
			color="neutral"
			variant="ghost"
			icon="i-lucide-users-round"
			:aria-label="t('access.open')"
		>
			<span class="studio-account-trigger-label">{{ t('access.open') }}</span>
		</UButton>
		<template #body
			><StudioUserSearch
				v-if="open"
				:load-users="loadUsers"
				:selected-id="selected?.id"
				@select="choose"
		/></template>
		<template v-if="selected" #footer>
			<div class="studio-account-footer">
				<p v-if="preparing" role="status">{{ t('access.preparing') }}</p>
				<template v-else-if="linkError"
					><p role="alert">{{ t('access.linkError') }}</p>
					<UButton
						v-if="selected"
						color="neutral"
						variant="soft"
						@click="choose(selected)"
						>{{ t('access.retry') }}</UButton
					></template
				>
				<template v-else-if="expired"
					><p>{{ t('access.expired') }}</p>
					<UButton
						v-if="selected"
						color="neutral"
						variant="soft"
						@click="choose(selected)"
						>{{ t('access.regenerate') }}</UButton
					></template
				>
				<UButton
					v-else-if="link && selected"
					:to="link.url"
					external
					target="_blank"
					rel="noopener noreferrer"
					color="neutral"
					variant="soft"
					icon="i-lucide-external-link"
					@click="open = false"
					>{{ t('access.visit', { name: selected.name }) }}</UButton
				>
			</div>
		</template>
	</UModal>
</template>
<style scoped>
.studio-account-footer {
	min-height: 36px;
	width: 100%;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: 12px;
}
.studio-account-footer p {
	color: var(--muted);
	font-size: 12px;
}
@media (max-width: 1050px) {
	.studio-account-trigger-label {
		display: none;
	}
}
</style>
