<script setup lang="ts">
import type { Recommendation, ScoreWeights } from '@campus/contracts'
import {
	ACTIVITY_WEIGHTS,
	POST_WEIGHTS,
	compareRecommendations,
	type HeapFrame,
} from '@campus/recommendation'
import type { StudioState, StudioRun } from '../../shared/contracts'
import { readStudioRoute, studioRouteFields } from '../utils/studio-route'

const { t, te } = useI18n()
const topicLabel = (id: string) => (te(`topics.${id}`) ? t(`topics.${id}`) : id)
const requestFetch = useRequestFetch()
const route = useRoute(),
	router = useRouter()
const {
	data: state,
	error: stateError,
	refresh: reloadState,
} = await useAsyncData('studio-state', () =>
	requestFetch<StudioState>('/api/studio/state'),
)
const snapshot = computed(() => state.value?.snapshot)
const initialSettings = readStudioRoute(route.query, snapshot.value)
let restoringRoute = false,
	writingRoute = false,
	routeWrite = 0,
	routeReady = false
const userId = useState('studio-observer-user-id', () => '')
if (typeof route.query.user === 'string' || !userId.value)
	userId.value = initialSettings.userId
const target = ref<'activity' | 'post'>(initialSettings.type)
const k = ref(initialSettings.k)
const now = ref(initialSettings.now)
const liveTime = ref(initialSettings.live)
const liveFailure = ref(false)
watch(
	liveTime,
	(value, previous) => {
		if (!value && previous && !restoringRoute)
			now.value = snapshot.value?.now ?? now.value
	},
	{ flush: 'sync' },
)
function defaultWeights(type: 'activity' | 'post'): ScoreWeights {
	const defaults = type === 'post' ? POST_WEIGHTS : ACTIVITY_WEIGHTS
	return {
		interest: Math.round(defaults.interest * 100),
		social: Math.round(defaults.social * 100),
		popularity: Math.round(defaults.popularity * 100),
		context: Math.round(defaults.context * 100),
	}
}
const weights = reactive<ScoreWeights>(initialSettings.weights)
watch(
	target,
	(value) => {
		if (!restoringRoute) Object.assign(weights, defaultWeights(value))
	},
	{
		flush: 'sync',
	},
)
const weightKeys = ['interest', 'social', 'popularity', 'context'] as const
const selectedStage = ref(initialSettings.stage)
const stages = ['profile', 'filter', 'score', 'heap', 'result'] as const
const crossDomain = ref(true)
const run = ref<StudioRun>()
const busy = ref(false)
const failed = ref(false)
const explorationSeed = useState('studio-exploration-seed', () =>
	crypto.randomUUID(),
)
const signature = computed(() =>
	JSON.stringify({
		userId: userId.value,
		type: target.value,
		k: k.value,
		now: liveTime.value ? undefined : now.value,
		clock: liveTime.value ? 'live' : 'fixed',
		crossDomain: crossDomain.value,
		weights,
		seed: explorationSeed.value,
	}),
)
const completedSignature = ref('')
const dirty = computed(
	() => Boolean(run.value) && signature.value !== completedSignature.value,
)
const completedContext = ref({
	userId: userId.value,
	type: target.value,
	now: now.value,
	k: k.value,
})
const displayUserId = computed(() =>
	run.value ? completedContext.value.userId : userId.value,
)
const displayTarget = computed(() =>
	run.value ? completedContext.value.type : target.value,
)
const displayNow = computed(() =>
	run.value ? completedContext.value.now : now.value,
)
const displayK = computed(() =>
	run.value ? completedContext.value.k : k.value,
)
const validSettings = computed(
	() =>
		!!snapshot.value?.users.some((user) => user.id === userId.value) &&
		Number.isInteger(k.value) &&
		k.value >= 0 &&
		k.value <= 50 &&
		(liveTime.value || Number.isFinite(Date.parse(now.value))) &&
		weightKeys.every(
			(key) =>
				Number.isFinite(weights[key]) &&
				weights[key] >= 0 &&
				weights[key] <= 100,
		) &&
		weightKeys.some((key) => weights[key] > 0),
)
let automaticCalculation: ReturnType<typeof setTimeout> | undefined
const selectedId = ref('')
const controlsOpen = useState('studio-mobile-controls-open', () => false)
const sidebarCollapsed = useState('studio-sidebar-collapsed', () => false)

