<script setup lang="ts">
import type { BookView } from '@campus/contracts/books'
defineProps<{ book: BookView }>()
const { t } = useI18n(),
	route = useRoute()
</script>
<template>
	<NuxtLink
		:to="{ path: '/books', query: { ...route.query, book: book.id } }"
		class="book-card"
	>
		<div class="book-cover">
			<img
				:src="book.coverUrl"
				:alt="book.title"
				loading="lazy"
				referrerpolicy="no-referrer"
			/><span v-if="book.academic" class="book-academic">{{
				t('books.academic')
			}}</span>
		</div>
		<div class="book-card-copy">
			<h3>{{ book.title }}</h3>
			<p>{{ book.authors.join(' / ') }}</p>
			<small>{{ book.publisher }}</small>
			<div class="book-state">
				<span>{{ t('books.available', { count: book.available }) }}</span
				><span v-if="book.status !== 'NONE'">{{
					t(`books.${book.status}`)
				}}</span
				><UIcon v-if="book.favorite" name="i-lucide-bookmark" />
			</div>
		</div>
	</NuxtLink>
</template>
<style scoped>
.book-card {
	display: block;
	overflow: hidden;
	border-radius: 14px;
	background: var(--ui-bg-elevated);
	transition: filter 0.15s;
	text-decoration: none;
	color: inherit;
}
.book-card:hover {
	filter: brightness(0.95);
}
.book-cover {
	height: 240px;
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	background: color-mix(
		in srgb,
		var(--ui-bg-elevated) 70%,
		var(--ui-text-muted) 8%
	);
	padding: 20px;
}
.book-cover img {
	height: 100%;
	max-width: 100%;
	object-fit: contain;
}
.book-academic {
	position: absolute;
	left: 8px;
	bottom: 8px;
	font-size: 10px;
	border-radius: 6px;
	padding: 3px 6px;
	background: var(--ui-bg);
	color: var(--ui-text-muted);
}
.book-card-copy {
	padding: 14px;
}
.book-card h3 {
	font-size: 15px;
	font-weight: 600;
	line-height: 1.5;
	margin: 0 0 8px;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.book-card p,
.book-card small {
	font-size: 12px;
	color: var(--ui-text-muted);
	line-height: 1.6;
}
.book-state {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 8px;
	font-size: 11px;
	margin-top: 12px;
	color: var(--ui-text-muted);
}
@media (max-width: 600px) {
	.book-cover {
		height: 200px;
		padding: 16px;
	}
	.book-card-copy {
		padding: 12px;
	}
}
</style>
