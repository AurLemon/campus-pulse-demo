<script setup lang="ts">
import type { StudioUserSearchRequest } from '../utils/user-search'
import type { StudioAccount, StudioAccountsResponse } from '@campus/contracts'
const props = defineProps<{
	loadUsers: (
		request: StudioUserSearchRequest,
	) => Promise<StudioAccountsResponse>
	selectedId?: string
}>()
const emit = defineEmits<{ select: [account: StudioAccount] }>()
const { t } = useI18n()
const query = ref(''),
	showAll = ref(false),
	page = ref(1),
	pageSize = ref(100)
const result = ref<StudioAccountsResponse>(),
	busy = ref(false),
	failed = ref(false)
const list = ref<HTMLElement>()
let sequence = 0,
	controller: AbortController | undefined,
	timer: ReturnType<typeof setTimeout> | undefined
const eligible = computed(() => !!query.value.trim() || showAll.value)
const pages = computed(() =>
	Math.max(1, Math.ceil((result.value?.total ?? 0) / pageSize.value)),
)
async function load() {
	const current = ++sequence
	controller?.abort()
	if (!eligible.value) {
		result.value = undefined
		busy.value = false
		return
	}
	const request = new AbortController()
	controller = request
	busy.value = true
	failed.value = false
	try {
		const response = await props.loadUsers({
			q: query.value.trim(),
			page: page.value,
			pageSize: pageSize.value,
			all: showAll.value,
			signal: request.signal,
		})
		if (current !== sequence) return
		result.value = response
		await nextTick()
		list.value?.scrollTo({ top: 0 })
	} catch {
		if (current === sequence && !request.signal.aborted) failed.value = true
	} finally {
		if (current === sequence) busy.value = false
	}
}
function schedule() {
	sequence++
	controller?.abort()
	clearTimeout(timer)
	result.value = undefined
	failed.value = false
	busy.value = eligible.value
	if (eligible.value) timer = setTimeout(() => void load(), 250)
}
watch(
	[query, showAll, pageSize],
	() => {
		page.value = 1
		schedule()
	},
	{ flush: 'sync' },
)
watch(page, schedule)
onBeforeUnmount(() => {
	sequence++
	controller?.abort()
	clearTimeout(timer)
})
</script>
<template>
	<div class="studio-user-search">
		<UInput
			v-model="query"
			class="w-full"
			icon="i-lucide-search"
			:placeholder="t('access.search')"
			:aria-label="t('access.search')"
			:maxlength="100"
		/>
		<div class="studio-user-search-toolbar">
			<UButton
				size="xs"
				variant="ghost"
				color="neutral"
				:aria-pressed="showAll"
				@click="showAll = !showAll"
				>{{ t(showAll ? 'access.hideAll' : 'access.showAll') }}</UButton
			>
			<label
				>{{ t('access.pageSize')
				}}<USelect
					v-model="pageSize"
					:items="[20, 50, 100, 200]"
					size="xs"
					:aria-label="t('access.pageSize')"
			/></label>
		</div>
		<div ref="list" class="studio-user-search-results" :aria-busy="busy">
			<p v-if="!eligible" class="studio-user-search-state">
				{{ t('access.searchHint') }}
			</p>
			<p v-else-if="busy" class="studio-user-search-state" role="status">
				{{ t('access.loading') }}
			</p>
			<div v-else-if="failed" class="studio-user-search-state" role="alert">
				<p>{{ t('access.loadError') }}</p>
				<UButton size="sm" @click="load">{{ t('access.retry') }}</UButton>
			</div>
			<ul v-else-if="result?.accounts.length" class="studio-account-list">
				<li v-for="account in result.accounts" :key="account.id">
					<button
						type="button"
						class="studio-account-option"
						:class="{ selected: selectedId === account.id }"
						:aria-pressed="selectedId === account.id"
						@click="emit('select', account)"
					>
						<span class="studio-account-copy"
							><strong>{{ account.name }}</strong
							><span
								>{{ account.campus }} / {{ t(`access.roles.${account.role}`)
								}}<template v-if="account.account">
									/ {{ account.account }}</template
								></span
							></span
						><UIcon v-if="selectedId === account.id" name="i-lucide-check" />
					</button>
				</li>
			</ul>
			<p v-else class="studio-user-search-state">{{ t('access.empty') }}</p>
		</div>
		<div
			v-if="result && !busy && !failed"
			class="studio-user-search-pagination"
		>
			<span>{{ t('access.total', { count: result.total }) }}</span>
			<div>
				<UButton
					icon="i-lucide-chevron-left"
					size="xs"
					color="neutral"
					variant="ghost"
					:aria-label="t('access.previous')"
					:disabled="page <= 1"
					@click="page--"
				/><span>{{ page }} / {{ pages }}</span
				><UButton
					icon="i-lucide-chevron-right"
					size="xs"
					color="neutral"
					variant="ghost"
					:aria-label="t('access.next')"
					:disabled="page >= pages"
					@click="page++"
				/>
			</div>
		</div>
	</div>
</template>
<style scoped>
.studio-user-search {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-height: 0;
}
.studio-user-search-toolbar,
.studio-user-search-pagination,
.studio-user-search-pagination > div {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}
.studio-user-search-toolbar label {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var(--muted);
	font-size: 12px;
}
.studio-user-search-results {
	max-height: min(45dvh, 380px);
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-width: thin;
	min-height: 80px;
}
.studio-account-list {
	margin: 0;
	padding: 0 6px 0 0;
	list-style: none;
}
.studio-account-option {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
	padding: 10px;
	gap: 12px;
	text-align: left;
	border: 0;
	border-radius: 8px;
	background: transparent;
	color: var(--ink);
}
.studio-account-option:hover,
.studio-account-option.selected {
	background: var(--surface-raised);
}
.studio-account-copy {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}
.studio-account-copy strong {
	font-size: 14px;
	font-weight: 500;
	overflow-wrap: anywhere;
}
.studio-account-copy > span,
.studio-user-search-pagination {
	color: var(--muted);
	font-size: 12px;
}
.studio-user-search-state {
	padding: 20px 8px;
	text-align: center;
	color: var(--muted);
	font-size: 13px;
	margin: 0;
}
</style>