function toggleSidebar() {
	targetOpen.value = false
	sidebarCollapsed.value = !sidebarCollapsed.value
	if (sidebarCollapsed.value) controlsOpen.value = false
}
const targetOpen = ref(false)
const playing = ref(false)
const reducedMotion = ref(false)
const frame = ref(0)
const speed = ref(700)
let timer: ReturnType<typeof setInterval> | undefined
let sequence = 0
let requestController: AbortController | undefined
const events = computed(() => run.value?.events ?? [])
const playback = computed(() =>
	events.value.filter(
		(event) =>
			!['profile', 'filter', 'score', 'truncated'].includes(event.action),
	),
)
const current = computed(() => playback.value[frame.value])
const heap = computed<HeapFrame[]>(() => {
	for (let index = frame.value; index >= 0; index--) {
		const value = playback.value[index]?.heap
		if (value) return value
	}
	return []
})
const user = computed(() =>
	snapshot.value?.users.find((entry) => entry.id === displayUserId.value),
)
const labels = computed(
	() =>
		new Map(
			(displayTarget.value === 'activity'
				? snapshot.value?.activities
				: snapshot.value?.posts
			)?.map((entry) => [entry.id, entry.title]) ?? [],
		),
)
const title = (id: string | undefined) =>
	id ? (labels.value.get(id) ?? id) : ''
const name = (id: string) =>
	snapshot.value?.users.find((entry) => entry.id === id)?.name ?? id
