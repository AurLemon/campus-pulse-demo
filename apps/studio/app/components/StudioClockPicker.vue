<script setup lang="ts">
import { CalendarDate, parseDate, Time } from '@internationalized/date'
import { formatStudioClock, parseStudioClock } from '../utils/studio-time'

interface ClockTime {
	hour: number
	minute: number
}
const props = defineProps<{ current: string }>()
const model = defineModel<string>({ required: true })
const live = defineModel<boolean>('live', { required: true })
const { t } = useI18n()
const open = ref(false)
const narrow = ref(false)
let viewportQuery: MediaQueryList | undefined
function updatePlacement() {
	narrow.value = viewportQuery?.matches ?? false
}
onMounted(() => {
	viewportQuery = matchMedia('(max-width: 600px)')
	updatePlacement()
	viewportQuery.addEventListener('change', updatePlacement)
})
onBeforeUnmount(() =>
	viewportQuery?.removeEventListener('change', updatePlacement),
)
const local = computed(() =>
	formatStudioClock(live.value ? props.current : model.value),
)
const date = computed(() => parseDate(local.value.slice(0, 10)))
const time = computed(
	() =>
		new Time(
			Number(local.value.slice(11, 13)),
			Number(local.value.slice(14, 16)),
		),
)
function fixClock(value: string) {
	const parsed = parseStudioClock(value)
	if (!parsed) return
	live.value = false
	model.value = parsed
}
function selectDate(value: unknown) {
	if (value instanceof CalendarDate)
		fixClock(`${value.toString().slice(0, 10)}T${local.value.slice(11)}`)
}
function isClockTime(value: unknown): value is ClockTime {
	return Boolean(
		value &&
		typeof value === 'object' &&
		'hour' in value &&
		'minute' in value &&
		typeof value.hour === 'number' &&
		typeof value.minute === 'number',
	)
}
function selectTime(value: unknown) {
	if (isClockTime(value))
		fixClock(
			`${local.value.slice(0, 10)}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`,
		)
}
function syncClock() {
	live.value = true
	open.value = false
}
</script>

<template>
	<UPopover
		v-model:open="open"
		:content="{
			side: narrow ? 'bottom' : 'right',
			align: 'start',
			sideOffset: 8,
			collisionPadding: 12,
			avoidCollisions: true,
			sticky: 'always',
		}"
		:ui="{
			content:
				'max-h-[min(calc(100dvh-24px),var(--reka-popover-content-available-height))] overflow-y-auto',
		}"
	>
		<UButton
			type="button"
			color="neutral"
			variant="outline"
			trailing-icon="i-lucide-calendar-days"
			class="studio-clock-trigger"
			:aria-label="t('clock')"
		>
			<span>{{ local.replace('T', ' ') }}</span>
			<span v-if="live" class="studio-clock-live-dot" aria-hidden="true" />
		</UButton>
		<template #content>
			<div class="studio-clock-popover">
				<UCalendar
					:model-value="date"
					size="sm"
					locale="zh-CN"
					@update:model-value="selectDate"
				/>
				<div class="studio-clock-footer">
					<UFormField :label="t('clockTime')">
						<UInputTime
							:model-value="time"
							:hour-cycle="24"
							granularity="minute"
							:aria-label="t('clockTime')"
							@update:model-value="selectTime"
						/>
					</UFormField>
					<UButton
						type="button"
						icon="i-lucide-refresh-cw"
						:variant="live ? 'soft' : 'ghost'"
						:aria-pressed="live"
						@click="syncClock"
						>{{ t('liveClock') }}</UButton
					>
				</div>
			</div>
		</template>
	</UPopover>
</template>

<style scoped>
.studio-clock-trigger {
	width: 100%;
	min-width: 0;
	min-height: 34px;
	font-weight: 400;
	justify-content: space-between;
}
.studio-clock-trigger > span:first-child {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.studio-clock-live-dot {
	width: 6px;
	height: 6px;
	flex-shrink: 0;
	border-radius: 50%;
	background: var(--accent);
	margin-left: auto;
}
.studio-clock-popover {
	padding: 12px;
	max-width: calc(100vw - 24px);
}
.studio-clock-footer {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 16px;
	border-top: 1px solid var(--line);
	margin-top: 12px;
	padding-top: 12px;
}
</style>
