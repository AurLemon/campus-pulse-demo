<script setup lang="ts">
interface HistoryBook {
	id: string
	title: string
	coverUrl: string
	authors: string[]
}
interface Loan {
	id: string
	book: HistoryBook
	borrowedAt: string
	dueAt: string
	returnedAt: string | null
}
interface Record {
	id: string
	book: HistoryBook
	kind: string
	occurredAt: string
}
const { t } = useI18n(),
	request = useRequestFetch(),
	{ user } = await useCampus(),
	{ openAuth } = useAuthOverlay()
const { data, status, error, refresh } = await useAsyncData(
	'book-history',
	() =>
		user.value
			? request<{ loans: Loan[]; records: Record[] }>('/api/books/history')
			: Promise.resolve(null),
	{ watch: [() => user.value?.id] },
)
const { locale } = useI18n()
function date(value: string) {
	return new Intl.DateTimeFormat(locale.value, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'Asia/Taipei',
	}).format(new Date(value))
}
</script>
<template>
	<div class="book-history">
		<UButton
			to="/books"
			icon="i-lucide-arrow-left"
			color="neutral"
			variant="ghost"
			size="sm"
			>{{ t('books.back') }}</UButton
		>
		<h1>{{ t('books.history') }}</h1>
		<UButton v-if="!user" color="neutral" variant="soft" @click="openAuth()">{{
			t('ui.login')
		}}</UButton>
		<p v-else-if="status === 'pending'" class="history-empty" role="status">
			{{ t('books.loading') }}
		</p>
		<div v-else-if="error" class="history-empty">
			<p role="alert">{{ t('books.error') }}</p>
			<UButton color="neutral" variant="soft" @click="refresh()">{{
				t('books.retry')
			}}</UButton>
		</div>
		<template v-else>
			<section class="history-section">
				<h2>
					{{ t('books.loanHistory') }}<span>{{ data?.loans.length ?? 0 }}</span>
				</h2>
				<p v-if="!data?.loans.length" class="history-empty">
					{{ t('books.historyEmpty') }}
				</p>
				<article v-for="loan in data?.loans" :key="loan.id" class="history-row">
					<NuxtLink
						:to="{ path: '/books', query: { book: loan.book.id } }"
						class="history-cover"
						:aria-label="loan.book.title"
						><img
							:src="loan.book.coverUrl"
							:alt="loan.book.title"
							loading="lazy"
							referrerpolicy="no-referrer"
					/></NuxtLink>
					<div class="history-copy">
						<div class="history-title">
							<NuxtLink
								:to="{ path: '/books', query: { book: loan.book.id } }"
								>{{ loan.book.title }}</NuxtLink
							><span
								class="loan-status"
								:class="{ 'is-active': !loan.returnedAt }"
								>{{
									t(loan.returnedAt ? 'books.RETURN' : 'books.active')
								}}</span
							>
						</div>
						<p class="history-authors">{{ loan.book.authors.join(' / ') }}</p>
						<dl class="loan-dates">
							<div>
								<dt>{{ t('books.borrowedAt') }}</dt>
								<dd>
									<time :datetime="loan.borrowedAt">{{
										date(loan.borrowedAt)
									}}</time>
								</dd>
							</div>
							<div>
								<dt>
									{{ t(loan.returnedAt ? 'books.returnedAt' : 'books.due') }}
								</dt>
								<dd>
									<time :datetime="loan.returnedAt ?? loan.dueAt">{{
										date(loan.returnedAt ?? loan.dueAt)
									}}</time>
								</dd>
							</div>
						</dl>
					</div>
				</article>
			</section>
			<section class="history-section">
				<h2>
					{{ t('books.readingHistory')
					}}<span>{{ data?.records.length ?? 0 }}</span>
				</h2>
				<p v-if="!data?.records.length" class="history-empty">
					{{ t('books.historyEmpty') }}
				</p>
				<article
					v-for="record in data?.records"
					:key="record.id"
					class="history-row reading-row"
				>
					<NuxtLink
						:to="{ path: '/books', query: { book: record.book.id } }"
						class="history-cover"
						:aria-label="record.book.title"
						><img
							:src="record.book.coverUrl"
							:alt="record.book.title"
							loading="lazy"
							referrerpolicy="no-referrer"
					/></NuxtLink>
					<div class="history-copy">
						<div class="history-title">
							<NuxtLink
								:to="{ path: '/books', query: { book: record.book.id } }"
								>{{ record.book.title }}</NuxtLink
							><span class="loan-status">{{ t(`books.${record.kind}`) }}</span>
						</div>
						<p class="history-authors">{{ record.book.authors.join(' / ') }}</p>
						<time class="record-date" :datetime="record.occurredAt">{{
							date(record.occurredAt)
						}}</time>
					</div>
				</article>
			</section>
		</template>
	</div>
</template>
<style scoped>
.book-history {
	max-width: 880px;
	margin: 0 auto;
}
.book-history h1 {
	font-size: 23px;
	font-weight: 600;
	margin: 22px 0 32px;
	letter-spacing: -0.02em;
}
.history-section + .history-section {
	margin-top: 40px;
}
.history-section h2 {
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 16px;
	font-weight: 600;
	margin-bottom: 8px;
}
.history-section h2 span {
	color: var(--ui-text-muted);
	font-size: 12px;
	font-weight: 400;
}
.history-row {
	display: flex;
	align-items: flex-start;
	gap: 20px;
	padding: 22px 0;
	border-bottom: 1px solid var(--ui-border-muted);
}
.history-cover {
	width: 70px;
	height: 100px;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--ui-bg-elevated);
	border-radius: 5px;
	overflow: hidden;
}
.history-cover img {
	width: 100%;
	height: 100%;
	object-fit: contain;
}
.history-copy {
	min-width: 0;
	flex: 1;
}
.history-title {
	display: flex;
	gap: 12px;
	justify-content: space-between;
	align-items: flex-start;
	font-size: 15px;
	font-weight: 550;
	line-height: 1.6;
}
.history-title a {
	overflow-wrap: anywhere;
}
.loan-status {
	flex-shrink: 0;
	padding: 2px 9px;
	border-radius: 6px;
	font-size: 11px;
	font-weight: 400;
	background: var(--ui-bg-elevated);
	color: var(--ui-text-muted);
}
.loan-status.is-active {
	color: var(--ui-text);
}
.history-authors {
	color: var(--ui-text-muted);
	font-size: 12px;
	margin: 5px 0 16px;
}
.loan-dates {
	display: flex;
	flex-wrap: wrap;
	gap: 12px 32px;
	font-size: 12px;
}
.loan-dates div {
	display: flex;
	gap: 10px;
}
.loan-dates dt,
.record-date {
	color: var(--ui-text-muted);
}
.loan-dates dd {
	margin: 0;
}
.record-date {
	font-size: 12px;
}
.reading-row .history-cover {
	width: 48px;
	height: 68px;
}
.reading-row .history-authors {
	margin-bottom: 8px;
}
.history-empty {
	text-align: center;
	padding: 24px 0;
	color: var(--ui-text-muted);
	font-size: 13px;
}
@media (max-width: 600px) {
	.history-row {
		gap: 14px;
		padding: 18px 0;
	}
	.history-cover {
		width: 60px;
		height: 86px;
	}
	.history-title {
		font-size: 14px;
		flex-wrap: wrap;
		gap: 6px;
	}
	.history-title a {
		flex-basis: 100%;
	}
	.loan-dates {
		gap: 6px;
		flex-direction: column;
	}
	.history-authors {
		margin-bottom: 10px;
	}
}
</style>
