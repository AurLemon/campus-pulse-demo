<script setup lang="ts">
import type {
	BookAlgorithmItem,
	BookRecommendationResult,
	BookMode,
} from '@campus/contracts/books'
interface BookStudioData {
	users: { id: string; name?: string }[]
	books: BookAlgorithmItem[]
	recordCount: number
}
interface Run {
	now: string
	result: BookRecommendationResult
	books: BookAlgorithmItem[]
}
const { t } = useI18n(),
	request = useRequestFetch()
const { data, error, refresh } = await useAsyncData('studio-books', () =>
	request<BookStudioData>('/api/studio/books'),
)
const userId = useState<string>('studio-observer-user-id', () => ''),
	mode = ref<BookMode>('hybrid'),
	resultCount = ref(20),
	neighborCount = ref(15),
	crossDomain = ref(true),
	weights = reactive({ user: 35, item: 35, content: 30 }),
	busy = ref(false),
	failure = ref(''),
	run = ref<Run | null>(null),
	comparison = ref<{ on: Run; off: Run } | null>(null),
	selected = ref('')
const modes = computed(() =>
	(['hybrid', 'user', 'item', 'content'] as BookMode[]).map((value) => ({
		value,
		label: t(`books.${value}`),
	})),
)
const titles = computed(
	() => new Map((data.value?.books ?? []).map((b) => [b.id, b.title])),
)
const names = computed(
	() => new Map((data.value?.users ?? []).map((u) => [u.id, u.name ?? u.id])),
)
const selectedRow = computed(() =>
	run.value?.result.items.find((r) => r.id === selected.value),
)
const completedMode = ref<BookMode>('hybrid')
const activeTab = ref('result')
function validNumber(value: unknown, max: number, integer = false) {
	return (
		value !== '' &&
		value !== null &&
		Number.isFinite(Number(value)) &&
		Number(value) >= 0 &&
		Number(value) <= max &&
		(!integer || Number.isInteger(Number(value)))
	)
}
const tabs = ['result', 'matrix', 'heap', 'compare'] as const
const validSettings = computed(
	() =>
		!!data.value?.users.some((user) => user.id === userId.value) &&
		validNumber(resultCount.value, 50, true) &&
		validNumber(neighborCount.value, 100, true) &&
		Object.values(weights).every((value) => validNumber(value, 100)),
)
const completedUser = ref('')
const matrixRows = computed(() => {
	const rows = run.value?.result.matrix ?? []
	return [
		...rows.filter((r) => r.userId === completedUser.value),
		...rows.filter((r) => r.userId !== completedUser.value),
	].slice(0, 12)
})
const sidebarCollapsed = useState('studio-sidebar-collapsed', () => false)
const controlsOpen = useState('studio-mobile-controls-open', () => false)
const signature = computed(() =>
	JSON.stringify({
		userId: userId.value,
		mode: mode.value,
		resultCount: resultCount.value,
		neighborCount: neighborCount.value,
		crossDomain: crossDomain.value,
		weights,
	}),
)
let sequence = 0
let controller: AbortController | undefined
let automaticCalculation: ReturnType<typeof setTimeout> | undefined
let liveTimer: ReturnType<typeof setInterval> | undefined
let revision = ''
let refreshing = false

