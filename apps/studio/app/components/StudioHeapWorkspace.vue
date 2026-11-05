<script setup lang="ts">
import type {
	HeapFrame,
	RecommendationTraceEvent,
} from '@campus/recommendation'
interface TreeNode extends HeapFrame {
	index: number
	x: number
	y: number
}
interface TreeEdge {
	node: TreeNode
	parent: TreeNode
}
interface Point {
	x: number
	y: number
}
interface DragState {
	kind: 'tree' | 'trace' | 'resize'
	pointer: number
	start: Point
	origin: Point
	moved: boolean
}
const props = defineProps<{
	heap: HeapFrame[]
	nodes: TreeNode[]
	edges: TreeEdge[]
	activeIndices: Set<number>
	trace: RecommendationTraceEvent[]
	frame: number
	capacity: number
	treeWidth: number
	treeHeight: number
	titleFor: (id: string | undefined) => string
	current?: RecommendationTraceEvent
}>()
const emit = defineEmits<{
	select: [id: string]
	seek: [frame: number | undefined]
}>()
const { t } = useI18n()
const workArea = ref<HTMLElement>(),
	viewport = ref<HTMLElement>(),
	tracePanel = ref<HTMLElement>()
const docked = ref(false)
const zoom = ref(1),
	dockWidth = ref(320)
const pan = reactive<Point>({ x: 0, y: 0 }),
	floating = reactive<Point>({ x: 24, y: 112 })
let drag: DragState | undefined
let suppressSelection = false
let resizeObserver: ResizeObserver | undefined
const dragging = ref(false)
const number = (value: number | undefined) => (value ?? 0).toFixed(4)
function clampFloating(point: Point): Point {
	const box = workArea.value
	if (!box) return point
	const width = Math.min(360, Math.max(0, box.clientWidth - 24))
	const height =
		tracePanel.value?.offsetHeight ?? Math.min(360, box.clientHeight - 24)
	return {
		x: Math.max(0, Math.min(point.x, box.clientWidth - width)),
		y: Math.max(
			0,
			Math.min(point.y, box.clientHeight - Math.min(height, box.clientHeight)),
		),
	}
}
function begin(event: PointerEvent, kind: DragState['kind']) {
	if (
		event.button !== 0 ||
		(event.target instanceof Element &&
			event.target.closest('button, input, select'))
	)
		return
	const target = event.currentTarget as HTMLElement
	let origin = { ...pan }
	if (kind === 'trace') {
		const area = workArea.value?.getBoundingClientRect(),
			panel = tracePanel.value?.getBoundingClientRect()
		origin =
			area && panel
				? { x: panel.left - area.left, y: panel.top - area.top }
				: { ...floating }
	}
	drag = {
		kind,
		pointer: event.pointerId,
		start: { x: event.clientX, y: event.clientY },
		origin: kind === 'resize' ? { x: dockWidth.value, y: 0 } : origin,
		moved: false,
	}
	suppressSelection = false
	if (kind !== 'tree') target.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
	if (!drag || event.pointerId !== drag.pointer) return
	const dx = event.clientX - drag.start.x,
		dy = event.clientY - drag.start.y
	if (!drag.moved && Math.hypot(dx, dy) < 4) return
	const target = event.currentTarget as HTMLElement
	if (!target.hasPointerCapture(event.pointerId))
		target.setPointerCapture(event.pointerId)
	drag.moved = true
	dragging.value = true
	suppressSelection = true
	const point = { x: drag.origin.x + dx, y: drag.origin.y + dy }
	if (drag.kind === 'resize') {
		dockWidth.value = clampDockWidth(drag.origin.x - dx)
	} else if (drag.kind === 'trace') {
		docked.value = false
		Object.assign(floating, clampFloating(point))
	} else {
		const width = viewport.value?.clientWidth ?? 0,
			height = viewport.value?.clientHeight ?? 0
		pan.x = Math.max(
			-(props.treeWidth * zoom.value + width) / 2 + 60,
			Math.min(point.x, (props.treeWidth * zoom.value + width) / 2 - 60),
		)
		pan.y = Math.max(
			-(props.treeHeight * zoom.value + height) / 2 + 60,
			Math.min(point.y, (props.treeHeight * zoom.value + height) / 2 - 60),
		)
	}
}
function end(event: PointerEvent) {
	if (event.pointerId !== drag?.pointer) return
	drag = undefined
	dragging.value = false
	const target = event.currentTarget as HTMLElement
	if (target.hasPointerCapture(event.pointerId))
		target.releasePointerCapture(event.pointerId)
}
function selectNode(id: string) {
	if (!suppressSelection) emit('select', id)
}
function resetPan() {
	zoom.value = 1
	pan.x = 0
	pan.y = 0
}

