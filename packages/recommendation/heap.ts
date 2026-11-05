import type { HeapMutation } from './trace.ts'

/** compare(a, b) > 0 means a is preferred to b. The root is the worst retained item. */
export class MinHeap<T> {
	private readonly values: T[] = []
	private readonly compare: (a: T, b: T) => number
	private readonly onMutation?: (event: HeapMutation<T>) => void
	constructor(
		compare: (a: T, b: T) => number,
		onMutation?: (event: HeapMutation<T>) => void,
	) {
		this.compare = compare
		this.onMutation = onMutation
	}
	private emit(action: HeapMutation<T>['action'], indices: number[], item?: T) {
		this.onMutation?.({ action, indices, item, values: [...this.values] })
	}
	private compareAt(a: number, b: number) {
		if (this.onMutation) this.emit('compare', [a, b])
		return this.compare(this.values[a]!, this.values[b]!)
	}
	get size() {
		return this.values.length
	}
	peek() {
		return this.values[0]
	}
	push(value: T) {
		this.values.push(value)
		if (this.onMutation) this.emit('insert', [this.values.length - 1], value)
		let index = this.values.length - 1
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2)
			if (this.compareAt(index, parent) >= 0) break
			;[this.values[index], this.values[parent]] = [
				this.values[parent]!,
				this.values[index]!,
			]
			if (this.onMutation) this.emit('swap', [index, parent])
			index = parent
		}
	}
	pop(): T | undefined {
		const root = this.values[0]
		const last = this.values.pop()
		if (!this.values.length || last === undefined) {
			if (root !== undefined && this.onMutation) this.emit('remove', [0], root)
			return root
		}
		this.values[0] = last
		if (this.onMutation) this.emit('remove', [0], root)
		let index = 0
		while (true) {
			const left = index * 2 + 1
			const right = left + 1
			let smallest = index
			if (left < this.values.length && this.compareAt(left, smallest) < 0)
				smallest = left
			if (right < this.values.length && this.compareAt(right, smallest) < 0)
				smallest = right
			if (smallest === index) break
			;[this.values[index], this.values[smallest]] = [
				this.values[smallest]!,
				this.values[index]!,
			]
			if (this.onMutation) this.emit('swap', [index, smallest])
			index = smallest
		}
		return root
	}
	toArray() {
		return [...this.values]
	}
}

export function selectTopK<T>(
	items: Iterable<T>,
	k: number,
	compare: (a: T, b: T) => number,
	onStep?: (
		action: 'retain' | 'replace' | 'skip',
		item: T,
		size: number,
	) => void,
	onMutation?: (event: HeapMutation<T>) => void,
	onCandidate?: (item: T, values: T[]) => void,
): T[] {
	if (!Number.isFinite(k) || k <= 0) return []
	const limit = Math.floor(k)
	if (limit === 0) return []
	const heap = new MinHeap(compare, onMutation)
	for (const item of items) {
		onCandidate?.(item, heap.toArray())
		if (heap.size < limit) {
			heap.push(item)
			onStep?.('retain', item, heap.size)
		} else {
			onMutation?.({
				action: 'compare',
				values: heap.toArray(),
				indices: [0],
				item,
			})
			if (compare(item, heap.peek()!) > 0) {
				heap.pop()
				heap.push(item)
				onStep?.('replace', item, heap.size)
			} else onStep?.('skip', item, heap.size)
		}
	}
	return heap.toArray().sort((a, b) => compare(b, a))
}
