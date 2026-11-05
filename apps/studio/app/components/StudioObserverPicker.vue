<script setup lang="ts">
import type { StudioUserSearchRequest } from '../utils/user-search'
import type { StudioAccount, User } from '@campus/contracts'
const props = defineProps<{ users: User[] }>()
const model = defineModel<string>({ required: true })
const { t } = useI18n()
const open = ref(false)
const selected = computed(() =>
	props.users.find((user) => user.id === model.value),
)
async function loadUsers(request: StudioUserSearchRequest) {
	const q = request.q.toLocaleLowerCase()
	const matches = props.users.filter(
		(user) =>
			!q || `${user.name} ${user.campus}`.toLocaleLowerCase().includes(q),
	)
	return {
		accounts: matches
			.slice(
				(request.page - 1) * request.pageSize,
				request.page * request.pageSize,
			)
			.map((user) => ({
				id: user.id,
				name: user.name,
				account: null,
				campus: user.campus,
				role: user.role,
			})),
		total: matches.length,
		page: request.page,
		pageSize: request.pageSize,
	}
}
function choose(account: StudioAccount) {
	model.value = account.id
	open.value = false
}
</script>
<template>
	<UModal
		v-model:open="open"
		:title="t('user')"
		:ui="{
			content: 'studio-account-modal ring-0 divide-y-0',
			body: 'p-4 sm:p-5',
			header: 'p-4 sm:p-5',
		}"
	>
		<UButton
			color="neutral"
			variant="outline"
			trailing-icon="i-lucide-chevron-down"
			class="studio-observer-trigger w-full"
			>{{ selected?.name ?? t('user') }}</UButton
		>
		<template #body
			><StudioUserSearch
				v-if="open"
				:load-users="loadUsers"
				:selected-id="model"
				@select="choose"
		/></template>
	</UModal>
</template>
<style scoped>
.studio-observer-trigger {
	justify-content: space-between;
	font-weight: 400;
}
</style>