function clampDockWidth(value: number) {
	return Math.max(
		240,
		Math.min(value, Math.min(620, (workArea.value?.clientWidth ?? 860) - 240)),
	)
}
function resizeWithKeys(event: KeyboardEvent) {
	if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
	event.preventDefault()
	dockWidth.value = clampDockWidth(
		dockWidth.value + (event.key === 'ArrowLeft' ? 16 : -16),
	)
}
function zoomTree(event: WheelEvent) {
	if (!viewport.value || !props.nodes.length) return
	const box = viewport.value.getBoundingClientRect()
	const delta =
		event.deltaY *
		(event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1)
	const next = Math.max(
		0.25,
		Math.min(2.5, zoom.value * Math.exp(-delta * 0.0015)),
	)
	const ratio = next / zoom.value
	const x = event.clientX - box.left - box.width / 2,
		y = event.clientY - box.top - box.height / 2
	pan.x = x - (x - pan.x) * ratio
	pan.y = y - (y - pan.y) * ratio
	zoom.value = next
}
function panWithKeys(event: KeyboardEvent) {
	const offsets: Record<string, Point> = {
		ArrowLeft: { x: -32, y: 0 },
		ArrowRight: { x: 32, y: 0 },
		ArrowUp: { x: 0, y: -32 },
		ArrowDown: { x: 0, y: 32 },
	}
	const point = offsets[event.key]
	if (point) {
		event.preventDefault()
		pan.x += point.x
		pan.y += point.y
	} else if (event.key === 'Home') {
		event.preventDefault()
		resetPan()
	}
}
function toggleDock() {
	docked.value = !docked.value
	Object.assign(floating, clampFloating(floating))
}
onMounted(() => {
	resizeObserver = new ResizeObserver(() => {
		Object.assign(floating, clampFloating(floating))
		dockWidth.value = clampDockWidth(dockWidth.value)
	})
	if (workArea.value) {
		const candidate = workArea.value
			.querySelector('.heap-current-candidate')
			?.getBoundingClientRect()
		const area = workArea.value.getBoundingClientRect()
		floating.y = candidate ? candidate.bottom - area.top + 12 : 112
		floating.x = window.innerWidth <= 800 ? 16 : 24
		Object.assign(floating, clampFloating(floating))
		resizeObserver.observe(workArea.value)
	}
})
onBeforeUnmount(() => {
	resizeObserver?.disconnect()
	drag = undefined
})
</script>
<template>
	<div class="heap-workspace">
		<div
			ref="workArea"
			class="heap-work-area"
			:class="{ 'has-docked-trace': docked }"
		>
			<div class="heap-canvas">
				<div class="heap-summary"><slot name="summary" /></div>
				<div class="heap-canvas-toolbar">
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						icon="i-lucide-locate-fixed"
						:aria-label="t('resetTreeView')"
						@click="resetPan"
					/>
					<span class="heap-zoom-value">{{ Math.round(zoom * 100) }}%</span
					><span>{{ t('capacity') }} {{ heap.length }} / {{ capacity }}</span>
				</div>
				<div v-if="current?.id" class="heap-current-candidate">
					<span>{{ t('incoming') }}</span
					><strong>{{ titleFor(current.id) }}</strong
					><code v-if="current.item">{{ number(current.item.score) }}</code>
				</div>
				<div
					ref="viewport"
					class="heap-drag-viewport"
					:class="{ 'is-dragging': dragging }"
					tabindex="0"
					role="group"
					:aria-label="t('heap')"
					@pointerdown="begin($event, 'tree')"
					@pointermove="move"
					@pointerup="end"
					@pointercancel="end"
					@keydown="panWithKeys"
					@wheel.prevent="zoomTree"
				>
					<svg
						v-if="nodes.length"
						:viewBox="`0 0 ${treeWidth} ${treeHeight}`"
						:style="{
							width: `${treeWidth}px`,
							height: `${treeHeight}px`,
							transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
						}"
						role="img"
						:aria-label="t('heap')"
					>
						<line
							v-for="edge in edges"
							:key="edge.node.id"
							:x1="edge.parent.x"
							:y1="edge.parent.y"
							:x2="edge.node.x"
							:y2="edge.node.y"
						/>
						<g
							v-for="node in nodes"
							:key="node.id"
							:class="{
								highlighted: activeIndices.has(node.index),
								root: node.index === 0,
							}"
							tabindex="0"
							role="button"
							:aria-label="`${titleFor(node.id)} ${number(node.score)}`"
							@click="selectNode(node.id)"
							@keydown.enter.stop="emit('select', node.id)"
							@keydown.space.prevent.stop="emit('select', node.id)"
						>
							<circle :cx="node.x" :cy="node.y" r="25" />
							<text :x="node.x" :y="node.y + 4" text-anchor="middle">
								{{ node.score.toFixed(3) }}
							</text>
							<text
								:x="node.x"
								:y="node.y + 44"
								text-anchor="middle"
								class="node-label"
							>
								{{ node.id }}
							</text>
							<title>{{ titleFor(node.id) }}</title>
						</g>
					</svg>
					<p v-else class="stage-empty">
						{{ t(capacity === 0 ? 'noResults' : 'heapEmpty') }}
					</p>
				</div>
			</div>
			<aside
				ref="tracePanel"
				class="heap-trace-window"
				:class="{ 'is-floating': !docked }"
				:style="
					!docked
						? { left: `${floating.x}px`, top: `${floating.y}px` }
						: { width: `${dockWidth}px` }
				"
				:aria-label="t('traceTitle')"
			>
				<div
					v-if="docked"
					class="heap-trace-resizer"
					role="separator"
					tabindex="0"
					aria-orientation="vertical"
					:aria-label="t('resizeTrace')"
					:aria-valuenow="dockWidth"
					:aria-valuemin="240"
					:aria-valuemax="620"
					@pointerdown="begin($event, 'resize')"
					@pointermove="move"
					@pointerup="end"
					@pointercancel="end"
					@keydown="resizeWithKeys"
				/>
				<div
					class="heap-trace-header"
					@pointerdown="begin($event, 'trace')"
					@pointermove="move"
					@pointerup="end"
					@pointercancel="end"
				>
					<span
						><UIcon name="i-lucide-grip-vertical" />{{ t('traceTitle') }}</span
					>
					<div>
						<UButton
							size="xs"
							variant="ghost"
							color="neutral"
							:icon="
								docked
									? 'i-lucide-panels-top-left'
									: 'i-lucide-panel-right-close'
							"
							:aria-label="t(docked ? 'floatTrace' : 'dockTrace')"
							@click="toggleDock"
						/>
					</div>
				</div>
				<div class="heap-trace-scroll">
					<table>
						<thead>
							<tr>
								<th>{{ t('step') }}</th>
								<th>{{ t('tableAction') }}</th>
								<th>{{ t('tableItem') }}</th>
								<th>{{ t('tableHeap') }}</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="(entry, index) in trace"
								:key="entry.sequence"
								:class="{ active: index === frame }"
								@click="emit('seek', index)"
							>
								<td>
									<button
										type="button"
										:aria-current="index === frame ? 'step' : undefined"
										@click.stop="emit('seek', index)"
									>
										{{ index + 1 }}
									</button>
								</td>
								<td>{{ t(entry.action) }}</td>
								<td>{{ titleFor(entry.id) }}</td>
								<td>
									{{
										entry.heap
											?.map((item) => `${item.id}: ${number(item.score)}`)
											.join(' / ')
									}}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</aside>
		</div>
		<div class="heap-workspace-footer">
			<div class="heap-footer-list-shell" :class="{ 'has-items': heap.length }">
				<div class="heap-footer-list">
					<span v-for="(item, index) in heap" :key="item.id"
						><b>{{ index }}</b
						><span>{{ titleFor(item.id) }}</span
						><code>{{ number(item.score) }}</code></span
					>
				</div>
			</div>
			<slot name="controls" /><USlider
				class="heap-timeline"
				:model-value="frame"
				:min="0"
				:max="Math.max(1, trace.length - 1)"
				:disabled="trace.length < 2"
				:aria-label="t('step')"
				:ui="{ track: 'rounded-none', range: 'rounded-none', thumb: 'size-4' }"
				@update:model-value="emit('seek', $event)"
			/>
		</div>
	</div>
