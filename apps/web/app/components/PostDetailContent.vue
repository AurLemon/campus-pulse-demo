<script setup lang="ts">
import type { PostDetail } from '@campus/contracts'
const props = withDefaults(
	defineProps<{ postId: string; embedded?: boolean }>(),
	{ embedded: false },
)
const apiError = useApiError()
const { openAuth } = useAuthOverlay()
const commentFormPrefix = `post-comment-${useId()}`
const commentInputId = `${commentFormPrefix}-body`
let disposed = false
onBeforeUnmount(() => {
	disposed = true
})
const { remember } = usePostRecords()

const { t } = useI18n(),
	fetcher = useRequestFetch(),
	{ user } = await useCampus(),
	date = useCampusDate()
const { data, error, status, refresh } = await useAsyncData(
	`post-${user.value?.id ?? 'guest'}-${props.postId}`,
	() => fetcher<PostDetail>(`/api/posts/${props.postId}`),
)
watch(
	() => data.value?.post,
	(post) => {
		if (post) remember(post)
	},
	{ immediate: true },
)
const loadError = shallowRef(error.value)
watch(
	[error, status],
	([failure, requestStatus]) => {
		if (failure) loadError.value = failure
		else if (requestStatus === 'success') loadError.value = undefined
	},
	{ flush: 'sync' },
)
if (error.value && !props.embedded && import.meta.server) {
	const failure = error.value as {
		statusCode?: number
		status?: number
		response?: { status?: number }
	}
	const code =
		failure.statusCode ?? failure.status ?? failure.response?.status ?? 500
	setResponseStatus(
		Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500,
	)
}
const drafts = useState<Record<string, string>>('comment-drafts', () => ({})),
	key = computed(() => `${user.value?.id ?? 'guest'}:${props.postId}`)
const draft = computed({
		get: () => drafts.value[key.value] ?? '',
		set: (value) => (drafts.value[key.value] = value),
	}),
	replyTo = ref<string | null>(null),
	pendingReplyId = ref<string | null>(null),
	busy = ref(false),
	message = ref(''),
	composerFocused = ref(false)
