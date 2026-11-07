<script setup lang="ts">
import type {
	AgentGraphNode,
	AgentGraphResponse,
	AgentGraphEdgeKind,
	AgentGraphState,
	AgentGraphEvent,
	AgentGraphLike,
} from '../../shared/types/agent-graph'
interface Point {
	x: number
	y: number
}
interface GraphProps {
	productOrigin: string
}
const props = defineProps<GraphProps>()
interface PositionedNode extends AgentGraphNode, Point {}
interface GraphDrag {
	pointer: number
	start: Point
	origin: Point
	nodeId?: string
	moved: boolean
}
const { t } = useI18n({
	useScope: 'local',
	messages: {
		'zh-CN': {
			title: '关系与运行图',
			all: '全部角色',
			active: '有待执行任务',
			search: '搜索角色并定位',
			reset: '复位视角',
			locate: '定位',
			loading: '正在读取关系与运行状态',
			failed: '读取失败，请检查主站与角色运行数据库',
			retry: '重试',
			stale: '更新失败，当前保留上次观察结果',
			empty: '暂无符合条件的角色',
			running: '运行中',
			ready: '待重试',
			queued: '排队中',
			idle: '暂无任务',
			human: '人工接管',
			friend: '好友',
			follow: '关注',
			message: '近期私信',
			comment: '近期评论',
			task: '任务触发',
			close: '关闭角色详情',
			viewProfile: '查看主页',
			current: '当前任务',
			recent: '最近动作',
			noTask: '暂无',
			observed: '观察于',
			liveEvents: '实时动态',
			noEvents: '最近暂无新动态',
			collapseEvents: '收起动态',
			expandEvents: '展开动态',
			messageEvent: '{actor} 私信了 {target}',
			commentEvent: '{actor} 回复了 {target}',
			postEvent: '{actor} 发布了帖子',
			eventDetail: '动态详情',
			filterState: '筛选{state}',
			help: '拖动节点调整位置，拖动画布平移，滚轮缩放，方向键平移',
			roleCount: '角色 {count}',
			edgeCount: '关系 {count}',
			humanHelp: '人工接管表示存在有效登录会话，不代表当前在线',
			post: '发布帖子',
			like: '点赞',
			friendAction: '加好友',
			accept: '接受好友申请',
			followAction: '关注',
			favorite: '收藏',
			skip: '保持静默',
			borrow: '借书',
			return: '还书',
			reading: '更新阅读状态',
			read: '标记已读',
			complete: '已完成',
			failedJob: '失败',
			stopped: '已停止',
		},
	},
})
const avatarClip = `agent-avatar-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
const viewport = ref<HTMLElement>(),
	response = shallowRef<AgentGraphResponse>(),
	positions = reactive(new Map<string, Point>()),
	selectedId = ref<string>(),
	query = ref(''),
	activeOnly = ref(false),
	stateFilter = ref<AgentGraphState | null>(null),
	eventsExpanded = ref(true),
	openedEvent = shallowRef<AgentGraphEvent>(),
	eventModalOpen = ref(false),
	failedAvatars = reactive(new Set<string>()),
	loading = ref(true),
	failed = ref(false),
	zoom = ref(1),
	pan = reactive<Point>({ x: 0, y: 0 }),
	size = reactive({ width: 1000, height: 650 }),
	dragging = ref(false)
let drag: GraphDrag | undefined,
	timer: ReturnType<typeof setTimeout> | undefined,
	controller: AbortController | undefined,
	observer: ResizeObserver | undefined,
	disposed = false,
	moveFrame = 0,
	wheelFrame = 0,
	pendingMove: PointerEvent | undefined,
	pendingWheel: { x: number; y: number; delta: number } | undefined
const heartEffects = shallowRef<AgentGraphLike[]>([])
const seenLikes = new Map<string, number>()
const heartTimers = new Set<ReturnType<typeof setTimeout>>()
function updateHeartEffects(data: AgentGraphResponse) {
	const observedAt = Date.parse(data.observedAt)
	for (const [id, at] of seenLikes)
		if (observedAt - at > 60_000) seenLikes.delete(id)
	for (const like of data.likes ?? []) {
		if (seenLikes.has(like.id)) continue
		seenLikes.set(like.id, Date.parse(like.occurredAt))
		if (!response.value && observedAt - Date.parse(like.occurredAt) > 3000)
			continue
		heartEffects.value = [...heartEffects.value, like]
		const timer = setTimeout(() => {
			heartEffects.value = heartEffects.value.filter(
				(effect) => effect.id !== like.id,
			)
			heartTimers.delete(timer)
		}, 3000)
		heartTimers.add(timer)
	}
}
const nodes = computed<PositionedNode[]>(() =>
	(response.value?.nodes ?? [])
		.filter(
			(node) =>
				(!activeOnly.value || node.state !== 'idle' || node.humanControlled) &&
				(!stateFilter.value || node.state === stateFilter.value),
		)
		.map((node) => ({
			...node,
			...(positions.get(node.id) ?? { x: 0, y: 0 }),
		})),
)
const nodeMap = computed(
	() => new Map(nodes.value.map((node) => [node.id, node])),
)
const edges = computed(() =>
	(response.value?.edges ?? []).flatMap((edge) => {
		const source = nodeMap.value.get(edge.source),
			target = nodeMap.value.get(edge.target)
		return source && target
			? [{ ...edge, sourceNode: source, targetNode: target }]
			: []
	}),
)
// Keep historical relationships quiet and draw recent interactions above them.
interface EdgePathGroup {
	key: string
	kind: AgentGraphEdgeKind
	dim: boolean
	focused: boolean
	live: boolean
	segments: string[]
}
const edgePaths = computed(() => {
	const groups = new Map<string, EdgePathGroup>()
	const observedAt = Date.parse(response.value?.observedAt ?? '')
	for (const edge of edges.value) {
		const connected =
			edge.source === selectedId.value || edge.target === selectedId.value
		const dim = !!selectedId.value && !connected
		const age = observedAt - Date.parse(edge.lastAt ?? '')
		const live = !dim && (edge.kind === 'task' || (age >= 0 && age < 120_000))
		const focused =
			!dim &&
			(connected ||
				live ||
				((edge.kind === 'message' || edge.kind === 'comment') &&
					age >= 0 &&
					age < 900_000))
		const key = `${edge.kind}-${dim}-${focused}-${live}`
		let group = groups.get(key)
		if (!group) {
			group = { key, kind: edge.kind, dim, focused, live, segments: [] }
			groups.set(key, group)
		}
		group.segments.push(
			`M${edge.sourceNode.x},${edge.sourceNode.y}L${edge.targetNode.x},${edge.targetNode.y}`,
		)
	}
	return [...groups.values()]
		.sort(
			(a, b) =>
				Number(a.focused) - Number(b.focused) ||
				Number(a.live) - Number(b.live),
		)
		.map(({ segments, ...group }) => ({ ...group, d: segments.join('') }))
})
const hearts = computed(() => {
	const latest = new Map(
		heartEffects.value.map((effect) => [effect.actorId, effect]),
	)
	return [...latest.values()].flatMap((effect) => {
		const node = nodeMap.value.get(effect.actorId)
		return node ? [{ effect, node }] : []
	})
})
const postBubbles = computed(() => {
	const observedAt = Date.parse(response.value?.observedAt ?? '')
	const authors = new Set<string>()
	return (response.value?.events ?? []).flatMap((event) => {
		const node = nodeMap.value.get(event.actorId)
		const age = observedAt - Date.parse(event.occurredAt)
		if (
			event.kind !== 'post' ||
			!node ||
			authors.has(event.actorId) ||
			age < 0 ||
			age >= 45_000
		)
			return []
		authors.add(event.actorId)
		return [{ event, node }]
	})
})
const filterOptions = computed(() => [
	{ label: t('all'), value: 'all' },
	{ label: t('active'), value: 'active' },
])
const roleFilter = computed({
	get: () => (activeOnly.value ? 'active' : 'all'),
	set: (value: string) => {
		activeOnly.value = value === 'active'
		stateFilter.value = null
	},
})
const selected = computed(() =>
	response.value?.nodes.find((node) => node.id === selectedId.value),
)
const neighbours = computed(() => {
	const ids = new Set([selectedId.value])
	if (selectedId.value)
		for (const edge of response.value?.edges ?? []) {
			if (edge.source === selectedId.value) ids.add(edge.target)
			if (edge.target === selectedId.value) ids.add(edge.source)
		}
	return ids
})
const matches = computed(() =>
	query.value.trim()
		? (response.value?.nodes ?? [])
				.filter((node) =>
					node.name
						.toLocaleLowerCase()
						.includes(query.value.trim().toLocaleLowerCase()),
				)
				.slice(0, 8)
		: [],
)
const transform = computed(
	() =>
		`translate(${size.width / 2 + pan.x} ${size.height / 2 + pan.y}) scale(${zoom.value})`,
)
const kinds: AgentGraphEdgeKind[] = [
	'friend',
	'follow',
	'message',
	'comment',
	'task',
]
const graphStates: AgentGraphState[] = ['running', 'ready', 'queued', 'idle']
function toggleState(state: AgentGraphState) {
	activeOnly.value = false
	stateFilter.value = stateFilter.value === state ? null : state
}
function eventLabel(event: AgentGraphEvent) {
	return t(`${event.kind}Event`, {
		actor: event.actorName,
		target: event.targetName ?? '',
	})
}
function eventLink(event: AgentGraphEvent) {
	return event.postId
		? `${props.productOrigin}/?post=${encodeURIComponent(event.postId)}`
		: undefined
}
function openEvent(event: AgentGraphEvent) {
	openedEvent.value = event
	eventModalOpen.value = true
}
function seedPositions(data: AgentGraphResponse) {
	// A stable sunflower layout adds new roles without moving any existing node.
	for (const [index, node] of data.nodes.entries())
		if (!positions.has(node.id)) {
			const angle = index * 2.399963229728653,
				radius = 44 * Math.sqrt(index)
			positions.set(node.id, {
				x: Math.cos(angle) * radius,
				y: Math.sin(angle) * radius,
			})
		}
}
async function refresh() {
	if (disposed || controller) return
	controller = new AbortController()
	try {
		const data = await $fetch<AgentGraphResponse>('/api/agents/graph', {
			signal: controller.signal,
		})
		if (disposed) return
		seedPositions(data)
		updateHeartEffects(data)
		response.value = data
		failed.value = false
	} catch {
		if (!disposed) failed.value = true
	} finally {
		loading.value = false
		controller = undefined
		if (!disposed)
			timer = setTimeout(() => {
				if (document.visibilityState === 'visible') void refresh()
				else timer = setTimeout(pollVisible, 2500)
			}, 2500)
	}
}
function pollVisible() {
	if (disposed) return
	if (document.visibilityState === 'visible') void refresh()
	else timer = setTimeout(pollVisible, 2500)
}
function retry() {
	clearTimeout(timer)
	void refresh()
}
function focusWindow() {
	if (!controller) retry()
}
function reset() {
	pan.x = 0
	pan.y = 0
	const radius = Math.max(
		150,
		...nodes.value.map((node) => Math.hypot(node.x, node.y) + 50),
	)
	zoom.value = Math.max(
		0.25,
		Math.min(1, (Math.min(size.width, size.height) - 120) / (radius * 2)),
	)
}
function locate(id: string) {
	const point = positions.get(id)
	if (!point) return
	activeOnly.value = false
	stateFilter.value = null
	selectedId.value = id
	zoom.value = Math.max(0.75, zoom.value)
	pan.x = -point.x * zoom.value
	pan.y = -point.y * zoom.value
	query.value = ''
}
function begin(event: PointerEvent, nodeId?: string) {
	if (event.button !== 0) return
	if (nodeId) event.stopPropagation()
	const target = viewport.value
	if (!target) return
	drag = {
		pointer: event.pointerId,
		start: { x: event.clientX, y: event.clientY },
		origin: { ...(nodeId ? positions.get(nodeId)! : pan) },
		nodeId,
		moved: false,
	}
	target.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
	if (!drag || event.pointerId !== drag.pointer) return
	pendingMove = event
	if (!moveFrame) moveFrame = requestAnimationFrame(flushMove)
}
function flushMove() {
	moveFrame = 0
	const event = pendingMove
	pendingMove = undefined
	if (!event) return

	if (!drag || event.pointerId !== drag.pointer) return
	const dx = event.clientX - drag.start.x,
		dy = event.clientY - drag.start.y
	if (!drag.moved && Math.hypot(dx, dy) < 4) return
	drag.moved = true
	dragging.value = true
	if (drag.nodeId)
		positions.set(drag.nodeId, {
			x: drag.origin.x + dx / zoom.value,
			y: drag.origin.y + dy / zoom.value,
		})
	else {
		pan.x = drag.origin.x + dx
		pan.y = drag.origin.y + dy
	}
}
function end(event: PointerEvent) {
	cancelAnimationFrame(moveFrame)
	flushMove()
	if (!drag || event.pointerId !== drag.pointer) return
	if (!drag.moved && drag.nodeId && event.type !== 'pointercancel')
		selectedId.value = drag.nodeId
	if (viewport.value?.hasPointerCapture(event.pointerId))
		viewport.value.releasePointerCapture(event.pointerId)
	drag = undefined
	dragging.value = false
}
function wheel(event: WheelEvent) {
	pendingWheel = {
		x: event.clientX,
		y: event.clientY,
		delta:
			(pendingWheel?.delta ?? 0) +
			event.deltaY *
				(event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1),
	}
	if (!wheelFrame) wheelFrame = requestAnimationFrame(flushWheel)
}
function flushWheel() {
	wheelFrame = 0
	const event = pendingWheel
	pendingWheel = undefined
	if (!viewport.value || !event) return
	const box = viewport.value.getBoundingClientRect(),
		next = Math.max(
			0.25,
			Math.min(2.5, zoom.value * Math.exp(-event.delta * 0.0015)),
		),
		x = event.x - box.left - size.width / 2,
		y = event.y - box.top - size.height / 2,
		ratio = next / zoom.value
	pan.x = x - (x - pan.x) * ratio
	pan.y = y - (y - pan.y) * ratio
	zoom.value = next
}
function key(event: KeyboardEvent) {
	const offset: Record<string, Point> = {
		ArrowLeft: { x: 32, y: 0 },
		ArrowRight: { x: -32, y: 0 },
		ArrowUp: { x: 0, y: 32 },
		ArrowDown: { x: 0, y: -32 },
	}
	if (offset[event.key]) {
		event.preventDefault()
		pan.x += offset[event.key]!.x
		pan.y += offset[event.key]!.y
	}
	if (event.key === 'Escape') selectedId.value = undefined
	if (event.key === 'Home') {
		event.preventDefault()
		reset()
	}
}
function time(value: string) {
	return new Intl.DateTimeFormat('zh-CN', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).format(new Date(value))
}
function action(value: string | null) {
	if (!value) return t('noTask')
	const keys: Record<string, string> = {
		failed: 'failedJob',
		follow: 'followAction',
		friend: 'friendAction',
	}
	return t(keys[value] ?? value)
}
onMounted(() => {
	observer = new ResizeObserver(([entry]) => {
		if (entry) {
			size.width = entry.contentRect.width
			size.height = entry.contentRect.height
		}
	})
	if (viewport.value) observer.observe(viewport.value)
	void refresh().then(reset)
	window.addEventListener('focus', focusWindow)
})
onBeforeUnmount(() => {
	disposed = true
	for (const timer of heartTimers) clearTimeout(timer)
	cancelAnimationFrame(moveFrame)
	cancelAnimationFrame(wheelFrame)
	clearTimeout(timer)
	controller?.abort()
	observer?.disconnect()
	window.removeEventListener('focus', focusWindow)
})
</script>

<template>
	<section class="agent-graph">
		<div class="agent-graph-tools" @pointerdown.stop>
			<div class="agent-graph-controls">
				<USelect
					v-model="roleFilter"
					:items="filterOptions"
					:aria-label="t('active')"
					size="sm"
					class="w-40"
				/>
				<div class="agent-graph-search">
					<UInput
						v-model="query"
						size="sm"
						color="primary"
						class="agent-graph-query"
						:placeholder="t('search')"
						:aria-label="t('search')"
						@keydown.enter.prevent="matches[0] && locate(matches[0].id)"
						@keydown.esc="query = ''"
					/>
					<div v-if="query.trim()" class="agent-graph-results">
						<button
							v-for="node in matches"
							:key="node.id"
							type="button"
							@click="locate(node.id)"
						>
							{{ node.name }}<span>{{ t('locate') }}</span>
						</button>
						<p v-if="!matches.length">{{ t('empty') }}</p>
					</div>
				</div>
				<span class="agent-graph-counts"
					>{{ t('roleCount', { count: nodes.length }) }} /
					{{ t('edgeCount', { count: edges.length }) }}</span
				>
			</div>
			<div class="agent-graph-observation">
				<span v-if="response"
					>{{ t('observed') }} {{ time(response.observedAt) }}</span
				>
				<span>{{ Math.round(zoom * 100) }}%</span>
				<UButton
					icon="i-lucide-maximize"
					color="neutral"
					variant="ghost"
					size="sm"
					:aria-label="t('reset')"
					:title="t('reset')"
					@click="reset"
				/>
			</div>
		</div>
		<div
			ref="viewport"
			class="agent-graph-viewport"
			:class="{ 'is-dragging': dragging }"
			tabindex="0"
			:aria-label="t('help')"
			@pointerdown="begin($event)"
			@pointermove="move"
			@pointerup="end"
			@pointercancel="end"
			@wheel.prevent="wheel"
			@keydown="key"
		>
			<svg
				:width="size.width"
				:height="size.height"
				role="group"
				:aria-label="t('title')"
			>
				<defs>
					<clipPath :id="avatarClip"><circle r="12" /></clipPath>
				</defs>
				<g :transform="transform">
					<g v-memo="[edgePaths]" class="agent-graph-edges" aria-hidden="true">
						<path
							v-for="path in edgePaths"
							:key="path.key"
							:d="path.d"
							:class="[
								`edge-${path.kind}`,
								{
									'is-dim': path.dim,
									'is-focused': path.focused,
									'is-live': path.live,
								},
							]"
							fill="none"
							vector-effect="non-scaling-stroke"
						/>
					</g>
					<g
						v-for="node in nodes"
						:key="node.id"
						v-memo="[
							node.x,
							node.y,
							node.name,
							node.avatar,
							failedAvatars.has(node.avatar),
							node.state,
							node.humanControlled,
							selectedId === node.id,
							!!selectedId && !neighbours.has(node.id),
							zoom >= 0.55,
						]"
						class="agent-graph-node"
						:class="[
							`state-${node.state}`,
							{
								'is-selected': selectedId === node.id,
								'is-dim': selectedId && !neighbours.has(node.id),
								'is-human': node.humanControlled,
							},
						]"
						:transform="`translate(${node.x} ${node.y})`"
						role="button"
						tabindex="0"
						:aria-label="`${node.name} / ${t(node.state)}${node.humanControlled ? ' / ' + t('human') : ''}`"
						@pointerdown="begin($event, node.id)"
						@keydown.enter.stop="selectedId = node.id"
						@keydown.space.stop.prevent="selectedId = node.id"
					>
						<circle class="node-halo" r="20" />
						<circle class="node-body" r="14" />
						<text class="node-initial" text-anchor="middle" dy=".35em">
							{{ Array.from(node.name)[0] }}
						</text>
						<image
							v-if="node.avatar && !failedAvatars.has(node.avatar)"
							:href="node.avatar"
							x="-12"
							y="-12"
							width="24"
							height="24"
							:clip-path="`url(#${avatarClip})`"
							preserveAspectRatio="xMidYMid slice"
							class="node-avatar"
							@error="failedAvatars.add(node.avatar)"
						/>
						<circle
							v-if="node.humanControlled"
							class="node-human"
							cx="11"
							cy="-11"
							r="4"
						/>
						<text
							v-if="zoom >= 0.55 || selectedId === node.id"
							class="node-label"
							y="31"
							text-anchor="middle"
						>
							{{ node.name }}
						</text>
						<title>{{ node.name }} / {{ t(node.state) }}</title>
					</g>
					<g
						v-for="heart in hearts"
						:key="heart.effect.id"
						:transform="`translate(${heart.node.x} ${heart.node.y}) scale(${1 / zoom})`"
						aria-hidden="true"
						class="node-like-effect"
					>
						<circle class="node-like-ring" :r="14 * zoom + 5" />
						<text
							:x="14 * zoom + 4"
							:y="-14 * zoom - 5"
							class="node-like-heart"
						>
							♥
						</text>
						<text
							:x="-14 * zoom - 18"
							y="-3"
							class="node-like-heart node-like-heart--second"
						>
							♥
						</text>
						<text
							x="0"
							:y="14 * zoom + 18"
							class="node-like-heart node-like-heart--third"
						>
							♥
						</text>
					</g>
					<g
						v-for="bubble in postBubbles"
						:key="bubble.event.id"
						:transform="`translate(${bubble.node.x} ${bubble.node.y}) scale(${1 / zoom})`"
					>
						<a
							class="node-post-bubble"
							:href="eventLink(bubble.event)"
							target="_blank"
							rel="noopener noreferrer"
							:aria-label="eventLabel(bubble.event)"
							@pointerdown.stop
							@click.stop
						>
							<path
								d="M-35,-48H35Q41,-48 41,-42V-27Q41,-21 35,-21H5L0,-15L-5,-21H-35Q-41,-21 -41,-27V-42Q-41,-48 -35,-48Z"
							/>
							<text y="-31" text-anchor="middle">{{ t('post') }}</text>
							<title>
								{{ bubble.event.title || eventLabel(bubble.event) }}
							</title>
						</a>
					</g>
				</g>
			</svg>
		</div>
		<div
			v-if="loading || (!response && failed) || (response && !nodes.length)"
			class="agent-graph-message"
			role="status"
		>
			<p>{{ loading ? t('loading') : failed ? t('failed') : t('empty') }}</p>
			<button v-if="failed" type="button" @click="retry">
				{{ t('retry') }}
			</button>
		</div>
		<aside v-if="selected" class="agent-graph-detail" @pointerdown.stop>
			<button
				type="button"
				class="agent-graph-close"
				:aria-label="t('close')"
				@click="selectedId = undefined"
			>
				×</button
			><strong>{{ selected.name }}</strong>
			<UButton
				:to="`${productOrigin}/users/${encodeURIComponent(selected.id)}`"
				target="_blank"
				rel="noopener noreferrer"
				icon="i-lucide-external-link"
				color="neutral"
				variant="outline"
				size="xs"
				class="mt-3"
				>{{ t('viewProfile') }}</UButton
			>
			<p>{{ selected.campus }} / {{ selected.className }}</p>
			<p>{{ selected.interests.join(' / ') }}</p>
			<div class="agent-graph-status" :class="`state-${selected.state}`">
				{{ t(selected.state)
				}}<span v-if="selected.humanControlled"> / {{ t('human') }}</span>
			</div>
			<dl>
				<dt>{{ t('current') }}</dt>
				<dd>
					{{
						selected.currentTask
							? action(selected.currentTask.action)
							: t('noTask')
					}}<small v-if="selected.currentTask">{{
						time(selected.currentTask.updatedAt)
					}}</small>
				</dd>
				<dt>{{ t('recent') }}</dt>
				<dd>
					{{
						selected.lastAction
							? `${action(selected.lastAction.action)} / ${action(selected.lastAction.status)}`
							: t('noTask')
					}}<small v-if="selected.lastAction">{{
						time(selected.lastAction.updatedAt)
					}}</small>
				</dd>
			</dl>
			<small>{{ t('humanHelp') }}</small>
		</aside>
		<aside
			class="agent-graph-events"
			:class="{ 'is-collapsed': !eventsExpanded }"
			@pointerdown.stop
		>
			<div class="agent-graph-events-heading">
				<strong>{{ t('liveEvents') }}</strong>
				<UButton
					:icon="
						eventsExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'
					"
					color="neutral"
					variant="ghost"
					size="xs"
					:aria-label="t(eventsExpanded ? 'collapseEvents' : 'expandEvents')"
					@click="eventsExpanded = !eventsExpanded"
				/>
			</div>
			<TransitionGroup
				v-if="eventsExpanded"
				name="graph-event"
				tag="div"
				class="agent-graph-event-list"
			>
				<component
					:is="event.kind === 'message' ? 'button' : 'a'"
					v-for="event in response?.events ?? []"
					:key="event.id"
					:type="event.kind === 'message' ? 'button' : undefined"
					:href="eventLink(event)"
					:target="event.kind !== 'message' ? '_blank' : undefined"
					:rel="event.kind !== 'message' ? 'noopener noreferrer' : undefined"
					class="agent-graph-event"
					@click="event.kind === 'message' && openEvent(event)"
				>
					<span>{{ eventLabel(event) }}</span
					><small>{{ time(event.occurredAt) }}</small>
					<p>{{ event.body || event.title }}</p>
				</component>
				<p
					v-if="!response?.events?.length"
					key="empty"
					class="agent-graph-events-empty"
				>
					{{ t('noEvents') }}
				</p>
			</TransitionGroup>
		</aside>
		<UModal
			v-model:open="eventModalOpen"
			:title="openedEvent ? eventLabel(openedEvent) : t('eventDetail')"
			:description="openedEvent ? time(openedEvent.occurredAt) : undefined"
		>
			<template #body
				><div v-if="openedEvent" class="agent-graph-event-content">
					<h3 v-if="openedEvent.title">{{ openedEvent.title }}</h3>
					<p>{{ openedEvent.body }}</p>
				</div></template
			>
		</UModal>
		<footer class="agent-graph-footer" @pointerdown.stop>
			<div class="agent-graph-legend">
				<button
					v-for="state in graphStates"
					type="button"
					:aria-label="t('filterState', { state: t(state) })"
					:aria-pressed="stateFilter === state"
					@click="toggleState(state)"
					:key="state"
					:class="`state-${state}`"
				>
					<i />{{ t(state) }}</button
				><span v-for="kind in kinds" :key="kind"
					><i class="edge-key" :class="`edge-${kind}`" />{{ t(kind) }}</span
				>
			</div>
			<p v-if="failed && response" class="agent-graph-error" role="status">
				{{ t('stale') }}
				<button type="button" @click="retry">{{ t('retry') }}</button>
			</p>
		</footer>
	</section>
</template>

<style scoped>
.agent-graph {
	position: relative;
	isolation: isolate;
	width: 100%;
	height: 100%;
	min-height: 0;
	overflow: hidden;
	background: var(--ui-bg);
	color: var(--ui-text);
	--graph-idle: #a1a1aa;
	--graph-running: #3b82f6;
	--graph-ready: #a78bfa;
	--graph-queued: #d99b3f;
	--graph-friend: #9a6b2f;
	--graph-follow: #3b78b5;
}
:global(.dark) .agent-graph {
	--graph-friend: #d8b47a;
	--graph-follow: #83b5e2;
}
.agent-graph-viewport {
	position: absolute;
	inset: 0;
	touch-action: none;
	cursor: grab;
	user-select: none;
	outline-offset: -3px;
	background-image: radial-gradient(
		color-mix(in srgb, var(--ui-text-muted) 15%, transparent) 1px,
		transparent 1px
	);
	background-size: 24px 24px;
}
.agent-graph-viewport.is-dragging {
	cursor: grabbing;
}
.agent-graph-viewport svg {
	display: block;
	overflow: visible;
}
.agent-graph-tools {
	position: absolute;
	z-index: 2;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	top: 18px;
	left: 24px;
	right: 24px;
	pointer-events: none;
}
.agent-graph-counts,
.agent-graph-observation {
	font-size: 12px;
	color: var(--ui-text-muted);
	white-space: nowrap;
}
.agent-graph-observation {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 32px;
	margin-left: auto;
	pointer-events: auto;
}
.agent-graph-controls {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	pointer-events: auto;
	width: fit-content;
}
.agent-graph button {
	font: inherit;
	font-size: 12px;
}
.agent-graph-controls > button {
	height: 32px;
	padding: 0 10px;
	border: 1px solid var(--ui-border);
	border-radius: 6px;
	background: var(--ui-bg);
	color: var(--ui-text);
}
.agent-graph button {
	cursor: pointer;
}
.agent-graph button:hover {
	color: var(--ui-primary);
}
.agent-graph-search {
	position: relative;
}
.agent-graph-query {
	width: 190px;
}
.agent-graph-query :deep(input) {
	height: 32px;
	font-size: 12px;
	outline: none;
}
.agent-graph-query :deep(input:focus-visible) {
	box-shadow: inset 0 0 0 2px var(--ui-primary);
}
.agent-graph-results {
	position: absolute;
	top: 38px;
	left: 0;
	width: 230px;
	background: var(--ui-bg);
	border: 1px solid var(--ui-border);
	border-radius: 6px;
	padding: 4px;
}
.agent-graph-results button {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	width: 100%;
	padding: 8px;
	text-align: left;
}
.agent-graph-results button:hover {
	background: var(--ui-bg-elevated);
}
.agent-graph-results span,
.agent-graph-results p {
	color: var(--ui-text-muted);
	font-size: 12px;
}
.agent-graph-results p {
	padding: 8px;
}
.agent-graph-edges path {
	stroke: #b3b9c2;
	stroke-width: 0.7;
	opacity: 0.32;
}
.agent-graph-edges .edge-friend {
	stroke: var(--graph-friend);
	stroke-width: 0.8;
	opacity: 0.16;
}
.agent-graph-edges .edge-follow {
	stroke: var(--graph-follow);
	stroke-width: 0.75;
	stroke-dasharray: 6 5;
	opacity: 0.13;
}
.agent-graph-edges .edge-message {
	stroke: #0d9488;
	stroke-width: 1.5;
	opacity: 0.4;
}
.agent-graph-edges .edge-comment {
	stroke: #8b5cf6;
	stroke-width: 1.5;
	opacity: 0.35;
}
.agent-graph-edges .edge-task {
	stroke: #3b82f6;
	stroke-width: 2;
	opacity: 0.85;
	stroke-dasharray: 5 4;
}
.agent-graph-edges path.is-focused {
	stroke-width: 2.8;
	opacity: 0.95;
}
.agent-graph-edges path.is-live {
	stroke-width: 3.4;
	stroke-dasharray: 9 6;
	animation: graph-interaction 1.2s linear infinite;
}
@keyframes graph-interaction {
	to {
		stroke-dashoffset: -30;
	}
}
.node-like-effect {
	pointer-events: none;
}
.node-like-ring {
	fill: rgb(239 68 68 / 0.12);
	stroke: #ef4444;
	stroke-width: 2.5px;
	animation: graph-like-ring 750ms ease-in-out infinite;
}
@keyframes graph-like-ring {
	0%,
	100% {
		stroke-opacity: 1;
		fill-opacity: 0.3;
	}
	50% {
		stroke-opacity: 0.3;
		fill-opacity: 1;
	}
}
.node-like-heart {
	fill: #ef4444;
	font-size: 18px;
	paint-order: stroke;
	stroke: var(--ui-bg);
	stroke-width: 2px;
	animation: graph-like-float 3s ease-out forwards;
}
.node-like-heart--second {
	animation-delay: 100ms;
}
.node-like-heart--third {
	animation-delay: 200ms;
}
@keyframes graph-like-float {
	0% {
		opacity: 0;
		transform: translateY(4px) scale(0.6);
	}
	12% {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
	80% {
		opacity: 1;
	}
	100% {
		opacity: 0;
		transform: translateY(-30px) scale(1.1);
	}
}
.node-post-bubble {
	cursor: pointer;
	animation: graph-post-arrive 240ms ease-out;
}
.node-post-bubble path {
	fill: var(--ui-bg);
	stroke: var(--ui-primary);
	stroke-width: 1.5;
	filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.12));
}
.node-post-bubble text {
	fill: var(--ui-primary);
	font-size: 12px;
	font-weight: 600;
}
.node-post-bubble:hover path,
.node-post-bubble:focus-visible path {
	fill: var(--ui-bg-elevated);
	stroke-width: 2.5;
}
@keyframes graph-post-arrive {
	from {
		opacity: 0;
		transform: translateY(6px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}
.agent-graph-edges path.is-dim {
	opacity: 0.045;
}
.agent-graph-node {
	--node: var(--graph-idle);
	cursor: pointer;
	outline: none;
}
.state-running {
	--node: var(--graph-running);
}
.state-ready {
	--node: var(--graph-ready);
}
.state-queued {
	--node: var(--graph-queued);
}
.state-idle {
	--node: var(--graph-idle);
}
.node-body {
	fill: var(--ui-bg);
	stroke: var(--node);
	stroke-width: 2;
}
.node-halo {
	fill: var(--node);
	opacity: 0;
}
.agent-graph-node:hover .node-halo,
.agent-graph-node:focus-visible .node-halo,
.agent-graph-node.is-selected .node-halo {
	opacity: 0.17;
}
.state-running .node-halo {
	animation: agent-running 2s ease-in-out infinite;
}
.agent-graph-node.is-dim {
	opacity: 0.2;
}
.node-avatar {
	pointer-events: none;
}
.node-initial {
	fill: var(--ui-text);
	font-size: 11px;
	pointer-events: none;
}
.node-label {
	fill: var(--ui-text-muted);
	font-size: 11px;
	paint-order: stroke;
	stroke: var(--ui-bg);
	stroke-width: 3px;
	stroke-linejoin: round;
	pointer-events: none;
}
.is-selected .node-label {
	fill: var(--ui-primary);
	font-weight: 600;
}
.node-human {
	fill: #22a06b;
	stroke: var(--ui-bg);
	stroke-width: 2;
}
.agent-graph-message {
	position: absolute;
	inset: 45% 16px auto;
	text-align: center;
	pointer-events: none;
	color: var(--ui-text-muted);
	font-size: 13px;
}
.agent-graph-message button {
	pointer-events: auto;
	color: var(--ui-primary);
	margin-top: 10px;
}
.agent-graph-detail {
	position: absolute;
	z-index: 3;
	right: 20px;
	top: 105px;
	width: 260px;
	padding: 18px;
	background: color-mix(in srgb, var(--ui-bg) 96%, transparent);
	border: 1px solid var(--ui-border);
	border-radius: 8px;
	font-size: 12px;
	max-height: calc(100% - 405px);
	overflow: auto;
}
.agent-graph-detail strong {
	display: block;
	padding-right: 22px;
	font-size: 15px;
}
.agent-graph-detail p {
	margin: 7px 0;
	color: var(--ui-text-muted);
	overflow-wrap: anywhere;
}
.agent-graph-close {
	position: absolute;
	right: 12px;
	top: 9px;
	font-size: 23px !important;
	color: var(--ui-text-muted);
}
.agent-graph-status {
	margin: 12px 0;
	color: var(--node);
}
.agent-graph-detail dl {
	margin: 12px 0;
}
.agent-graph-detail dt {
	color: var(--ui-text-muted);
	margin-top: 10px;
}
.agent-graph-detail dd {
	margin: 4px 0;
	display: flex;
	justify-content: space-between;
	gap: 10px;
}
.agent-graph-detail small {
	font-size: 11px;
	color: var(--ui-text-muted);
}
.agent-graph-footer {
	position: absolute;
	z-index: 2;
	left: 24px;
	bottom: 16px;
	right: 24px;
	pointer-events: none;
	font-size: 11px;
	color: var(--ui-text-muted);
}
.agent-graph-legend {
	display: flex;
	gap: 9px 14px;
	flex-wrap: wrap;
	margin-bottom: 8px;
}
.agent-graph-legend span,
.agent-graph-legend button {
	display: flex;
	align-items: center;
	gap: 5px;
}
.agent-graph-legend i {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--node);
}
.agent-graph-legend i.edge-key {
	width: 16px;
	height: 2px;
	border-radius: 0;
	background: #b3b9c2;
}
.agent-graph-legend i.edge-friend,
.agent-graph-legend i.edge-follow {
	width: 22px;
	height: 0;
	background: none;
}
.agent-graph-legend i.edge-friend {
	border-top: 2px solid var(--graph-friend);
}
.agent-graph-legend i.edge-follow {
	border-top: 2px dashed var(--graph-follow);
}
.agent-graph-legend i.edge-message {
	background: #55a49a;
}
.agent-graph-legend i.edge-comment {
	background: #a78bfa;
}
.agent-graph-legend i.edge-task {
	background: #3b82f6;
}
.agent-graph-footer p {
	margin: 4px 0;
}
.agent-graph-error {
	color: var(--ui-error);
}
.agent-graph-error button {
	pointer-events: auto;
	text-decoration: underline;
}
@keyframes agent-running {
	0%,
	100% {
		opacity: 0.05;
	}
	50% {
		opacity: 0.23;
	}
}
@media (prefers-reduced-motion: reduce) {
	.state-running .node-halo {
		animation: none;
		opacity: 0.14;
	}
}
@media (max-width: 700px) {
	.agent-graph-tools {
		left: 16px;
		right: 16px;
		top: 14px;
	}
	.agent-graph-controls {
		gap: 8px;
	}
	.agent-graph-query {
		width: 175px;
	}
	.agent-graph-detail {
		width: 220px;
		top: 130px;
		right: 12px;
		max-height: calc(100% - 420px);
		padding: 12px;
	}
	.agent-graph-footer {
		left: 16px;
		right: 16px;
		bottom: 10px;
	}
}

.agent-graph-legend button {
	pointer-events: auto;
	padding: 5px 7px;
	margin: -5px -7px;
	border: 1px solid transparent;
	border-radius: 6px;
	color: var(--ui-text-muted);
	background: var(--ui-bg);
}
.agent-graph-legend button:hover,
.agent-graph-legend button[aria-pressed='true'] {
	border-color: var(--node);
	color: var(--ui-text);
	background: var(--ui-bg-elevated);
}
.agent-graph-events {
	position: absolute;
	z-index: 3;
	right: 20px;
	bottom: 60px;
	width: min(310px, calc(100% - 32px));
	border: 1px solid var(--ui-border);
	border-radius: 12px;
	background: color-mix(in srgb, var(--ui-bg) 96%, transparent);
	font-size: 12px;
	overflow: hidden;
}
.agent-graph-events-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 7px 12px;
}
.agent-graph-event-list {
	max-height: 190px;
	overflow: auto;
	scrollbar-width: none;
}
.agent-graph-event {
	color: inherit;
	font: inherit;
	text-decoration: none;
	cursor: pointer;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 5px 8px;
	padding: 10px 12px;
	width: 100%;
	text-align: left;
	border-top: 1px solid var(--ui-border);
}
.agent-graph-event:hover {
	background: var(--ui-bg-elevated);
}
.agent-graph-event > span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.agent-graph-event small {
	color: var(--ui-text-muted);
}
.agent-graph-event p {
	grid-column: 1 / -1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--ui-text-muted);
}
.agent-graph-events-empty {
	padding: 12px;
	color: var(--ui-text-muted);
}
.agent-graph-event-content {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	line-height: 1.8;
}
.agent-graph-event-content h3 {
	font-weight: 600;
	margin-bottom: 12px;
}
.graph-event-enter-active {
	transition:
		opacity 0.2s,
		transform 0.2s;
}
.graph-event-enter-from {
	opacity: 0;
	transform: translateY(8px);
}
@media (max-width: 700px) {
	.agent-graph-events {
		right: 16px;
		bottom: 80px;
	}
}
@media (prefers-reduced-motion: reduce) {
	.graph-event-enter-active {
		transition: none;
	}
	.agent-graph-edges path.is-live,
	.node-like-ring,
	.node-like-heart,
	.node-post-bubble {
		animation: none;
	}
}
</style>