function toggleSidebar() {
	sidebarCollapsed.value = !sidebarCollapsed.value
	controlsOpen.value = !sidebarCollapsed.value
}
async function calculate(compare = activeTab.value === 'compare') {
	clearTimeout(automaticCalculation)
	const id = ++sequence
	controller?.abort()
	busy.value = false
	if (!validSettings.value || error.value) return
	const currentSignature = signature.value
	const requestController = new AbortController()
	controller = requestController
	busy.value = true
	failure.value = ''
	const body = {
		userId: userId.value,
		mode: mode.value,
		resultCount: Number(resultCount.value),
		neighborCount: Number(neighborCount.value),
		crossDomain: crossDomain.value,
		weights: {
			user: Number(weights.user),
			item: Number(weights.item),
			content: Number(weights.content),
		},
	}
	try {
		const result = await $fetch<Run>('/api/studio/books/run', {
			method: 'POST',
			body,
			signal: requestController.signal,
		})
		const other = compare
			? await $fetch<Run>('/api/studio/books/run', {
					method: 'POST',
					body: { ...body, crossDomain: !body.crossDomain },
					signal: requestController.signal,
				})
			: null
		if (id !== sequence || currentSignature !== signature.value) return
		run.value = result
		completedUser.value = body.userId
		completedMode.value = body.mode
		if (!result.result.items.some((item) => item.id === selected.value))
			selected.value = result.result.items[0]?.id ?? ''
		comparison.value = other
			? body.crossDomain
				? { on: result, off: other }
				: { on: other, off: result }
			: null
	} catch {
		if (id === sequence && !requestController.signal.aborted)
			failure.value = t('books.error')
	} finally {
		if (id === sequence) busy.value = false
	}
}
watch(
	signature,
	() => {
		sequence++
		controller?.abort()
		busy.value = false
		clearTimeout(automaticCalculation)
		if (import.meta.client && validSettings.value)
			automaticCalculation = setTimeout(() => void calculate(), 150)
	},
	{ flush: 'sync' },
)
watch(activeTab, (value) => {
	if (value === 'compare' && !comparison.value) void calculate(true)
})
async function refreshBooks() {
	if (refreshing) return
	refreshing = true
	try {
		await refresh()
		if (!error.value) await calculate()
	} finally {
		refreshing = false
	}
}
async function checkLiveChanges() {
	if (document.hidden || busy.value || refreshing) return
	try {
		const current = await request<{ revision: string }>('/api/studio/revision')
		if (current.revision !== revision || failure.value) {
			await refreshBooks()
			if (!error.value && !failure.value) revision = current.revision
		}
	} catch {
		failure.value = t('books.error')
	}
}
onMounted(() => {
	void checkLiveChanges()
	liveTimer = setInterval(checkLiveChanges, 3000)
	window.addEventListener('focus', checkLiveChanges)
})
onBeforeUnmount(() => {
	sequence++
	controller?.abort()
	clearTimeout(automaticCalculation)
	clearInterval(liveTimer)
	window.removeEventListener('focus', checkLiveChanges)
})
function select(id: string) {
	selected.value = id
}
</script>
<template>
	<div class="studio-workspace">
		<div
			class="books-layout studio-layout"
			:class="{ 'sidebar-collapsed': sidebarCollapsed }"
		>
			<aside
				class="studio-controls"
				:class="{ 'is-open': controlsOpen, 'is-collapsed': sidebarCollapsed }"
			>
				<div class="studio-controls-heading">
					<h2 v-show="!sidebarCollapsed">{{ t('controls') }}</h2>
					<UButton
						color="neutral"
						variant="ghost"
						class="studio-sidebar-toggle"
						:icon="
							sidebarCollapsed
								? 'i-lucide-panel-left-open'
								: 'i-lucide-panel-left-close'
						"
						:aria-label="
							t(sidebarCollapsed ? 'expandSidebar' : 'collapseSidebar')
						"
						:aria-expanded="!sidebarCollapsed"
						aria-controls="book-controls"
						@click="toggleSidebar"
					/>
				</div>
				<div
					id="book-controls"
					class="studio-controls-scroll"
					:inert="sidebarCollapsed"
				>
					<form class="books-controls" @submit.prevent="calculate()">
						<label
							>{{ t('books.mode')
							}}<USelect v-model="mode" :items="modes" class="w-full" /></label
						><label
							>{{ t('books.resultCount')
							}}<UInput
								v-model="resultCount"
								type="number"
								:min="0"
								:max="50" /></label
						><label
							>{{ t('books.neighborCount')
							}}<UInput
								v-model="neighborCount"
								type="number"
								:min="0"
								:max="100" /></label
						><label
							v-for="key in ['user', 'item', 'content'] as const"
							:key="key"
							>{{ t(`books.${key}Weight`)
							}}<UInput
								v-model="weights[key]"
								type="number"
								:min="0"
								:max="100" /></label
						><UCheckbox v-model="crossDomain" :label="t('books.crossDomain')" />
						<UButton
							color="neutral"
							variant="soft"
							icon="i-lucide-refresh-cw"
							:loading="busy"
							:disabled="!validSettings || !!error"
							@click="refreshBooks"
							>{{ t('books.refresh') }}</UButton
						>
					</form>
				</div>
			</aside>
			<main class="books-main">
				<nav
					class="stage-nav workspace-stage-nav"
					:aria-label="t('workspaceBooks')"
				>
					<button
						v-for="(tab, index) in tabs"
						:key="tab"
						type="button"
						:class="{ active: activeTab === tab }"
						:aria-current="activeTab === tab ? 'step' : undefined"
						@click="activeTab = tab"
					>
						<span>{{ String(index + 1).padStart(2, '0') }}</span
						>{{ t(`books.${tab}`) }}
					</button>
					<div
						class="stage-indicator"
						:style="{
							transform: `translateX(${tabs.indexOf(activeTab as (typeof tabs)[number]) * 100}%)`,
						}"
					/>
				</nav>
				<div class="books-content" :aria-busy="busy">
					<UAlert
						v-if="error || failure"
						color="error"
						variant="soft"
						:title="failure || t('books.error')"
						><template #actions
							><UButton
								color="neutral"
								variant="soft"
								:loading="busy"
								@click="refreshBooks"
								>{{ t('retry') }}</UButton
							></template
						></UAlert
					>
					<p v-if="!run && busy" class="studio-empty" role="status">
						{{ t('books.loading') }}
					</p>
					<p v-else-if="!validSettings" class="studio-alert">
						{{ t('invalidSettings') }}
					</p>
					<template v-if="run">
						<div class="book-run-context">
							<span
								>{{ t('books.reader') }}
								<strong>{{
									names.get(completedUser) ?? completedUser
								}}</strong></span
							><span
								>{{ t('books.mode') }}
								<strong>{{ t(`books.${completedMode}`) }}</strong></span
							><time :datetime="run.now">{{
								new Date(run.now).toLocaleString('zh-CN', {
									timeZone: 'Asia/Taipei',
									hour12: false,
								})
							}}</time>
						</div>
						<div v-if="activeTab === 'result'" class="book-panels">
							<section class="studio-panel">
								<h2>{{ t('books.result') }}</h2>
								<p class="hint">
									{{ t('books.channels') }}：{{
										Object.entries(run.result.channels)
											.filter(([, active]) => active)
											.map(([key]) => t(`books.${key}`))
											.join(' / ') || t('books.empty')
									}}
								</p>
								<div class="studio-table-scroll">
									<table class="studio-data-table">
										<thead>
											<tr>
												<th>#</th>
												<th>{{ t('books.titleColumn') }}</th>
												<th>{{ t('books.score') }}</th>
												<th>{{ t('books.user') }}</th>
												<th>{{ t('books.item') }}</th>
												<th>{{ t('books.content') }}</th>
											</tr>
										</thead>
										<tbody>
											<tr
												v-for="(item, index) in run.result.items"
												:key="item.id"
												:class="{ selected: item.id === selected }"
											>
												<td>{{ index + 1 }}</td>
												<td>
													<button @click="select(item.id)">
														{{ titles.get(item.id) ?? item.id }}
													</button>
												</td>
												<td>{{ item.score.toFixed(4) }}</td>
												<td>{{ item.user.toFixed(4) }}</td>
												<td>{{ item.item.toFixed(4) }}</td>
												<td>{{ item.content.toFixed(4) }}</td>
											</tr>
										</tbody>
									</table>
									<p v-if="!run.result.items.length" class="studio-empty">
										{{ t('books.empty') }}
									</p>
								</div>
							</section>
							<section class="studio-panel">
								<h2>{{ t('books.neighbors') }}</h2>
								<p v-if="!run.result.neighbors.length">
									{{ t('books.empty') }}
								</p>
								<table v-else class="studio-data-table">
									<thead>
										<tr>
											<th>{{ t('books.reader') }}</th>
											<th>{{ t('books.similarity') }}</th>
											<th>{{ t('books.overlap') }}</th>
										</tr>
									</thead>
									<tbody>
										<tr
											v-for="neighbor in run.result.neighbors"
											:key="neighbor.userId"
										>
											<td>
												{{ names.get(neighbor.userId) ?? neighbor.userId }}
											</td>
											<td>{{ neighbor.similarity.toFixed(4) }}</td>
											<td>{{ neighbor.overlap }}</td>
										</tr>
									</tbody>
								</table>
								<h2>{{ t('books.profile') }}</h2>
								<div class="profile">
									<span v-for="(value, key) in run.result.profile" :key="key"
										>{{ key }}：{{ value.toFixed(3) }}</span
									>
								</div>
							</section>
						</div>
						<section
							v-if="selectedRow && activeTab === 'result'"
							class="studio-panel contribution-panel"
						>
							<h2>
								{{ t('books.contributions') }} /
								{{ titles.get(selectedRow.id) }}
							</h2>
							<p>
								{{ t('books.matchedTags') }}：{{
									selectedRow.matchedTags.join(' / ')
								}}
							</p>
							<div class="book-panels">
								<div>
									<h3>{{ t('books.user') }}</h3>
									<p v-if="!selectedRow.userContributions.length">
										{{ t('books.empty') }}
									</p>
									<p v-for="c in selectedRow.userContributions" :key="c.id">
										{{ names.get(c.id) ?? c.id }} / {{ t('books.similarity') }}
										{{ c.similarity.toFixed(4) }} /
										{{ t('books.contributions') }}
										{{ c.contribution.toFixed(4) }}
									</p>
								</div>
								<div>
									<h3>{{ t('books.item') }}</h3>
									<p v-if="!selectedRow.itemContributions.length">
										{{ t('books.empty') }}
									</p>
									<p v-for="c in selectedRow.itemContributions" :key="c.id">
										{{ titles.get(c.id) ?? c.id }} / {{ t('books.similarity') }}
										{{ c.similarity.toFixed(4) }} / {{ t('books.overlap') }}
										{{ c.overlap }} / {{ t('books.contributions') }}
										{{ c.contribution.toFixed(4) }}
									</p>
								</div>
							</div>
						</section>
						<section v-if="activeTab === 'matrix'" class="studio-panel">
							<h2>{{ t('books.matrix') }}</h2>
							<p class="hint">{{ t('books.normalization') }}</p>
							<details
								v-for="row in matrixRows"
								:key="row.userId"
								:open="row.userId === completedUser"
							>
								<summary>
									{{ names.get(row.userId) ?? row.userId }} ({{
										row.entries.length
									}})
								</summary>
								<div class="matrix-entries">
									<span v-for="entry in row.entries" :key="entry.bookId"
										>{{ titles.get(entry.bookId) }}：{{
											entry.value.toFixed(3)
										}}
										/ {{ entry.normalized.toFixed(3) }}</span
									>
								</div>
							</details>
						</section>
						<section v-if="activeTab === 'heap'" class="studio-panel">
							<h2>{{ t('books.heap') }}</h2>
							<details>
								<summary>
									{{ t('books.heap') }} ({{ run.result.heapSteps.length }}) /
									{{ run.result.candidateCount }}
								</summary>
								<ol>
									<li
										v-for="(step, index) in run.result.heapSteps"
										:key="index"
									>
										{{ t(`books.${step.action}`, step.action) }} /
										{{ titles.get(step.bookId) }} / N
										{{ step.size }}
									</li>
								</ol>
							</details>
						</section>
						<section
							v-if="comparison && activeTab === 'compare'"
							class="studio-panel"
						>
							<h2>{{ t('books.compare') }}</h2>
							<div class="book-panels">
								<div v-for="key in ['on', 'off'] as const" :key="key">
									<h3>
										{{ t(key === 'on' ? 'books.crossOn' : 'books.crossOff') }}
									</h3>
									<ol>
										<li
											v-for="item in comparison[key].result.items"
											:key="item.id"
										>
											{{ titles.get(item.id) }} / {{ item.score.toFixed(4) }}
										</li>
									</ol>
								</div>
							</div>
						</section></template
					>
				</div>
			</main>
		</div>
	</div>
