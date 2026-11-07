<script setup lang="ts">
import type { AgentRuntimeStatus } from '@campus/contracts/agents'
interface Budget {
	limitUsd: number
	spentUsd: number
	remainingUsd: number
	historicalLimitUsd: number
	historicalSpentUsd: number
	unlimited: boolean
	unlimitedChanges: Array<{ at: string; enabled: boolean }>
}
const { t } = useI18n({
	useScope: 'local',
	messages: {
		'zh-CN': {
			a: {
				title: '社区 Agent',
				overview: '运行概览',
				configuration: '调度与预算',
				trigger: '人格触发',
				audit: '动作审计',
				graph: '关系与运行图',
				stageNavigation: 'Agent 工作阶段',
				summary: '运行摘要',
				heartbeat: '最近心跳',
				worker: 'Worker 进程',
				viewAudit: '查看动作审计',
				viewControls: '打开调度与预算',
				sidebar: '运行摘要',
				expandSidebar: '展开侧栏',
				collapseSidebar: '收起侧栏',
				subtitle: '人格、调度队列与实际动作',
				start: '开始调度',
				stop: '暂停自动调度',
				running: 'Worker 运行中',
				offline: 'Worker 未运行',
				paused: '自动调度已暂停',
				enabled: '自动调度已启用',
				budget: '费用保护',
				shared: '本轮共享费用（估算 / 含预留）',
				history: '历史累计费用（含预留）',
				remaining: '剩余额度',
				unlimitedBudget: '不限费用',
				unlimitedWarning:
					'已解除本轮及本轮请求的历史金额保护，调用仍会持续计费',
				unlimitedConfirm: '确认解除本轮及历史金额保护',
				restore: '恢复费用保护',
				increase: '增加额度',
				amount: '新增美元额度',
				confirmIncrease: '确认新增额度',
				schedule: '调度控制',
				interval: '全站调度间隔（秒）',
				limit: '自动调度参与人数',
				concurrency: '后台巡游并发数',
				decisionLimit: '累计完成次数上限',
				unlimitedDecisions: '不限调度次数',
				completed: '已完成次数',
				save: '保存调度参数',
				concurrencyNote:
					'后台并发 1–14，私信独立预留 2 个名额，总并发最多 16，同一人格串行，次数与费用保护独立生效',
				queue: '等待执行',
				active: '执行中',
				people: '人格列表',
				searchPeople: '搜索姓名、班级、校区或兴趣',
				searchJobs: '搜索正文、目标或错误',
				step: '加入队列',
				queued: '已加入队列',
				jobs: '动作记录',
				allPeople: '全部人格',
				allActions: '全部动作',
				allStatuses: '全部状态',
				person: '执行者',
				content: '动作与内容',
				target: '操作目标',
				status: '状态',
				cost: '费用（估算）',
				time: '时间',
				empty: '没有符合条件的记录',
				previous: '上一页',
				next: '下一页',
				open: '打开目标',
				created: '加入',
				updated: '更新',
				reservation: '预留',
				unknown: '无模型费用记录',
				noTarget: '无需目标',
				noContent: '无正文',
				details: '回执与任务详情',
				loadError: '运行状态读取失败',
				protectedPause: '费用保护已暂停调度',
				unknownUsage:
					'模型用量未知，预留费用已保留。请先核对下面的原始错误，再明确恢复调度',
				retry: '重试',
				quotaNote:
					'设为有限上限时按累计完成次数判断，恢复保护后已达上限会立即暂停',
			},
		},
	},
})
const route = useRoute()
const router = useRouter()
const stages = [
	'overview',
	'configuration',
	'trigger',
	'audit',
	'graph',
] as const
function parseStage(value: unknown) {
	const index = Number(value)
	return Number.isInteger(index) && index >= 1 && index <= stages.length
		? index - 1
		: 0
}
const stage = ref(parseStage(route.query.stage))
const sidebarOpen = useState('studio-mobile-controls-open', () => false)
const sidebarCollapsed = useState('studio-sidebar-collapsed', () => false)