const filters = computed(() =>
	events.value.filter((event) => event.action === 'filter'),
)
const scored = computed(() =>
	events.value
		.flatMap((event) =>
			event.action === 'score' && event.item ? [event.item] : [],
		)
		.sort((a, b) => compareRecommendations(b, a)),
)
const selected = computed<Recommendation | undefined>(
	() =>
		scored.value.find((item) => item.id === selectedId.value) ??
		scored.value[0],
)
const profileEntries = computed(() =>
	Object.entries(run.value?.result.profile ?? {})
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12),
)
const maxInterest = computed(() =>
	Math.max(1, ...profileEntries.value.map((entry) => entry[1])),
)
const relations = computed(() => {
	const data = snapshot.value
	if (!data) return []
	const result = new Map<
		string,
		{ id: string; friend: boolean; follow: boolean }
	>()
	for (const edge of data.friendships) {
		if (
			edge.status !== 'ACCEPTED' ||
			Date.parse(edge.createdAt) > Date.parse(displayNow.value)
		)
			continue
		const id =
			edge.requesterId === displayUserId.value
				? edge.recipientId
				: edge.recipientId === displayUserId.value
					? edge.requesterId
					: ''
		if (id) result.set(id, { id, friend: true, follow: false })
	}
	for (const edge of data.follows) {
		if (
			edge.followerId !== displayUserId.value ||
			Date.parse(edge.createdAt) > Date.parse(displayNow.value)
		)
			continue
		const old = result.get(edge.followingId)
		result.set(edge.followingId, {
			id: edge.followingId,
			friend: old?.friend ?? false,
			follow: true,
		})
	}
	return [...result.values()].slice(0, 12).map((edge, index, all) => {
		const angle = (index / all.length) * Math.PI * 2 - Math.PI / 2
		return {
			...edge,
			x: 230 + Math.cos(angle) * 150,
			y: 175 + Math.sin(angle) * 125,
		}
	})
})
const treeWidth = computed(() => {
	const maximumSize = Math.max(
		1,
		...playback.value.map((event) => event.heap?.length ?? 0),
	)
	return Math.max(760, 2 ** Math.floor(Math.log2(maximumSize)) * 96)
})
const nodes = computed(() =>
	heap.value.map((item, index) => {
		const level = Math.floor(Math.log2(index + 1))
		const offset = index - (2 ** level - 1)
		return {
			...item,
			index,
			x: ((offset + 0.5) * treeWidth.value) / 2 ** level,
			y: 45 + level * 80,
		}
	}),
)
const treeHeight = computed(() =>
	Math.max(
		260,
		100 + Math.floor(Math.log2(Math.max(1, heap.value.length))) * 80,
	),
)
const graphEdges = computed(() =>
	nodes.value.slice(1).map((node) => ({
		node,
		parent: nodes.value[Math.floor((node.index - 1) / 2)]!,
	})),
)
const activeIndices = computed(() => new Set(current.value?.indices ?? []))
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`
const number = (value: number | undefined) => (value ?? 0).toFixed(4)

function stop() {
	playing.value = false
	if (timer) clearInterval(timer)
	timer = undefined
}
function rewind() {
	stop()
	frame.value = 0
}
function previous() {
	stop()
	frame.value = Math.max(0, frame.value - 1)
}
function stepForward() {
	stop()
	next()
}
function setFrame(value: number | undefined) {
	stop()
	frame.value = value ?? 0
}
function next() {
	if (frame.value < playback.value.length - 1) frame.value++
	else stop()
}
function play() {
	if (playing.value) {
		stop()
		return
	}
	if (reducedMotion.value || dirty.value || !playback.value.length) return
	selectedStage.value = 3
	if (frame.value >= playback.value.length - 1) frame.value = 0
	playing.value = true
	timer = setInterval(next, speed.value)
}
watch(
	signature,
	() => {
		stop()
		sequence++
		requestController?.abort()
		requestController = undefined
		busy.value = false
		failed.value = false
		clearTimeout(automaticCalculation)
		if (import.meta.client && validSettings.value && !restoringRoute) {
			busy.value = true
			automaticCalculation = setTimeout(() => void calculate(), 150)
		}
	},
	{ flush: 'sync' },
)
watch(selectedStage, () => {
	stop()
	if (!restoringRoute) void syncStudioRoute()
})
watch(speed, () => {
	if (playing.value) {
		stop()
		play()
	}
})
function refreshRecommendations() {
	explorationSeed.value = crypto.randomUUID()
	void calculate()
}
async function calculate() {
	clearTimeout(automaticCalculation)
	if (!validSettings.value) return
	if (routeReady) void syncStudioRoute()
	const id = ++sequence
	requestController?.abort()
	const controller = new AbortController()
	requestController = controller
	stop()
	busy.value = true
	failed.value = false
	const settings = signature.value
	try {
		const result = await requestFetch<StudioRun>('/api/studio/run', {
			method: 'POST',
			body: JSON.parse(settings),
			signal: controller.signal,
		})
		if (id !== sequence || settings !== signature.value) return
		run.value = result
		state.value = {
			snapshot: result.snapshot,
			revision: result.revision,
			scope: 'live-product-readonly',
		}
		liveFailure.value = false
		completedContext.value = {
			userId: userId.value,
			type: target.value,
			now: result.now,
			k: k.value,
		}
		completedSignature.value = settings
		frame.value = 0
		selectedId.value = result.result.items[0]?.id ?? ''
	} catch {
		if (id === sequence) {
			failed.value = true
			liveFailure.value = true
			run.value = undefined
		}
	} finally {
		if (id === sequence) busy.value = false
	}
}

async function syncStudioRoute() {
	if (!routeReady || !validSettings.value || route.path !== '/') return
	const fields = studioRouteFields({
		userId: userId.value,
		type: target.value,
		k: k.value,
		now: now.value,
		live: liveTime.value,
		weights,
		stage: selectedStage.value,
	})
	if (
		Object.entries(fields).every(
			([key, value]) => (route.query[key] ?? '') === value,
		)
	)
		return
	const next = Object.fromEntries([
		...Object.entries(route.query).filter(
			([key]) => !Object.hasOwn(fields, key),
		),
		...Object.entries(fields).filter(([, value]) => value !== ''),
	])
	const current = ++routeWrite
	writingRoute = true
	try {
		await router.push({ query: next })
	} finally {
		if (current === routeWrite) {
			writingRoute = false
			restoreStudioRoute()
		}
	}
}
function restoreStudioRoute() {
	if (!routeReady || route.path !== '/') return
	const next = readStudioRoute(route.query, snapshot.value)
	if (
		next.userId === userId.value &&
		next.type === target.value &&
		next.k === k.value &&
		next.now === now.value &&
		next.live === liveTime.value &&
		next.stage === selectedStage.value &&
		weightKeys.every((key) => next.weights[key] === weights[key])
	)
		return
	restoringRoute = true
	userId.value = next.userId
	target.value = next.type
	k.value = next.k
	now.value = next.now
	liveTime.value = next.live
	Object.assign(weights, next.weights)
	selectedStage.value = next.stage
	restoringRoute = false
	if (validSettings.value && signature.value !== completedSignature.value) {
		clearTimeout(automaticCalculation)
		busy.value = true
		automaticCalculation = setTimeout(() => void calculate(), 0)
	}
}
watch(
	() => JSON.stringify(route.query),
	() => {
		if (!writingRoute) restoreStudioRoute()
	},
)

async function retryLiveData() {
	await reloadState()
	if (!stateError.value && snapshot.value) {
		liveFailure.value = false
		restoreStudioRoute()
		await calculate()
	}
}
let liveTimer: ReturnType<typeof setInterval> | undefined
async function checkLiveChanges() {
	if (document.hidden || busy.value || !liveTime.value || liveFailure.value)
		return
	try {
		const current = await requestFetch<{ revision: string }>(
			'/api/studio/revision',
		)
		if (current.revision !== state.value?.revision) await calculate()
	} catch {
		liveFailure.value = true
		run.value = undefined
	}
}
if (snapshot.value) await calculate()
onMounted(() => {
	routeReady = true
	liveTimer = setInterval(checkLiveChanges, 3000)
	window.addEventListener('focus', checkLiveChanges)
	const preference = matchMedia('(prefers-reduced-motion: reduce)')
	reducedMotion.value = preference.matches
	const update = () => {
		reducedMotion.value = preference.matches
		if (preference.matches) stop()
	}
	preference.addEventListener('change', update)
	onBeforeUnmount(() => preference.removeEventListener('change', update))
})
onBeforeUnmount(() => {
	routeReady = false
	if (liveTimer) clearInterval(liveTimer)
	window.removeEventListener('focus', checkLiveChanges)
	routeWrite++
	clearTimeout(automaticCalculation)
	stop()
	sequence++
	requestController?.abort()
})
</script>

<template>
	<div class="studio-shell studio-workbench">
		<div v-if="stateError || liveFailure" class="studio-empty" role="alert">
			<h1>{{ t('loadError') }}</h1>
			<UButton @click="retryLiveData">{{ t('retry') }}</UButton>
		</div>
		<div v-else-if="!snapshot" class="studio-empty" role="status">
			{{ t('loading') }}
		</div>
		<div
			v-else
			class="studio-layout"
			:class="{ 'sidebar-collapsed': sidebarCollapsed }"
		>
			<aside
				id="studio-controls"
				class="studio-controls"
				:class="{ 'is-open': controlsOpen, 'is-collapsed': sidebarCollapsed }"
			>
				<div class="studio-controls-heading">
					<h2 v-show="!sidebarCollapsed">{{ t('controls') }}</h2>
					<UButton
						:icon="
							sidebarCollapsed
								? 'i-lucide-panel-left-open'
								: 'i-lucide-panel-left-close'
						"
						color="neutral"
						variant="ghost"
						class="studio-sidebar-toggle"
						:aria-label="
							t(sidebarCollapsed ? 'expandSidebar' : 'collapseSidebar')
						"
						:aria-expanded="!sidebarCollapsed"
						aria-controls="studio-controls-content"
						@click="toggleSidebar"
					/>
				</div>
				<div
					:inert="sidebarCollapsed"
					id="studio-controls-content"
					class="studio-controls-scroll"
				>
					<form @submit.prevent="refreshRecommendations">
						<div class="control-pair">
							<UFormField :label="t('target')"
								><USelect
									v-model="target"
									v-model:open="targetOpen"
									:content="{
										position: 'popper',
										align: 'start',
										sideOffset: 6,
									}"
									:ui="{ content: 'w-28 min-w-0' }"
									:items="[
										{ value: 'activity', label: t('activity') },
										{ value: 'post', label: t('post') },
									]"
									class="w-full" /></UFormField
							><UFormField :label="t('topK')"
								><UInput
									v-model.number="k"
									type="number"
									:min="0"
									:max="50"
									required
									class="w-full"
							/></UFormField>
						</div>
						<UFormField :label="t('clock')">
							<StudioClockPicker
								v-model="now"
								v-model:live="liveTime"
								:current="snapshot.now"
							/>
						</UFormField>
						<UCheckbox v-model="crossDomain" :label="t('crossDomainBooks')" />
						<div class="weights-title">
							<h3>{{ t('weights') }}</h3>
						</div>
						<div class="weight-controls">
							<UFormField v-for="key in weightKeys" :key="key" :label="t(key)"
								><span class="weight-label-dot" :class="key" /><UInput
									v-model.number="weights[key]"
									type="number"
									:min="0"
									:max="100"
									required
									class="w-full"
							/></UFormField>
						</div>
						<UButton
							type="submit"
							color="primary"
							variant="solid"
							class="studio-run-button"
							block
							size="lg"
							icon="i-lucide-play"
							:loading="busy"
							:disabled="busy || !weightKeys.some((key) => weights[key] > 0)"
							>{{ t('run') }}</UButton
						>
					</form>
				</div>
			</aside>
			<main
				class="studio-main"
				:class="{ 'is-heap-stage': selectedStage === 3 && run }"
			>
				<nav class="stage-nav" :aria-label="t('studio')">
					<button
						v-for="(stage, index) in stages"
						:key="stage"
						:class="{ active: selectedStage === index }"
						:aria-current="selectedStage === index ? 'step' : undefined"
						@click="selectedStage = index"
					>
						<span>{{ String(index + 1).padStart(2, '0') }}</span
						>{{ t(stage) }}
					</button>
					<span
						class="stage-indicator"
						aria-hidden="true"
						:style="{ transform: `translateX(${selectedStage * 100}%)` }"
					/>
				</nav>
				<div
					class="studio-content"
					:class="{ 'is-heap-content': selectedStage === 3 && run }"
					:key="selectedStage"
				>
					<p v-if="failed" class="studio-alert" role="alert">
						{{ t('error') }}
					</p>
					<p v-if="!validSettings" class="studio-alert" role="alert">
						{{ t('invalidSettings') }}
					</p>
					<p v-if="run?.truncated && !dirty" class="studio-alert" role="status">
						{{ t('truncated') }}
					</p>
					<template v-if="run">
						<div v-if="selectedStage !== 3" class="run-metrics">
							<span v-if="selectedStage === 3" class="heap-action-label">{{
								current
									? t(current.action)
									: t(displayK === 0 ? 'noResults' : 'heapEmpty')
							}}</span>
							<span
								><strong>{{ run.result.candidateCount }}</strong
								>{{ t('candidateCount') }}</span
							><span
								><strong>{{ run.result.items.length }}</strong
								>{{ t('selectedCount') }}</span
							><span
								><strong
									>{{ run.result.elapsedMs.toFixed(2)
									}}<small> ms</small></strong
								>{{ t('elapsed') }}</span
							>
							<span v-if="run.result.exploration" class="exploration-caption">{{
								t('rankingBlend', {
									relevance: Math.round(
										(1 - run.result.exploration.strength) * 100,
									),
									exploration: Math.round(
										run.result.exploration.strength * 100,
									),
								})
							}}</span>
							<UButton
								class="studio-reroll"
								icon="i-lucide-refresh-cw"
								size="xs"
								color="neutral"
								variant="ghost"
								:loading="busy"
								@click="refreshRecommendations"
								>{{ t('reroll') }}</UButton
							>
							<span v-if="busy" class="calculation-status" role="status">{{
								t('calculating')
							}}</span>
						</div>
						<section v-if="selectedStage === 0" class="profile-stage">
							<article class="canvas-panel interest-panel">
								<div class="panel-topline">
									<h3>{{ user?.name }}</h3>
									<span>{{ user?.campus }}</span>
								</div>
								<div class="interest-list">
									<div
										v-for="[tag, value] in profileEntries"
										:key="tag"
										class="interest-row"
									>
										<span>{{ topicLabel(tag) }}</span>
										<div>
											<i
												:style="{ width: `${(value / maxInterest) * 100}%` }"
											/>
										</div>
										<strong>{{ value.toFixed(2) }}</strong>
									</div>
									<p v-if="!profileEntries.length" class="muted">
										{{ t('noInterest') }}
									</p>
								</div>
							</article>
							<article class="canvas-panel graph-panel">
								<div class="panel-topline">
									<h3>{{ t('social') }}</h3>
									<span
										><i class="legend-line" />{{ t('friend') }}
										<i class="legend-line follow" />{{ t('follow') }}</span
									>
								</div>
								<svg
									v-if="relations.length"
									viewBox="0 0 460 350"
									class="relation-graph"
									role="img"
									:aria-label="t('localGraph')"
								>
									<defs>
										<marker
											id="arrow"
											viewBox="0 0 10 10"
											refX="30"
											refY="5"
											markerWidth="5"
											markerHeight="5"
											orient="auto-start-reverse"
										>
											<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
										</marker>
									</defs>
									<g v-for="edge in relations" :key="edge.id">
										<line
											x1="230"
											y1="175"
											:x2="edge.x"
											:y2="edge.y"
											:class="{ followed: edge.follow && !edge.friend }"
											:marker-end="edge.follow ? 'url(#arrow)' : undefined"
										/>
										<circle
											:cx="edge.x"
											:cy="edge.y"
											r="21"
											:class="{ followed: edge.follow && !edge.friend }"
										/>
										<text :x="edge.x" :y="edge.y + 39" text-anchor="middle">
											{{ name(edge.id).slice(0, 8) }}
										</text>
										<title>
											{{ name(edge.id) }} / {{ edge.friend ? t('friend') : '' }}
											{{ edge.follow ? t('follow') : '' }}
										</title>
									</g>
									<circle cx="230" cy="175" r="34" class="user-node" />
									<text x="230" y="180" text-anchor="middle" class="user-text">
										{{ user?.name.slice(0, 5) }}
									</text>
								</svg>
								<div v-else class="stage-empty">{{ t('noRelations') }}</div>
								<p class="panel-caption">{{ t('localGraph') }}</p>
							</article>
						</section>
						<section
							v-else-if="selectedStage === 1"
							class="canvas-panel filter-stage"
						>
							<div class="panel-topline">
								<h3>{{ t('filterAll') }}</h3>
								<span
									><i class="legend-dot" />{{ t('eligible') }}
									<i class="legend-dot excluded" />{{ t('excluded') }}</span
								>
							</div>
							<div class="candidate-field">
								<button
									v-for="entry in filters"
									:key="entry.id"
									class="candidate-cell"
									:class="{
										excluded: !entry.accepted,
										selected: selectedId === entry.id,
									}"
									:aria-pressed="selectedId === entry.id"
									@click="selectedId = entry.id ?? ''"
								>
									<span class="candidate-symbol">{{
										entry.accepted ? '↗' : '−'
									}}</span
									><strong>{{ title(entry.id) }}</strong
									><span>{{
										entry.reason ? t(entry.reason) : t('eligible')
									}}</span>
								</button>
							</div>
							<p v-if="!filters.length" class="stage-empty">
								{{
									t(
										k === 0 && run.result.candidateCount > 0
											? 'noResults'
											: 'noCandidates',
									)
								}}
							</p>
						</section>
						<section v-else-if="selectedStage === 2" class="score-stage">
							<article class="canvas-panel distribution-panel">
								<div class="panel-topline">
									<h3>{{ t('score') }}</h3>
									<span>0 — 1</span>
								</div>
								<button
									v-for="item in scored"
									:key="item.id"
									class="score-row"
									:class="{ selected: selected?.id === item.id }"
									:aria-pressed="selected?.id === item.id"
									@click="selectedId = item.id"
								>
									<span>{{ title(item.id) }}</span>
									<div class="score-track">
										<i
											v-for="key in weightKeys"
											:key="key"
											:class="key"
											:style="{
												width: percentage(
													item.contributions[key] *
														(1 - (item.explorationStrength ?? 0)),
												),
											}"
										/>
										<i
											v-if="item.explorationStrength !== undefined"
											class="exploration-part"
											:style="{
												width: percentage(
													(item.explorationDraw ?? 0) *
														item.explorationStrength,
												),
											}"
										/>
									</div>
									<strong>{{ number(item.score) }}</strong>
								</button>
								<p v-if="!scored.length" class="stage-empty">
									{{
										t(
											k === 0 && run.result.candidateCount > 0
												? 'noResults'
												: 'noCandidates',
										)
									}}
								</p>
							</article>
							<article v-if="selected" class="canvas-panel evidence-panel">
								<span class="eyebrow">{{ t('evidence') }}</span>
								<h3>{{ title(selected.id) }}</h3>
								<div class="score-total">
									{{ number(selected.score) }}<small>{{ t('total') }}</small>
								</div>
								<dl class="contribution-list">
									<div v-for="key in weightKeys" :key="key">
										<dt><i class="legend-dot" :class="key" />{{ t(key) }}</dt>
										<dd>
											{{ number(selected.parts[key]) }} ×
											{{ number(run.result.weights[key]) }}
											<strong>{{ number(selected.contributions[key]) }}</strong>
										</dd>
									</div>
								</dl>
								<div
									v-if="selected.explorationStrength !== undefined"
									class="exploration-equation"
								>
									<span
										>{{ t('relevanceScore') }}
										{{ number(selected.relevanceScore) }}</span
									><span
										>× {{ number(1 - selected.explorationStrength) }} +
										{{ t('explorationScore') }}
										{{ number(selected.explorationDraw) }} ×
										{{ number(selected.explorationStrength) }}</span
									><strong>= {{ number(selected.score) }}</strong>
								</div>
								<p v-if="selected.fallback" class="fallback-label">
									{{ t('fallback') }}
								</p>
								<dl class="evidence-list">
									<div>
										<dt>{{ t('matched') }}</dt>
										<dd>
											{{
												selected.matchedTags.map(topicLabel).join(' / ') ||
												t('none')
											}}
										</dd>
									</div>
									<div>
										<dt>{{ t('friendsEvidence') }}</dt>
										<dd>
											{{
												selected.friendIds.map(name).join(' / ') || t('none')
											}}
										</dd>
									</div>
									<div>
										<dt>{{ t('followsEvidence') }}</dt>
										<dd>
											{{
												selected.followIds.map(name).join(' / ') || t('none')
											}}
										</dd>
									</div>
								</dl>
							</article>
						</section>
						<section v-else-if="selectedStage === 3" class="heap-stage">
							<StudioHeapWorkspace
								:heap="heap"
								:nodes="nodes"
								:edges="graphEdges"
								:active-indices="activeIndices"
								:trace="playback"
								:frame="frame"
								:capacity="displayK"
								:tree-width="treeWidth"
								:tree-height="treeHeight"
								:title-for="title"
								:current="current"
								@select="selectedId = $event"
								@seek="setFrame"
							>
								<template #summary
									><div class="run-metrics">
										<span
											v-if="selectedStage === 3"
											class="heap-action-label"
											>{{
												current
													? t(current.action)
													: t(displayK === 0 ? 'noResults' : 'heapEmpty')
											}}</span
										>
										<span
											><strong>{{ run.result.candidateCount }}</strong
											>{{ t('candidateCount') }}</span
										><span
											><strong>{{ run.result.items.length }}</strong
											>{{ t('selectedCount') }}</span
										><span
											><strong
												>{{ run.result.elapsedMs.toFixed(2)
												}}<small> ms</small></strong
											>{{ t('elapsed') }}</span
										>
										<span
											v-if="run.result.exploration"
											class="exploration-caption"
											>{{
												t('rankingBlend', {
													relevance: Math.round(
														(1 - run.result.exploration.strength) * 100,
													),
													exploration: Math.round(
														run.result.exploration.strength * 100,
													),
												})
											}}</span
										>
										<UButton
											class="studio-reroll"
											icon="i-lucide-refresh-cw"
											size="xs"
											color="neutral"
											variant="ghost"
											:loading="busy"
											@click="refreshRecommendations"
											>{{ t('reroll') }}</UButton
										>
										<span
											v-if="busy"
											class="calculation-status"
											role="status"
											>{{ t('calculating') }}</span
										>
									</div></template
								>
								<template #controls
									><div class="playback-controls" :aria-label="t('actions')">
										<div class="playback-buttons">
											<UButton
												color="neutral"
												variant="ghost"
												icon="i-lucide-skip-back"
												:aria-label="t('rewind')"
												@click="rewind"
											/><UButton
												color="neutral"
												variant="ghost"
												icon="i-lucide-chevron-left"
												:disabled="frame <= 0"
												:aria-label="t('previous')"
												@click="previous"
											/><UButton
												:icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
												:disabled="reducedMotion || !playback.length"
												@click="play"
												>{{ t(playing ? 'pause' : 'play') }}</UButton
											><UButton
												color="neutral"
												variant="ghost"
												icon="i-lucide-chevron-right"
												:disabled="frame >= playback.length - 1"
												:aria-label="t('next')"
												@click="stepForward"
											/>
										</div>
										<label class="playback-progress"
											><span
												>{{ t('step') }} {{ playback.length ? frame + 1 : 0 }} /
												{{ playback.length }}</span
											> </label
										><USelect
											v-model="speed"
											:items="[
												{ value: 1400, label: '0.5×' },
												{ value: 700, label: '1×' },
												{ value: 350, label: '2×' },
											]"
											:aria-label="t('speed')"
											class="speed-select"
										/></div
								></template>
							</StudioHeapWorkspace>
							<p v-if="reducedMotion" class="sr-only">
								{{ t('reducedMotion') }}
							</p>
						</section>
						<section v-else class="result-stage">
							<article
								v-for="(item, index) in run.result.items"
								:key="item.id"
								class="result-item"
							>
								<span class="result-rank">{{
									String(index + 1).padStart(2, '0')
								}}</span>
								<div>
									<h3>{{ title(item.id) }}</h3>
									<p>
										{{
											item.matchedTags.map(topicLabel).join(' / ') ||
											t(item.fallback ? 'fallback' : 'none')
										}}
									</p>
								</div>
								<div class="result-score">
									<strong>{{ number(item.score) }}</strong
									><span>{{ t('total') }}</span>
								</div>
							</article>
							<p v-if="!run.result.items.length" class="stage-empty">
								{{ t('noResults') }}
							</p>
						</section>
					</template>
					<div v-else class="studio-empty">
						<UButton :loading="busy" @click="refreshRecommendations">{{
							t('run')
						}}</UButton>
					</div>
				</div>
			</main>
		</div>
	</div>
</template>
