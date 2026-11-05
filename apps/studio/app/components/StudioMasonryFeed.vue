<script setup lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>()
const emit = defineEmits<{ measured: [] }>()
const container = ref<HTMLElement>()
let observer: ResizeObserver | undefined
let frame: number | undefined
let disposed = false

function schedule() {
	if (frame !== undefined) return
	frame = requestAnimationFrame(() => {
		frame = undefined
		if (!container.value || disposed) return
		const gap =
			Number.parseFloat(getComputedStyle(container.value).columnGap) || 16
		const measurements = Array.from(container.value.children).flatMap(
			(child) => {
				const element = child as HTMLElement
				const card = element.firstElementChild as HTMLElement | null
				return card
					? [
							{
								element,
								span: Math.ceil(card.getBoundingClientRect().height + gap),
							},
						]
					: []
			},
		)
		container.value.classList.add('is-measured')
		for (const { element, span } of measurements) {
			const value = `span ${span}`
			if (element.style.gridRowEnd !== value) element.style.gridRowEnd = value
		}
		emit('measured')
	})
}
function observe() {
	observer?.disconnect()
	if (!container.value) return
	observer?.observe(container.value)
	for (const child of Array.from(container.value.children))
		if (child.firstElementChild) observer?.observe(child.firstElementChild)
	schedule()
}
onMounted(() => {
	observer = new ResizeObserver(schedule)
	observe()
	void document.fonts.ready.then(() => {
		if (!disposed) schedule()
	})
})
watch(
	() => props.items.map((item) => item.id).join(','),
	async () => {
		await nextTick()
		observe()
	},
)
onBeforeUnmount(() => {
	disposed = true
	observer?.disconnect()
	if (frame !== undefined) cancelAnimationFrame(frame)
})
</script>
<template>
	<div ref="container" class="studio-masonry-feed">
		<div
			v-for="(item, index) in items"
			:key="item.id"
			class="studio-masonry-item"
		>
			<slot :item="item" :index="index" />
		</div>
	</div>
</template>