function toggleSidebar() {
	sidebarCollapsed.value = !sidebarCollapsed.value
	sidebarOpen.value = !sidebarCollapsed.value
}
const stageContent = ref<HTMLElement | null>(null)
function selectStage(index: number) {
	stage.value = index
	router.replace({ query: { ...route.query, stage: String(index + 1) } })
	nextTick(() => stageContent.value?.scrollTo({ top: 0 }))
}
watch(
	() => route.query.stage,
	(value) => {
		stage.value = parseStage(value)
	},
)
const actorFilter = ref('all'),
	actionFilter = ref('all'),
	statusFilter = ref('all'),
	jobSearch = ref(''),
	page = ref(1),
	personSearch = ref('')
const query = computed(() => ({
	actorId: actorFilter.value === 'all' ? '' : actorFilter.value,
	action: actionFilter.value === 'all' ? '' : actionFilter.value,
	status: statusFilter.value === 'all' ? '' : statusFilter.value,
	q: jobSearch.value,
	page: page.value,
}))
const {
	data: state,
	refresh,
	error: loadError,
} = await useFetch<
	AgentRuntimeStatus & { budget: Budget; productOrigin: string }
>('/api/agents', {
	query,
})
const intervalSeconds = ref(state.value?.intervalSeconds ?? 60),
	actorLimit = ref(state.value?.actorLimit ?? 200),
	concurrency = ref(state.value?.concurrency ?? 1),
	decisionLimit = ref(state.value?.decisionLimit || 200),
	unlimitedDecisions = ref(state.value?.decisionLimit === 0),
	additionalUsd = ref(1),
	error = ref(''),
	notice = ref(''),
	busy = ref(false),
	increaseOpen = ref(false),
	unlimitedOpen = ref(false)
interface AgentSettingsErrors {
	intervalSeconds?: string
	actorLimit?: string
	concurrency?: string
	decisionLimit?: string
}
const settingsErrors = computed<AgentSettingsErrors>(() => {
	const errors: AgentSettingsErrors = {}
	const integerBetween = (value: unknown, min: number, max: number) =>
		value !== '' &&
		value !== null &&
		Number.isSafeInteger(Number(value)) &&
		Number(value) >= min &&
		Number(value) <= max
	if (!integerBetween(intervalSeconds.value, 15, 3600))
		errors.intervalSeconds = '15–3600'
	if (!integerBetween(actorLimit.value, 1, state.value?.maxActorLimit ?? 500))
		errors.actorLimit = `1–${state.value?.maxActorLimit ?? 500}`
	if (
		!integerBetween(
			concurrency.value,
			1,
			state.value?.maxBackgroundConcurrency ?? 14,
		)
	)
		errors.concurrency = `1–${state.value?.maxBackgroundConcurrency ?? 14}`
	if (
		!unlimitedDecisions.value &&
		!integerBetween(decisionLimit.value, 1, Number.MAX_SAFE_INTEGER)
	)
		errors.decisionLimit = '≥ 1'
	return errors
})
const canSaveSettings = computed(
	() => Object.keys(settingsErrors.value).length === 0,
)
const protectedPause = computed(() =>
	/PI_USAGE_UNKNOWN/.test(
		[error.value, state.value?.pauseReason].filter(Boolean).join('\n'),
	),
)
const labels: Record<string, string> = {
	skip: '保持沉默',
	like: '点赞',
	favorite: '收藏',
	follow: '关注',
	friend: '加好友',
	accept: '接受好友申请',
	comment: '评论',
	post: '发帖',
	message: '私信',
	borrow: '借阅',
	return: '归还',
	reading: '在读',
	read: '读完',
	queued: '等待执行',
	running: '执行中',
	ready: '等待提交 / 重试',
	complete: '完成',
	failed: '失败',
}
const actionItems = computed(() => [
	{ label: t('a.allActions'), value: 'all' },
	...[
		'post',
		'comment',
		'like',
		'favorite',
		'follow',
		'friend',
		'accept',
		'message',
		'borrow',
		'return',
		'reading',
		'read',
		'skip',
	].map((value) => ({ label: labels[value]!, value })),
])
const statusItems = computed(() => [
	{ label: t('a.allStatuses'), value: 'all' },
	...['queued', 'running', 'ready', 'complete', 'failed'].map((value) => ({
		label: labels[value]!,
		value,
	})),
])
const actorItems = computed(() => [
	{ label: t('a.allPeople'), value: 'all' },
	...(state.value?.personas ?? []).map((p) => ({
		label: p.name,
		value: p.actorId,
	})),
])
const people = computed(() =>
	(state.value?.personas ?? []).filter((p) =>
		[p.name, p.className, p.campus, ...p.interests]
			.join(' ')
			.toLowerCase()
			.includes(personSearch.value.toLowerCase()),
	),
)
const workerOnline = computed(
	() =>
		!!state.value?.workerPid &&
		Date.now() - Date.parse(state.value?.heartbeatAt ?? '') < 15000,
)
const website = computed(
	() => state.value?.productOrigin ?? 'http://127.0.0.1:3000',
)
const formatTime = (value: string) =>
	new Date(value).toLocaleString('zh-CN', {
		timeZone: 'Asia/Taipei',
		hour12: false,
	})