</template>
<style scoped>
.heap-workspace {
	height: 100%;
	min-height: 0;
	display: flex;
	flex-direction: column;
}
.heap-work-area {
	position: relative;
	display: flex;
	flex: 1;
	min-height: 0;
	overflow: hidden;
}
.heap-canvas {
	display: flex;
	flex: 1;
	min-width: 0;
	min-height: 0;
	flex-direction: column;
}
.heap-canvas-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 0 24px 12px;
	flex-shrink: 0;
}
.heap-canvas-toolbar > div {
	display: flex;
	gap: 4px;
}
.heap-canvas-toolbar > span {
	color: var(--studio-muted);
	font-size: 11px;
	white-space: nowrap;
}
.heap-current-candidate {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 24px;
	font-size: 12px;
}
.heap-current-candidate > span {
	color: var(--studio-muted);
	font-size: 10px;
	flex-shrink: 0;
}
.heap-current-candidate strong {
	font-weight: 400;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.heap-current-candidate code {
	margin-left: auto;
	flex-shrink: 0;
}
.heap-drag-viewport {
	position: relative;
	flex: 1;
	min-height: 0;
	overflow: hidden;
	cursor: grab;
	touch-action: none;
	user-select: none;
}
.heap-drag-viewport.is-dragging {
	cursor: grabbing;
}
.heap-drag-viewport svg {
	position: absolute;
	left: 50%;
	top: 50%;
	max-width: none;
}
.heap-drag-viewport line {
	stroke: var(--studio-line);
	stroke-width: 1.5;
}
.heap-drag-viewport circle {
	fill: var(--studio-soft);
	stroke: var(--studio-line);
	stroke-width: 1.5;
}
.heap-drag-viewport text {
	fill: var(--studio-text);
	font-size: 10px;
	font-variant-numeric: tabular-nums;
}
.heap-drag-viewport .node-label {
	fill: var(--studio-muted);
}
.heap-drag-viewport .root circle {
	stroke: var(--studio-accent);
	stroke-width: 2;
}
.heap-drag-viewport .highlighted circle {
	fill: var(--studio-accent);
	stroke: var(--studio-accent);
}
.heap-drag-viewport .highlighted text:not(.node-label) {
	fill: var(--canvas);
}
.heap-trace-window {
	display: flex;
	flex-direction: column;
	width: min(420px, 40%);
	min-width: 0;
	border-left: 1px solid var(--line);
	background: var(--canvas);
	flex-shrink: 0;
	z-index: 2;
}
.heap-trace-window.is-floating {
	position: absolute;
	width: min(360px, calc(100% - 24px));
	height: min(360px, calc(100% - 24px));
	border: 1px solid var(--line);
	border-radius: 12px;
	box-shadow: 0 8px 30px #00000012;
	overflow: hidden;
}
.heap-trace-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--line);
	cursor: grab;
	touch-action: none;
	user-select: none;
}
.heap-trace-header > span,
.heap-trace-header > div {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	white-space: nowrap;
}
.heap-trace-scroll {
	flex: 1;
	min-height: 0;
	overflow: auto;
	overscroll-behavior: contain;
	scrollbar-width: thin;
}
.heap-trace-scroll table {
	width: 100%;
	border-collapse: collapse;
	text-align: left;
	font-size: 11px;
}
.heap-trace-scroll th {
	position: sticky;
	top: 0;
	background: var(--canvas);
	z-index: 1;
	font-weight: 400;
	color: var(--muted);
}
.heap-trace-scroll td,
.heap-trace-scroll th {
	padding: 10px;
	border-bottom: 1px solid var(--line);
	min-width: 48px;
}
.heap-trace-scroll td:nth-child(3) {
	min-width: 150px;
}
.heap-trace-scroll td:nth-child(4) {
	min-width: 170px;
}
.heap-trace-scroll tr.active {
	background: var(--surface-raised);
}
.heap-trace-scroll td button {
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	padding: 0;
}
.heap-workspace-footer {
	flex-shrink: 0;
	border-top: 1px solid var(--line);
	background: var(--canvas);
	padding-top: 12px;
}
.heap-footer-list {
	display: flex;
	gap: 24px;
	padding: 0 24px;
	max-height: 64px;
	overflow: auto;
	scrollbar-width: thin;
}
.heap-footer-list > span {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 200px;
	flex: 1;
	font-size: 10px;
}
.heap-footer-list > span > span {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
.heap-footer-list b {
	font-weight: 400;
	color: var(--muted);
}
.heap-footer-list code {
	margin-left: auto;
	color: var(--muted);
}
.heap-timeline {
	overflow: hidden;
	width: 100%;
	margin-top: 8px;
}
:deep(.playback-controls) {
	margin: 12px 24px;
}
@media (max-width: 800px) {
	.heap-canvas-toolbar {
		padding-inline: 16px;
	}
	.heap-current-candidate {
		padding-inline: 16px;
	}
	.heap-trace-window:not(.is-floating) {
		position: absolute;
		right: 12px;
		top: 44px;
		bottom: 12px;
		width: calc(100% - 24px);
		max-width: 420px;
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
	}
	:deep(.playback-controls) {
		margin: 10px 16px;
		gap: 8px;
	}
}

.heap-canvas {
	position: relative;
}
.heap-summary {
	position: absolute;
	inset: 0 0 auto;
	z-index: 1;
	pointer-events: none;
	padding-right: 170px;
}
.heap-canvas-toolbar {
	position: absolute;
	top: 12px;
	right: 0;
	z-index: 2;
	padding-bottom: 0;
	gap: 8px;
}
.heap-current-candidate {
	position: absolute;
	top: 64px;
	left: 0;
	right: 0;
	z-index: 1;
	pointer-events: none;
}
.heap-drag-viewport {
	position: absolute;
	inset: 0;
}
.heap-summary :deep(.run-metrics) {
	margin-bottom: 0;
}
.heap-trace-window:not(.is-floating) {
	position: relative;
}
@media (max-width: 800px) {
	.heap-summary {
		padding-right: 0;
	}
	.heap-canvas-toolbar {
		top: 52px;
	}
	.heap-current-candidate {
		top: 88px;
	}
	.heap-trace-window:not(.is-floating) {
		position: absolute;
	}
}

.heap-footer-list-shell {
	display: grid;
	grid-template-rows: 0fr;
	transition: grid-template-rows 220ms ease;
}
.heap-footer-list-shell.has-items {
	grid-template-rows: 1fr;
}
.heap-footer-list {
	min-height: 0;
	scrollbar-width: none;
	overflow-y: hidden;
	max-height: none;
}
.heap-footer-list::-webkit-scrollbar {
	display: none;
}
.heap-timeline {
	min-height: 30px;
	padding-block: 10px;
	margin-top: 0;
}
.heap-timeline :deep([data-slot='thumb']) {
	width: 18px;
	height: 18px;
	background: var(--canvas);
	box-shadow: 0 0 0 3px var(--accent);
}
.heap-drag-viewport .stage-empty {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	margin: 0;
	pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
	.heap-footer-list-shell {
		transition: none;
	}
}

.heap-trace-resizer {
	position: absolute;
	inset: 0 auto 0 -4px;
	width: 8px;
	cursor: col-resize;
	touch-action: none;
	z-index: 3;
}
.heap-trace-resizer::after {
	content: '';
	position: absolute;
	inset: 0 3px;
	background: transparent;
	transition: background-color 150ms;
}
.heap-trace-resizer:hover::after,
.heap-trace-resizer:focus-visible::after {
	background: var(--accent);
}
.heap-zoom-value {
	color: var(--muted);
	font-size: 10px;
}
.heap-summary {
	padding-right: 210px;
}
@media (max-width: 800px) {
	.heap-summary {
		padding-right: 0;
	}
}
</style>
