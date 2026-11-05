<script setup lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>()
const emit = defineEmits<{ measured: [] }>()
const container = ref<HTMLElement>()
let observer: ResizeObserver | undefined
let measurementFrame: number | undefined
function measure() {
	if (!container.value) return
	const gap =
		Number.parseFloat(getComputedStyle(container.value).columnGap) || 16
	const measured = Array.from(container.value.children).flatMap((child) => {
		const element = child as HTMLElement,
			inner = element.firstElementChild as HTMLElement | null
		return inner
			? [
					{
						element,
						span: `span ${Math.ceil(inner.getBoundingClientRect().height + gap)}`,
					},
				]
			: []
	})
	container.value.classList.add('is-measured')
	for (const { element, span } of measured)
		if (element.style.gridRowEnd !== span) element.style.gridRowEnd = span
	if (measurementFrame !== undefined) cancelAnimationFrame(measurementFrame)
	measurementFrame = requestAnimationFrame(() => {
		measurementFrame = undefined
		emit('measured')
	})
}

function observe() {
	if (!container.value || !observer) return
	observer.disconnect()
	observer.observe(container.value)
	for (const child of Array.from(container.value.children))
		if (child.firstElementChild) observer.observe(child.firstElementChild)
	measure()
}
onMounted(() => {
	observer = new ResizeObserver(measure)
	observe()
})
watch(
	() => props.items.map((i) => i.id).join(','),
	async () => {
		await nextTick()
		observe()
	},
)
onBeforeUnmount(() => {
	observer?.disconnect()
	if (measurementFrame !== undefined) cancelAnimationFrame(measurementFrame)
})
</script>
<template>
	<div ref="container" class="masonry-feed">
		<div
			v-for="(item, index) in items"
			:key="item.id"
			class="masonry-item"
			:style="{ '--card-delay': `${Math.min(index % 18, 5) * 25}ms` }"
		>
			<slot :item="item" :index="index" />
		</div>
	</div>
</template>