const dollars = (value: number | undefined) => `$${(value ?? 0).toFixed(5)}`
async function control(body: Record<string, unknown>) {
	busy.value = true
	error.value = ''
	notice.value = ''
	try {
		await $fetch('/api/agents/control', { method: 'POST', body })
		await refresh()
		if (body.action === 'step') notice.value = t('a.queued')
		unlimitedOpen.value = false
		increaseOpen.value = false
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e)
	} finally {
		busy.value = false
	}
}
function inspectActor(actorId: string) {
	actorFilter.value = actorId
	selectStage(3)
}
function save() {
	if (!canSaveSettings.value) return
	return control({
		action: 'configure',
		intervalSeconds: Number(intervalSeconds.value),
		actorLimit: Number(actorLimit.value),
		concurrency: Number(concurrency.value),
		decisionLimit: unlimitedDecisions.value ? 0 : Number(decisionLimit.value),
	})
}
watch([actorFilter, actionFilter, statusFilter, jobSearch], () => {
	page.value = 1
})
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
	timer = setInterval(() => {
		if (document.visibilityState === 'visible' && !busy.value) refresh()
	}, 3000)
})
onUnmounted(() => clearInterval(timer))
</script>
<template>
	<div class="studio-shell studio-workspace agents-workspace">
		<div
			class="agents-layout studio-layout"
			:class="{ 'sidebar-collapsed': sidebarCollapsed }"
		>
			<aside
				class="studio-controls"
				:class="{ 'is-open': sidebarOpen, 'is-collapsed': sidebarCollapsed }"
			>
				<div class="studio-controls-heading">
					<h2 v-show="!sidebarCollapsed">{{ t('a.sidebar') }}</h2>
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
							t(sidebarCollapsed ? 'a.expandSidebar' : 'a.collapseSidebar')
						"
						:aria-expanded="!sidebarCollapsed"
						aria-controls="agent-controls"
						@click="toggleSidebar"
					/>
				</div>
				<div
					id="agent-controls"
					class="studio-controls-scroll"
					:inert="sidebarCollapsed"
				>
					<dl class="agents-status-list">
						<div>
							<dt>{{ t('a.worker') }}</dt>
							<dd>{{ state?.workerPid ?? '—' }}</dd>
						</div>
						<div>
							<dt>{{ t('a.status') }}</dt>
							<dd>{{ workerOnline ? t('a.running') : t('a.offline') }}</dd>
						</div>
						<div>
							<dt>{{ t('a.heartbeat') }}</dt>
							<dd>
								{{ state?.heartbeatAt ? formatTime(state.heartbeatAt) : '—' }}
							</dd>
						</div>
						<div>
							<dt>{{ t('a.queue') }}</dt>
							<dd>{{ state?.queuedCount ?? 0 }}</dd>
						</div>
						<div>
							<dt>{{ t('a.active') }}</dt>
							<dd>{{ state?.runningCount ?? 0 }}</dd>
						</div>
						<div>
							<dt>{{ t('a.completed') }}</dt>
							<dd>{{ state?.completedDecisions ?? 0 }}</dd>
						</div>
					</dl>
				</div>
			</aside>
			<main class="agents-main">
				<nav
					class="stage-nav workspace-stage-nav"
					:style="{
						gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
					}"
					:aria-label="t('a.stageNavigation')"
				>
					<button
						v-for="(item, index) in stages"
						:key="item"
						type="button"
						:class="{ active: stage === index }"
						:aria-current="stage === index ? 'step' : undefined"
						@click="selectStage(index)"
					>
						<span>{{ String(index + 1).padStart(2, '0') }}</span
						>{{ t(`a.${item}`) }}
					</button>
					<div
						class="stage-indicator"
						:style="{
							width: `${100 / stages.length}%`,
							transform: `translateX(${stage * 100}%)`,
						}"
					/>
				</nav>
				<div
					ref="stageContent"
					class="agents-content space-y-5"
					:class="{ 'is-schedule': stage === 1, 'is-graph': stage === 4 }"
				>
					<UAlert
						v-if="loadError"
						color="error"
						:title="t('a.loadError')"
						:description="loadError.message"
						><template #actions
							><UButton color="neutral" @click="refresh()">{{
								t('a.retry')
							}}</UButton></template
						></UAlert
					>
					<UAlert
						v-if="error || state?.pauseReason"
						color="warning"
						:title="
							protectedPause
								? t('a.protectedPause')
								: error || state?.pauseReason || ''
						"
						:description="
							protectedPause
								? `${t('a.unknownUsage')}\n${[error, state?.pauseReason].filter(Boolean).join('\n')}`
								: undefined
						"
						:ui="{ description: 'whitespace-pre-wrap break-words' }"
					/><UAlert v-if="notice" color="success" :title="notice" />

					<template v-if="stage === 0"
						><section class="agents-overview-grid">
							<div
								v-for="metric in [
									{ label: t('a.queue'), value: state?.queuedCount ?? 0 },
									{ label: t('a.active'), value: state?.runningCount ?? 0 },
									{
										label: t('a.completed'),
										value: state?.completedDecisions ?? 0,
									},
									{ label: t('a.people'), value: state?.personas.length ?? 0 },
									{ label: t('a.concurrency'), value: state?.concurrency ?? 1 },
									{
										label: t('a.remaining'),
										value: state?.budget.unlimited
											? '∞'
											: dollars(state?.budget.remainingUsd),
									},
								]"
								:key="metric.label"
								class="studio-panel agents-metric"
							>
								<p>{{ metric.label }}</p>
								<strong>{{ metric.value }}</strong>
							</div>
						</section>
						<section class="studio-panel">
							<div class="studio-panel-heading">
								<h2>{{ t('a.status') }}</h2>
							</div>
							<div class="studio-panel-body space-y-4">
								<div class="flex flex-wrap gap-3">
									<UBadge
										size="lg"
										class="h-9 px-3 text-sm leading-5"
										color="neutral"
										variant="soft"
										>{{
											workerOnline ? t('a.running') : t('a.offline')
										}}</UBadge
									><UBadge
										size="lg"
										class="h-9 px-3 text-sm leading-5"
										color="neutral"
										variant="outline"
										>{{
											state?.enabled ? t('a.enabled') : t('a.paused')
										}}</UBadge
									>
								</div>
								<div class="flex flex-wrap gap-3">
									<UButton
										size="md"
										class="h-9 px-3 text-sm leading-5"
										color="neutral"
										variant="soft"
										@click="selectStage(1)"
										>{{ t('a.viewControls') }}</UButton
									><UButton
										size="md"
										class="h-9 px-3 text-sm leading-5"
										color="neutral"
										variant="outline"
										@click="selectStage(3)"
										>{{ t('a.viewAudit') }}</UButton
									>
								</div>
							</div>
						</section></template
					>
					<template v-else-if="stage === 1">
						<div class="studio-page-heading">
							<div>
								<h1>{{ t('a.schedule') }}</h1>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<span class="schedule-status">{{
									workerOnline ? t('a.running') : t('a.offline')
								}}</span
								><span class="schedule-status">{{
									state?.enabled ? t('a.enabled') : t('a.paused')
								}}</span
								><UButton
									size="md"
									icon="i-lucide-play"
									:disabled="busy || !workerOnline"
									variant="soft"
									@click="control({ action: 'start' })"
									>{{ t('a.start') }}</UButton
								><UButton
									size="md"
									icon="i-lucide-pause"
									:disabled="busy"
									color="neutral"
									variant="outline"
									@click="control({ action: 'stop' })"
									>{{ t('a.stop') }}</UButton
								>
							</div>
						</div>
						<section class="studio-panel">
							<div class="studio-panel-heading">
								<h2>{{ t('a.schedule') }}</h2>
								<div class="flex gap-3 text-xs text-muted">
									<span>{{ t('a.queue') }} {{ state?.queuedCount ?? 0 }}</span
									><span
										>{{ t('a.active') }} {{ state?.runningCount ?? 0 }}</span
									><span
										>{{ t('a.completed') }}
										{{ state?.completedDecisions ?? 0 }}</span
									>
								</div>
							</div>
							<div class="studio-panel-body space-y-4">
								<div class="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
									<UFormField
										:label="t('a.interval')"
										:error="settingsErrors.intervalSeconds"
										><UInput
											v-model="intervalSeconds"
											type="number"
											min="15"
											max="3600"
											class="w-full" /></UFormField
									><UFormField
										:label="t('a.limit')"
										:error="settingsErrors.actorLimit"
										><UInput
											v-model="actorLimit"
											type="number"
											min="1"
											:max="state?.maxActorLimit ?? 500"
											class="w-full" /></UFormField
									><UFormField
										:label="t('a.concurrency')"
										:error="settingsErrors.concurrency"
										><UInput
											v-model="concurrency"
											type="number"
											min="1"
											:max="state?.maxBackgroundConcurrency ?? 14"
											class="w-full" /></UFormField
									><UFormField
										:label="t('a.decisionLimit')"
										:error="settingsErrors.decisionLimit"
										><UInput
											v-model="decisionLimit"
											:disabled="unlimitedDecisions"
											type="number"
											min="1"
											class="w-full"
									/></UFormField>
								</div>
								<USwitch
									v-model="unlimitedDecisions"
									:label="t('a.unlimitedDecisions')"
								/>
								<p class="text-xs text-muted">{{ t('a.concurrencyNote') }}</p>
								<p class="text-xs text-muted">{{ t('a.quotaNote') }}</p>
								<div class="flex items-center gap-3">
									<UButton
										size="md"
										color="neutral"
										variant="soft"
										:disabled="busy || !canSaveSettings"
										@click="save"
										>{{ t('a.save') }}</UButton
									>
								</div>
							</div>
						</section>
						<section class="studio-panel">
							<div class="studio-panel-heading">
								<h2>{{ t('a.budget') }}</h2>
								<UBadge
									:color="state?.budget.unlimited ? 'warning' : 'neutral'"
									variant="soft"
									>{{
										state?.budget.unlimited
											? t('a.unlimitedBudget')
											: `${t('a.remaining')} ${dollars(state?.budget.remainingUsd)}`
									}}</UBadge
								>
							</div>
							<div class="studio-panel-body space-y-4">
								<div class="grid gap-4 sm:grid-cols-2">
									<div>
										<p class="text-xs text-muted">{{ t('a.shared') }}</p>
										<p class="mt-1 text-xl font-semibold tabular-nums">
											{{ dollars(state?.budget.spentUsd) }} /
											{{
												state?.budget.unlimited
													? '∞'
													: dollars(state?.budget.limitUsd)
											}}
										</p>
									</div>
									<div>
										<p class="text-xs text-muted">{{ t('a.history') }}</p>
										<p class="mt-1 text-xl font-semibold tabular-nums">
											{{ dollars(state?.budget.historicalSpentUsd) }} /
											{{ dollars(state?.budget.historicalLimitUsd) }}
										</p>
									</div>
								</div>
								<UAlert
									v-if="state?.budget.unlimited"
									color="warning"
									:title="t('a.unlimitedWarning')"
								/>
								<div class="flex flex-wrap gap-2">
									<UButton
										size="md"
										color="neutral"
										variant="outline"
										@click="increaseOpen = !increaseOpen"
										>{{ t('a.increase') }}</UButton
									><UButton
										size="md"
										v-if="!state?.budget.unlimited"
										color="warning"
										variant="outline"
										@click="unlimitedOpen = !unlimitedOpen"
										>{{ t('a.unlimitedBudget') }}</UButton
									><UButton
										size="md"
										v-else
										color="neutral"
										variant="outline"
										:disabled="busy"
										@click="
											control({ action: 'unlimitedBudget', enabled: false })
										"
										>{{ t('a.restore') }}</UButton
									>
								</div>
								<UModal
									v-model:open="increaseOpen"
									:title="t('a.increase')"
									:ui="{ content: 'max-w-sm' }"
									><template #body
										><div class="space-y-4">
											<UFormField :label="t('a.amount')"
												><UInput
													v-model="additionalUsd"
													type="number"
													min="0.01"
													max="10"
													step="0.1" /></UFormField
											><UButton
												size="md"
												:disabled="busy"
												color="neutral"
												variant="soft"
												@click="
													control({
														action: 'increase',
														additionalUsd: Number(additionalUsd),
													})
												"
												>{{ t('a.confirmIncrease') }}</UButton
											>
										</div></template
									></UModal
								>
								<UModal
									v-model:open="unlimitedOpen"
									:title="t('a.unlimitedBudget')"
									:ui="{ content: 'max-w-md' }"
									><template #body
										><div class="space-y-4">
											<UAlert
												color="warning"
												:title="t('a.unlimitedWarning')"
											/><UButton
												size="md"
												color="warning"
												:disabled="busy"
												@click="
													control({
														action: 'unlimitedBudget',
														enabled: true,
														confirm: true,
													})
												"
												>{{ t('a.unlimitedConfirm') }}</UButton
											>
										</div></template
									></UModal
								>
								<details
									v-if="state?.budget.unlimitedChanges.length"
									class="text-xs text-muted"
								>
									<summary>{{ t('a.details') }}</summary>
									<p
										v-for="(change, i) in state.budget.unlimitedChanges"
										:key="i"
										class="mt-2"
									>
										{{ formatTime(change.at) }} /
										{{
											change.enabled ? t('a.unlimitedBudget') : t('a.restore')
										}}
									</p>
								</details>
							</div>
						</section></template
					>
					<template v-else-if="stage === 2">
						<section class="studio-panel">
							<div class="studio-panel-heading">
								<h2>
									{{ t('a.people') }} ({{ people.length }} /
									{{ state?.personas.length ?? 0 }})
								</h2>
								<UInput
									v-model="personSearch"
									:placeholder="t('a.searchPeople')"
									icon="i-lucide-search"
									class="w-72 max-w-full"
								/>
							</div>
							<div class="studio-table-scroll">
								<table class="studio-data-table">
									<thead>
										<tr>
											<th>{{ t('a.person') }}</th>
											<th>{{ t('a.content') }}</th>
											<th>{{ t('a.schedule') }}</th>
											<th />
										</tr>
									</thead>
									<tbody>
										<tr v-for="person in people" :key="person.actorId">
											<td>
												<button
													class="text-left font-medium hover:text-primary"
													@click="inspectActor(person.actorId)"
												>
													{{ person.name }}
												</button>
												<p class="text-xs text-muted">
													{{ person.campus }} / {{ person.className }}
												</p>
											</td>
											<td class="max-w-72">
												<p class="text-xs">
													{{ person.interests.join(' / ') }}
												</p>
											</td>
											<td class="text-xs text-muted">
												{{ person.activeHours.join(' / ') }} h
											</td>
											<td>
												<UButton
													size="md"
													color="neutral"
													variant="soft"
													:disabled="busy"
													@click="
														control({ action: 'step', actorId: person.actorId })
													"
													>{{ t('a.step') }}</UButton
												>
											</td>
										</tr>
									</tbody>
								</table>
								<p v-if="!people.length" class="studio-empty">
									{{ t('a.empty') }}
								</p>
							</div>
						</section></template
					>
					<template v-else-if="stage === 3">
						<section class="studio-panel">
							<div class="studio-panel-heading">
								<h2>{{ t('a.jobs') }} ({{ state?.jobTotal ?? 0 }})</h2>
							</div>
							<div class="studio-panel-body flex flex-wrap gap-3">
								<USelect
									v-model="actorFilter"
									:items="actorItems"
									class="w-48"
								/><USelect
									v-model="actionFilter"
									:items="actionItems"
									class="w-40"
								/><USelect
									v-model="statusFilter"
									:items="statusItems"
									class="w-44"
								/><UInput
									v-model="jobSearch"
									:placeholder="t('a.searchJobs')"
									icon="i-lucide-search"
									class="min-w-48 flex-1"
								/>
							</div>
							<div class="studio-table-scroll">
								<table class="studio-data-table min-w-[900px]">
									<thead>
										<tr>
											<th>{{ t('a.person') }}</th>
											<th>{{ t('a.content') }}</th>
											<th>{{ t('a.target') }}</th>
											<th>{{ t('a.status') }}</th>
											<th>{{ t('a.cost') }}</th>
											<th>{{ t('a.time') }}</th>
										</tr>
									</thead>
									<tbody>
										<tr v-for="job in state?.jobs" :key="job.id">
											<td class="align-top">
												<button
													class="font-medium hover:text-primary"
													@click="actorFilter = job.actorId"
												>
													{{ job.actorName }}
												</button>
												<details class="mt-2 text-xs text-muted">
													<summary>{{ t('a.details') }}</summary>
													<p class="mt-2 break-all">{{ job.id }}</p>
													<pre
														class="mt-2 max-w-52 overflow-auto whitespace-pre-wrap"
														>{{ JSON.stringify(job.result, null, 2) }}</pre>
												</details>
											</td>
											<td class="min-w-64 max-w-96 align-top">
												<UBadge color="neutral" variant="soft">{{
													labels[job.action ?? ''] ?? '—'
												}}</UBadge>
												<p v-if="job.decision?.title" class="mt-2 font-medium">
													{{ job.decision.title }}
												</p>
												<p
													class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm"
												>
													{{ job.decision?.body ?? t('a.noContent') }}
												</p>
											</td>
											<td class="max-w-56 align-top">
												<a
													v-if="job.targetUrl"
													:href="`${website}${job.targetUrl}`"
													target="_blank"
													rel="noopener"
													class="text-primary hover:underline"
													>{{
														job.targetTitle ??
														job.decision?.targetId ??
														t('a.open')
													}}</a
												>
												<p v-else class="break-all text-xs text-muted">
													{{ job.decision?.targetId ?? t('a.noTarget') }}
												</p>
												<p
													v-if="job.decision?.parentId"
													class="mt-1 break-all text-xs text-muted"
												>
													↳ {{ job.decision.parentId }}
												</p>
											</td>
											<td class="max-w-64 align-top">
												<UBadge
													:color="
														job.status === 'failed'
															? 'error'
															: job.status === 'complete'
																? 'success'
																: 'neutral'
													"
													variant="soft"
													>{{ labels[job.status] ?? job.status }}</UBadge
												>
												<p
													v-if="job.error"
													class="mt-2 whitespace-pre-wrap break-words text-xs text-error"
												>
													{{ job.error }}
												</p>
											</td>
											<td class="align-top text-xs tabular-nums">
												<template v-if="job.costUsd != null"
													>{{ dollars(job.costUsd) }}
													<p v-if="job.costReserved" class="text-muted">
														{{ t('a.reservation') }}
													</p></template
												><span v-else class="text-muted">{{
													t('a.unknown')
												}}</span>
											</td>
											<td
												class="whitespace-nowrap align-top text-xs text-muted"
											>
												<p>
													{{ t('a.created') }} {{ formatTime(job.createdAt) }}
												</p>
												<p class="mt-1">
													{{ t('a.updated') }} {{ formatTime(job.updatedAt) }}
												</p>
											</td>
										</tr>
									</tbody>
								</table>
								<p v-if="!state?.jobs.length" class="studio-empty">
									{{ t('a.empty') }}
								</p>
							</div>
							<div class="studio-panel-body flex items-center justify-between">
								<UButton
									color="neutral"
									variant="outline"
									:disabled="page <= 1"
									@click="page--"
									>{{ t('a.previous') }}</UButton
								><span class="text-xs text-muted"
									>{{ state?.jobPage ?? 1 }} /
									{{
										Math.max(
											1,
											Math.ceil(
												(state?.jobTotal ?? 0) / (state?.jobPageSize ?? 50),
											),
										)
									}}</span
								><UButton
									color="neutral"
									variant="outline"
									:disabled="
										page * (state?.jobPageSize ?? 50) >= (state?.jobTotal ?? 0)
									"
									@click="page++"
									>{{ t('a.next') }}</UButton
								>
							</div>
						</section></template
					>
					<StudioAgentGraph v-if="stage === 4" :product-origin="website" />
				</div>
			</main>
		</div>
	</div>
