<script setup lang="ts">
import type { BookView, BookStatus } from '@campus/contracts/books'
const props = defineProps<{ id: string }>(),
	emit = defineEmits<{ changed: [] }>()
const { t } = useI18n(),
	{ user } = await useCampus(),
	{ openAuth } = useAuthOverlay(),
	request = useRequestFetch()
const {
	data: book,
	status,
	error,
	refresh,
} = await useAsyncData(
	() => `book-${props.id}`,
	() => request<BookView>(`/api/books/${encodeURIComponent(props.id)}`),
	{ watch: [() => props.id] },
)
const busy = ref(false),
	failure = ref('')
const statusOptions = computed(() =>
	(['NONE', 'WANT', 'READING', 'READ'] as BookStatus[]).map((value) => ({
		value,
		label: t(value === 'NONE' ? 'books.none' : `books.${value}`),
	})),
)
async function mutate(
	path: string,
	body: Record<string, unknown>,
	method: 'POST' | 'PATCH',
) {
	if (!user.value) {
		await openAuth()
		return
	}
	if (busy.value) return
	busy.value = true
	failure.value = ''
	try {
		await $fetch(`/api/books/${encodeURIComponent(props.id)}/${path}`, {
			method,
			body,
		})
		await refresh()
		emit('changed')
	} catch (error) {
		const code = (error as { data?: { data?: { code?: string } } }).data?.data
			?.code
		failure.value =
			code && ['BOOK_UNAVAILABLE', 'BOOK_LOAN_LIMIT'].includes(code)
				? t(`books.${code}`)
				: t('books.error')
	} finally {
		busy.value = false
	}
}
function changeStatus(value: BookStatus) {
	void mutate('state', { status: value }, 'PATCH')
}
function favorite() {
	void mutate('state', { favorite: !book.value?.favorite }, 'PATCH')
}
function loan() {
	void mutate(
		'loan',
		{ action: book.value?.loan ? 'return' : 'borrow' },
		'POST',
	)
}
</script>
<template>
	<div v-if="status === 'pending'" class="p-6">{{ t('books.loading') }}</div>
	<div v-else-if="error" class="p-6">
		<p role="alert">{{ t('books.error') }}</p>
		<UButton @click="refresh()">{{ t('books.retry') }}</UButton>
	</div>
	<div v-else-if="book" class="book-detail">
		<div class="detail-cover">
			<img
				:src="book.coverUrl"
				:alt="book.title"
				referrerpolicy="no-referrer"
			/>
		</div>
		<div class="detail-copy" tabindex="0">
			<h1>{{ book.title }}</h1>
			<p>{{ book.authors.join(' / ') }}</p>
			<p class="muted">{{ t('books.publisher') }}：{{ book.publisher }}</p>
			<p v-if="book.isbn13" class="muted">
				{{ t('books.isbn') }}：{{ book.isbn13 }}
			</p>
			<div class="book-detail-actions">
				<USelect
					:model-value="book.status"
					:items="statusOptions"
					:disabled="busy"
					:aria-label="t('books.status')"
					@update:model-value="changeStatus"
				/><UButton
					color="neutral"
					variant="soft"
					:loading="busy"
					:icon="
						book.favorite ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'
					"
					@click="favorite"
					>{{
						t(book.favorite ? 'books.unfavorite' : 'books.favorite')
					}}</UButton
				><UButton
					variant="soft"
					:loading="busy"
					:disabled="!book.loan && book.available === 0"
					@click="loan"
					>{{ t(book.loan ? 'books.return' : 'books.borrow') }}</UButton
				>
			</div>
			<p class="muted">{{ t('books.available', { count: book.available }) }}</p>
			<p v-if="book.loan">
				{{ t('books.due') }}：{{
					new Date(book.loan.dueAt).toLocaleDateString()
				}}
			</p>
			<p v-if="failure" class="error" role="alert">{{ failure }}</p>
			<h2>{{ t('books.description') }}</h2>
			<p class="description">{{ book.description }}</p>
		</div>
	</div>
</template>
<style scoped>
.book-detail {
	display: grid;
	grid-template-columns: minmax(0, 0.48fr) minmax(0, 0.52fr);
	height: 100%;
	min-height: 0;
	overflow: hidden;
}
.detail-cover {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 0;
	padding: 0;
	overflow: hidden;
}
.detail-cover img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.detail-copy {
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-width: none;
	padding: 52px 28px 28px;
}
.detail-copy::-webkit-scrollbar {
	display: none;
}
.detail-copy:focus-visible {
	outline: none;
}
.detail-copy h1 {
	font-size: 24px;
	font-weight: 650;
	margin-bottom: 12px;
}
.detail-copy p {
	line-height: 1.8;
	margin: 8px 0;
}
.muted {
	color: var(--ui-text-muted);
	font-size: 13px;
}
.book-detail-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin: 20px 0;
}
.detail-copy h2 {
	font-size: 16px;
	font-weight: 600;
	margin: 24px 0 12px;
}
.description {
	white-space: pre-line;
	font-size: 14px;
}
.error {
	color: var(--ui-error);
}
@media (max-width: 700px) {
	.book-detail {
		display: block;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: none;
	}
	.book-detail::-webkit-scrollbar {
		display: none;
	}
	.detail-cover {
		padding: 24px 16px 8px;
	}
	.detail-copy {
		overflow: visible;
		padding: 20px;
	}
	.detail-cover img {
		object-fit: contain;
		max-height: 270px;
		width: auto;
		max-width: 100%;
	}
	.detail-copy h1 {
		font-size: 21px;
	}
}
</style>