</template>
<style scoped>
.books-layout {
	width: 100%;
	flex: 1;
	min-height: 0;
	overflow: hidden;
}

.books-controls > label {
	display: grid;
	gap: 8px;
	font-size: 14px;
}
.books-controls > label :deep(input),
.books-controls > label > div {
	width: 100%;
}
.books-controls > button {
	justify-content: center;
}
.books-main {
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
}
.books-content {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 24px;
}
.book-run-context {
	display: flex;
	gap: 20px;
	flex-wrap: wrap;
	margin-bottom: 14px;
	font-size: 11px;
	color: var(--studio-muted);
}
.book-run-context strong {
	color: var(--studio-text);
	font-weight: 500;
	margin-left: 6px;
}
.book-run-context time {
	margin-left: auto;
	font-variant-numeric: tabular-nums;
}
.book-method-note {
	margin-bottom: 20px;
}
.hint {
	font-size: 12px;
	line-height: 1.9;
	color: var(--studio-muted);
}
.book-panels {
	display: grid;
	grid-template-columns: minmax(0, 1.65fr) minmax(240px, 1fr);
	gap: 20px;
}
.books-content section {
	margin-bottom: 20px;
	min-width: 0;
}
.books-content section > h2 {
	font-size: 13px;
	font-weight: 600;
	padding: 16px 18px;
	border-bottom: 1px solid var(--studio-line);
}
.books-content section > .hint,
.books-content section > p {
	margin: 14px 18px;
	font-size: 12px;
	line-height: 1.9;
}
.books-content section > table {
	width: 100%;
}
.books-content section > .book-panels,
.books-content section > details,
.profile {
	padding: 16px 18px;
}
.books-content section > details + details {
	border-top: 1px solid var(--studio-line);
}
.book-panels h3 {
	font-size: 12px;
	font-weight: 600;
	margin-bottom: 12px;
}
.book-panels p {
	font-size: 12px;
	line-height: 1.9;
	overflow-wrap: anywhere;
}
.studio-data-table td button {
	text-align: left;
	min-width: 130px;
	line-height: 1.7;
}
.studio-data-table tbody tr {
	transition: background 150ms;
}
.studio-data-table tbody tr:hover,
.studio-data-table .selected {
	background: var(--studio-soft);
}
.studio-data-table .selected td:first-child {
	box-shadow: inset 2px 0 var(--studio-accent);
}
.profile,
.matrix-entries {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.profile span,
.matrix-entries span {
	font-size: 11px;
	padding: 6px 9px;
	background: var(--studio-soft);
	border-radius: 5px;
}
.matrix-entries {
	margin-top: 14px;
}
summary {
	cursor: pointer;
	font-size: 12px;
}
ol {
	padding-left: 20px;
	font-size: 12px;
	line-height: 2;
	margin-top: 14px;
}
@media (max-width: 1200px) {
	.book-panels {
		grid-template-columns: minmax(0, 1fr);
	}
}
@media (max-width: 800px) {
	.books-layout {
		position: relative;
		display: flex;
	}
	.books-layout > .studio-controls {
		position: absolute;
		inset: 0 auto 0 0;
		width: min(320px, 90vw);
		height: 100%;
		background: var(--canvas);
	}
	.books-layout > .studio-controls.is-open {
		display: flex;
	}
	.books-main {
		flex: 1;
	}
	.books-content {
		padding: 16px;
	}
	.books-controls {
		grid-template-columns: 1fr !important;
	}
}
</style>