</template>
<style scoped>
.agents-layout {
	width: 100%;
	flex: 1;
	min-height: 0;
	overflow: hidden;
}
.agents-main {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
}
.agents-status-list {
	display: grid;
	gap: 22px;
	font-size: 14px;
}
.agents-status-list div {
	display: grid;
	gap: 8px;
}
.agents-status-list dt {
	color: var(--studio-muted);
}
.agents-status-list dd {
	font-variant-numeric: tabular-nums;
	overflow-wrap: anywhere;
}
.agents-content {
	flex: 1;
	min-height: 0;
	min-width: 0;
	overflow: auto;
	overscroll-behavior: contain;
	padding: 24px;
	scrollbar-width: none;
}
.agents-content.is-graph {
	padding: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}
.agents-content.is-graph > :last-child {
	flex: 1;
	min-height: 0;
}
.agents-content::-webkit-scrollbar {
	display: none;
}
.agents-overview-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 20px;
}
.agents-metric {
	padding: 22px;
}
.agents-metric p {
	color: var(--studio-muted);
	font-size: 12px;
}
.agents-metric strong {
	display: block;
	font-size: 28px;
	font-weight: 500;
	margin-top: 12px;
	font-variant-numeric: tabular-nums;
}
.is-schedule :deep(button:not([role='switch']):not([role='combobox'])) {
	min-height: 36px;
}
.schedule-status {
	font-size: 12px;
	color: var(--studio-muted);
	margin-right: 8px;
}
.is-schedule > .studio-page-heading {
	align-items: center;
}
.is-schedule > .studio-page-heading > :last-child {
	gap: 8px;
}
@media (max-width: 1000px) {
	.agents-overview-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
@media (max-width: 800px) {
	.agents-layout {
		position: relative;
		display: flex;
	}
	.agents-layout > .studio-controls {
		position: absolute;
		inset: 0 auto 0 0;
		width: min(320px, 90vw);
		height: 100%;
		background: var(--canvas);
	}
	.agents-layout > .studio-controls.is-open {
		display: flex;
	}
	.agents-main {
		flex: 1;
	}
	.agents-content {
		padding: 16px;
	}
	.agents-overview-grid {
		gap: 12px;
	}
	.agents-metric {
		padding: 16px;
	}
	.agents-metric strong {
		font-size: 24px;
	}
	.agents-content :deep(.studio-panel-heading) {
		flex-wrap: wrap;
	}
	.agents-content :deep(.studio-page-heading) {
		flex-direction: column;
		align-items: flex-start;
	}
	.agents-content :deep(.studio-panel-heading input) {
		max-width: 100%;
	}
}
</style>