const replyName = computed(
	() =>
		data.value?.comments.find((comment) => comment.id === replyTo.value)?.author
			.name ?? '',
)
const composerExpanded = computed(
	() =>
		composerFocused.value ||
		!!draft.value.trim() ||
		!!replyTo.value ||
		busy.value,
)
const composerPlaceholder = computed(() =>
	replyTo.value
		? t('comments.replyPlaceholder', { name: replyName.value })
		: t('comments.joinPlaceholder'),
)
const commentsSection = ref<HTMLElement>()
async function focusComments() {
	commentsSection.value?.scrollIntoView({
		block: 'nearest',
		behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? 'instant'
			: 'smooth',
	})
	if (user.value) {
		composerFocused.value = true
		await nextTick()
		document.getElementById(commentInputId)?.focus({ preventScroll: true })
	} else
		commentsSection.value
			?.querySelector<HTMLElement>('button')
			?.focus({ preventScroll: true })
}
function focusComposer() {
	composerFocused.value = true
}
function blurComposer() {
	if (!draft.value.trim() && !replyTo.value) composerFocused.value = false
}
const { fields, clear, capture } = useFieldErrors(commentFormPrefix)
useReadingSession({ postId: String(props.postId) })
async function submit() {
	if (busy.value || !draft.value.trim()) return
	if (!user.value) {
		void openAuth()
		return
	}
	const submittedKey = key.value
	const submittedBody = draft.value
	const submittedParent = replyTo.value
	const submittedUser = user.value.id
	busy.value = true
	message.value = ''
	clear()
	try {
		await $fetch('/api/comments', {
			method: 'POST',
			body: {
				postId: props.postId,
				body: submittedBody,
				parentId: submittedParent,
			},
		})
		if (drafts.value[submittedKey] === submittedBody)
			drafts.value[submittedKey] = ''
		if (disposed) return
		if (key.value === submittedKey && replyTo.value === submittedParent) {
			replyTo.value = null
			composerFocused.value = false
		}
		await refresh()
		if (!disposed && error.value && user.value?.id === submittedUser)
			message.value = t('comments.refreshPending')
	} catch (failure) {
		if (disposed || user.value?.id !== submittedUser) return
		message.value = apiError(failure)
		await capture(failure)
		const response = failure as {
			data?: { data?: { code?: string }; code?: string }
		}
		if ((response.data?.data?.code ?? response.data?.code) === 'UNAUTHORIZED')
			void openAuth()
	} finally {
		busy.value = false
	}
}
async function chooseReply(id: string) {
	if (
		busy.value ||
		!data.value?.comments.some(
			(comment) => comment.id === id && !comment.deleted,
		)
	)
		return
	if (!user.value) {
		pendingReplyId.value = id
		void openAuth()
		return
	}
	replyTo.value = id
	composerFocused.value = true
	await nextTick()
	const input = document.getElementById(commentInputId)
	input?.focus({ preventScroll: true })
	input?.scrollIntoView({
		block: 'nearest',
		behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? 'instant'
			: 'smooth',
	})
}
async function refreshComments() {
	message.value = ''
	try {
		await refresh()
	} catch {
		message.value = t('profileComments.savedRefreshPending')
	}
	if (error.value) message.value = t('profileComments.savedRefreshPending')
	if (
		replyTo.value &&
		!data.value?.comments.some(
			(comment) => comment.id === replyTo.value && !comment.deleted,
		)
	)
		replyTo.value = null
}
function cancelReply() {
	replyTo.value = null
	if (!draft.value.trim()) composerFocused.value = false
}
watch(
	() => user.value?.id,
	async (currentId, previousId) => {
		const pending = !previousId && currentId ? pendingReplyId.value : null
		pendingReplyId.value = null
		replyTo.value = null
		composerFocused.value = false
		message.value = ''
		clear()
		if (
			pending &&
			data.value?.comments.some((comment) => comment.id === pending)
		)
			await chooseReply(pending)
	},
)
</script>
<template>
	<div
		v-if="data"
		class="reading-page post-detail"
		:class="{ 'embedded-post': embedded }"
	>
		<NuxtLink v-if="!embedded" to="/" class="back-link"
			><UIcon name="i-lucide-arrow-left" />{{ t('ui.back') }}</NuxtLink
		>
		<article>
			<div class="detail-media">
				<MediaGallery
					:title="data.post.title"
					:poster-template="data.post.posterTemplate"
					:poster-aspect="data.post.posterAspect"
					:poster-highlight="data.post.posterHighlight"
					:tags="data.post.tags"
					:media="data.post.media"
				/>
			</div>
			<div class="detail-thread" :tabindex="embedded ? 0 : undefined">
				<div class="detail-copy">
					<div class="byline">
						<NuxtLink :to="`/users/${data.post.author.id}`" class="author"
							><UserAvatar :name="data.post.author.name" />{{
								data.post.author.name
							}}</NuxtLink
						><time>{{ date(data.post.createdAt) }}</time>
					</div>
					<h1>{{ data.post.title }}</h1>
					<div class="article-body">{{ data.post.body }}</div>
					<ActivityLink
						v-if="data.post.activity"
						:id="data.post.activity.id"
						class="related-link"
						><UIcon name="i-lucide-calendar-days" />
						<div>
							<small>{{ t('ui.relatedActivity') }}</small
							><strong>{{ data.post.activity.title }}</strong
							><span
								>{{ date(data.post.activity.startsAt) }} /
								{{ data.post.activity.location }}</span
							>
						</div>
						<UIcon name="i-lucide-chevron-right" /></ActivityLink
					><InteractionBar
						:item="data.post"
						type="post"
						@refresh="refresh()"
						@comment="focusComments"
					/>
				</div>
				<section
					ref="commentsSection"
					class="comments-section post-comments"
					:aria-label="t('ui.comment')"
				>
					<h2 class="post-comments__count">
						{{
							t('comments.total', {
								count: data.comments.filter((comment) => !comment.deleted)
									.length,
							})
						}}
					</h2>
					<div class="post-comments__composer-row">
						<span class="post-comments__composer-avatar" aria-hidden="true"
							><UserAvatar v-if="user" :name="user.name" /><UIcon
								v-else
								name="i-lucide-user-round"
						/></span>
						<form
							v-if="user"
							class="post-comments__composer"
							:class="{ 'is-expanded': composerExpanded }"
							@submit.prevent="submit"
						>
							<div v-if="replyTo" class="post-comments__reply-context">
								<span>{{ t('comments.replying', { name: replyName }) }}</span
								><UButton
									type="button"
									variant="link"
									color="neutral"
									size="xs"
									:disabled="busy"
									@click="cancelReply"
									>{{ t('ui.cancel') }}</UButton
								>
							</div>
							<UFormField
								class="post-comments__field"
								:label="t('ui.comment')"
								:error="fields.body"
								:ui="{ label: 'sr-only' }"
								required
								><UTextarea
									:id="commentInputId"
									v-model="draft"
									class="w-full post-comments__textarea"
									:rows="1"
									:maxrows="6"
									autoresize
									:maxlength="2000"
									:disabled="busy"
									required
									:placeholder="composerPlaceholder"
									@focus="focusComposer"
									@blur="blurComposer"
							/></UFormField>
							<p
								v-if="message"
								class="error post-comments__message"
								role="alert"
							>
								{{ message }}
							</p>
							<div v-if="composerExpanded" class="post-comments__actions">
								<UButton
									type="submit"
									color="neutral"
									variant="soft"
									size="sm"
									:loading="busy"
									:disabled="busy || !draft.trim()"
									>{{ t('ui.send') }}</UButton
								>
							</div>
						</form>
						<UButton
							v-else
							type="button"
							color="neutral"
							variant="soft"
							class="post-comments__entry"
							@click="openAuth()"
							>{{ t('comments.joinPlaceholder') }}</UButton
						>
					</div>
					<CommentThread
						v-if="data.comments.length"
						:key="data.post.id"
						:comments="data.comments"
						:post-author-id="data.post.authorId"
						:viewer-id="user?.id"
						:busy="busy"
						@reply="chooseReply"
						:on-refresh="refreshComments"
					/>
					<p v-else class="post-comments__empty">{{ t('ui.commentEmpty') }}</p>
				</section>
			</div>
		</article>
		<section v-if="!embedded && data.related.length" class="related-posts">
			<h2>{{ t('ui.relatedPosts') }}</h2>
			<MasonryFeed :items="data.related"
				><template #default="{ item }"><PostCard :post="item" /></template
			></MasonryFeed>
		</section>
	</div>
	<section
		v-else-if="loadError"
		class="detail-error-state post-overlay-error"
		:class="{ 'embedded-detail-error': embedded }"
		role="alert"
		:aria-busy="status === 'pending'"
	>
		<UIcon
			name="i-lucide-cloud-alert"
			class="detail-error-state__icon"
			aria-hidden="true"
		/>
		<h2 class="detail-error-state__title">{{ t('ui.error') }}</h2>
		<p
			v-if="apiError(loadError) !== t('ui.error')"
			class="detail-error-state__message"
		>
			{{ apiError(loadError) }}
		</p>
		<UButton
			class="detail-error-state__retry"
			color="neutral"
			variant="soft"
			:loading="status === 'pending'"
			:disabled="status === 'pending'"
			@click="refresh()"
			>{{ t(status === 'pending' ? 'ui.loading' : 'ui.retry') }}</UButton
		>
	</section>
</template>

<style scoped>
.post-comments {
	border: 0;
	background: transparent;
	box-shadow: none;
}
.post-comments__count {
	margin: 0 0 17px;
	color: var(--muted);
	font-size: 13px;
	font-weight: 400;
	line-height: 1.6;
	letter-spacing: 0;
}
.post-comments__composer-row {
	display: flex;
	align-items: flex-start;
	gap: 11px;
	margin: 0 0 27px;
}
.post-comments__composer-avatar {
	display: flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 32px;
	width: 32px;
	height: 32px;
	margin-top: 4px;
	border-radius: 50%;
	color: var(--muted);
	background: var(--surface-raised);
}
.post-comments__composer-avatar :deep(.avatar) {
	width: 32px;
	height: 32px;
	font-size: 13px;
}
.post-comments__composer-avatar > .iconify {
	width: 17px;
	height: 17px;
}
.post-comments__composer {
	flex: 1;
	min-width: 0;
	margin: 0;
	padding: 0;
	border: 0;
	background: transparent;
	box-shadow: none;
}
.post-comments__field {
	width: 100%;
	min-width: 0;
}
.post-comments__textarea :deep(textarea) {
	display: block;
	width: 100%;
	min-height: 40px;
	margin: 0;
	padding: 10px 16px;
	border: 0;
	border-radius: 22px;
	outline: none;
	background: var(--surface-raised);
	color: var(--ink);
	font-size: 13px;
	line-height: 20px;
	resize: none;
	box-shadow: none;
}
.post-comments__textarea :deep(textarea::placeholder) {
	color: var(--muted);
	opacity: 1;
}
.post-comments__textarea :deep(textarea:focus-visible) {
	outline: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
	outline-offset: 0;
}
.post-comments__entry {
	display: flex;
	justify-content: flex-start;
	align-items: center;
	flex: 1;
	min-width: 0;
	min-height: 40px;
	margin: 0;
	padding: 10px 16px;
	border: 0;
	border-radius: 22px;
	background: var(--surface-raised);
	color: var(--muted);
	font-size: 13px;
	font-weight: 400;
	line-height: 20px;
	box-shadow: none;
}
.post-comments__entry:hover {
	color: var(--muted);
	background: color-mix(in srgb, var(--surface-raised) 93%, var(--muted));
}
.post-comments__reply-context {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin: 0 0 7px;
	color: var(--muted);
	font-size: 12px;
	line-height: 1.5;
}
.post-comments__reply-context > span {
	min-width: 0;
	overflow-wrap: anywhere;
}
.post-comments__reply-context :deep(button) {
	flex-shrink: 0;
	min-height: 22px;
	padding: 0;
	color: var(--muted);
	font-size: 11px;
	font-weight: 400;
	text-decoration: none;
}
.post-comments__actions {
	display: flex;
	justify-content: flex-end;
	margin-top: 8px;
}
.post-comments__actions :deep(button) {
	min-height: 30px;
	padding: 5px 13px;
	border-radius: 99px;
	font-size: 12px;
	font-weight: 400;
}
.post-comments__message {
	margin: 8px 0 0;
}
.post-comments__empty {
	text-align: center;
	padding: 24px 0;
	margin: 0;
	color: var(--muted);
	font-size: 13px;
	line-height: 1.7;
}
</style>
