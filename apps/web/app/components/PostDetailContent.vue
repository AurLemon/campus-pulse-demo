<script setup lang="ts">
import type { MediaAsset, PostDetail, PostComments } from '@campus/contracts'
const props = withDefaults(
	defineProps<{ postId: string; embedded?: boolean }>(),
	{ embedded: false },
)
const commentSort = ref<'popular' | 'latest'>('popular')
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
const commentMedia = ref<MediaAsset[]>([])
const uploadingComment = ref(false)
const operationId = ref('')
const replyAnchorId = ref<string | null>(null)
watch(replyTo, (value) => {
	if (!value) {
		replyAnchorId.value = null
	}
})
const replyName = computed(
	() =>
		data.value?.comments.find((comment) => comment.id === replyAnchorId.value)
			?.author.name ?? '',
)
const composerExpanded = computed(
	() =>
		composerFocused.value ||
		!!draft.value.trim() ||
		!!commentMedia.value.length ||
		busy.value,
)
const composerPlaceholder = computed(() => t('comments.joinPlaceholder'))
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
	if (!draft.value.trim()) composerFocused.value = false
}
const { fields, clear, capture } = useFieldErrors(commentFormPrefix)
useReadingSession({ postId: String(props.postId) })
async function submit() {
	if (
		busy.value ||
		uploadingComment.value ||
		(!draft.value.trim() && !commentMedia.value.length)
	)
		return
	if (!user.value) {
		void openAuth()
		return
	}
	operationId.value ||= crypto.randomUUID()
	const submittedKey = key.value
	const submittedBody = draft.value
	const submittedParent = null
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
				mediaIds: commentMedia.value.map((asset) => asset.id),
				operationId: operationId.value,
			},
		})
		commentMedia.value = []
		operationId.value = ''
		if (drafts.value[submittedKey] === submittedBody)
			drafts.value[submittedKey] = ''
		if (disposed) return
		if (key.value === submittedKey) {
			composerFocused.value = false
		}
		await refreshComments()
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
	const comment = data.value!.comments.find((comment) => comment.id === id)!
	replyTo.value = comment.parentId ?? comment.id
	replyAnchorId.value = id
	await nextTick()
	const target = document.getElementById(`${commentFormPrefix}-reply-${id}`)
	target?.querySelector('textarea')?.focus({ preventScroll: true })
	target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
let commentsMounted = false
let commentsTimer: ReturnType<typeof setTimeout> | undefined
let commentsController: AbortController | undefined
function stopCommentsPolling() {
	clearTimeout(commentsTimer)
	commentsController?.abort()
	commentsController = undefined
}
function scheduleCommentsPoll() {
	clearTimeout(commentsTimer)
	if (!disposed && commentsMounted && !document.hidden)
		commentsTimer = setTimeout(() => {
			void pollComments()
		}, 3000)
}
function commentScrollAnchor() {
	const section = commentsSection.value
	if (!section) return
	let scroller = section.parentElement
	while (
		scroller &&
		!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
	)
		scroller = scroller.parentElement
	scroller ??= document.scrollingElement as HTMLElement | null
	if (!scroller) return
	const bounds =
		scroller === document.scrollingElement
			? { top: 0, bottom: window.innerHeight }
			: scroller.getBoundingClientRect()
	const focused =
		document.activeElement?.closest<HTMLElement>('[data-comment-id]')
	const anchor =
		focused && section.contains(focused)
			? focused
			: [...section.querySelectorAll<HTMLElement>('[data-comment-id]')].find(
					(row) => {
						const box = row.getBoundingClientRect()
						return box.bottom > bounds.top && box.top < bounds.bottom
					},
				)
	return anchor
		? { element: anchor, top: anchor.getBoundingClientRect().top, scroller }
		: undefined
}
async function loadComments() {
	stopCommentsPolling()
	const controller = new AbortController()
	commentsController = controller
	const viewerId = user.value?.id
	const postId = props.postId
	try {
		const result = await $fetch<PostComments>(
			`/api/posts/${encodeURIComponent(postId)}/comments`,
			{
				signal: controller.signal,
				timeout: 8000,
				retry: 0,
			},
		)
		if (
			disposed ||
			controller.signal.aborted ||
			user.value?.id !== viewerId ||
			props.postId !== postId ||
			!data.value
		)
			return false
		if (
			JSON.stringify(result.comments) !== JSON.stringify(data.value.comments)
		) {
			const anchor = commentScrollAnchor()
			data.value = {
				...data.value,
				comments: result.comments,
				post: {
					...data.value.post,
					stats: {
						...data.value.post.stats,
						comments: result.comments.filter((comment) => !comment.deleted)
							.length,
					},
				},
			}
			await nextTick()
			if (anchor?.element.isConnected)
				anchor.scroller.scrollTop +=
					anchor.element.getBoundingClientRect().top - anchor.top
		}
		if (message.value === t('profileComments.savedRefreshPending'))
			message.value = ''
		return true
	} catch {
		return false
	} finally {
		if (commentsController === controller) {
			commentsController = undefined
			scheduleCommentsPoll()
		}
	}
}
async function pollComments() {
	if (disposed || !commentsMounted || document.hidden || commentsController)
		return
	await loadComments()
}
function commentsVisibilityChanged() {
	if (document.hidden) stopCommentsPolling()
	else void pollComments()
}
onMounted(() => {
	commentsMounted = true
	document.addEventListener('visibilitychange', commentsVisibilityChanged)
	window.addEventListener('focus', pollComments)
	void pollComments()
})
onBeforeUnmount(() => {
	commentsMounted = false
	stopCommentsPolling()
	document.removeEventListener('visibilitychange', commentsVisibilityChanged)
	window.removeEventListener('focus', pollComments)
})
watch(
	() => data.value?.comments,
	(comments) => {
		if (
			replyAnchorId.value &&
			!comments?.some(
				(comment) => comment.id === replyAnchorId.value && !comment.deleted,
			)
		)
			replyTo.value = null
	},
	{ flush: 'sync' },
)
async function refreshComments() {
	message.value = ''
	const viewerId = user.value?.id
	if (!(await loadComments()) && !disposed && user.value?.id === viewerId)
		message.value = t('profileComments.savedRefreshPending')
}
function cancelReply() {
	replyTo.value = null
}
watch(
	() => user.value?.id,
	async (currentId, previousId) => {
		stopCommentsPolling()
		const pending = !previousId && currentId ? pendingReplyId.value : null
		pendingReplyId.value = null
		replyTo.value = null
		composerFocused.value = false
		message.value = ''
		commentMedia.value = []
		operationId.value = ''
		clear()
		if (
			pending &&
			data.value?.comments.some((comment) => comment.id === pending)
		)
			await chooseReply(pending)
		if (commentsMounted) void pollComments()
	},
)
watch(
	[draft, commentMedia],
	() => {
		if (!busy.value) operationId.value = ''
	},
	{ deep: true },
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
							><UserAvatar
								:src="data.post.author.avatar"
								:name="data.post.author.name"
							/>{{ data.post.author.name }}</NuxtLink
						><time>{{ date(data.post.createdAt) }}</time>
					</div>
					<h1>
						<MentionText
							:text="data.post.title"
							:mentions="data.post.titleMentions"
						/>
					</h1>
					<div class="article-body">
						<MentionText
							:text="data.post.body"
							:mentions="data.post.bodyMentions"
						/>
					</div>
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
					<div class="post-comments__heading">
						<h2 class="post-comments__count">
							{{
								t('comments.total', {
									count: data.comments.filter((comment) => !comment.deleted)
										.length,
								})
							}}
						</h2>
						<UDropdownMenu
							:items="[
								{
									label: t('comments.popular'),
									type: 'checkbox',
									checked: commentSort === 'popular',
									onSelect: () => (commentSort = 'popular'),
								},
								{
									label: t('comments.latest'),
									type: 'checkbox',
									checked: commentSort === 'latest',
									onSelect: () => (commentSort = 'latest'),
								},
							]"
							:content="{ align: 'end' }"
						>
							<UButton
								variant="link"
								color="neutral"
								size="xs"
								trailing-icon="i-lucide-chevron-down"
								class="post-comments__sort"
								:aria-label="t('comments.sort')"
								>{{ t(`comments.${commentSort}`) }}</UButton
							>
						</UDropdownMenu>
					</div>

					<div class="post-comments__composer-row">
						<span class="post-comments__composer-avatar" aria-hidden="true"
							><UserAvatar
								v-if="user"
								:src="user.avatar"
								:name="user.name" /><UIcon v-else name="i-lucide-user-round"
						/></span>
						<form
							v-if="user"
							class="post-comments__composer"
							:class="{ 'is-expanded': composerExpanded }"
							@submit.prevent="submit"
						>
							<UFormField
								class="post-comments__field"
								:label="t('ui.comment')"
								:error="fields.body"
								:ui="{ label: 'sr-only' }"
								><UTextarea
									:id="commentInputId"
									v-model="draft"
									class="w-full post-comments__textarea"
									:rows="1"
									:maxrows="6"
									autoresize
									:maxlength="2000"
									:disabled="busy"
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
							<MessageMediaPicker
								v-model="commentMedia"
								:disabled="busy"
								@busy="uploadingComment = $event"
							/>
							<div
								v-if="composerExpanded || commentMedia.length"
								class="post-comments__actions"
							>
								<UButton
									type="submit"
									color="neutral"
									variant="soft"
									size="sm"
									:loading="busy"
									:disabled="
										busy ||
										uploadingComment ||
										(!draft.trim() && !commentMedia.length)
									"
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
						:sort="commentSort"
						:reply-target-prefix="commentFormPrefix"
						:reply-anchor-id="replyAnchorId"
						:post-author-id="data.post.authorId"
						:viewer-id="user?.id"
						:busy="busy"
						@reply="chooseReply"
						:on-refresh="refreshComments"
					>
						<template #reply>
							<CommentReplyComposer
								v-if="user && replyTo && replyAnchorId"
								:key="`${user.id}:${replyAnchorId}`"
								:post-id="postId"
								:parent-id="replyTo"
								:comment-id="replyAnchorId"
								:reply-name="replyName"
								:user="user"
								:on-refresh="refreshComments"
								@cancel="cancelReply"
								@sent="cancelReply"
							/>
						</template>
					</CommentThread>
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
.post-comments__heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 17px;
}
.post-comments__sort {
	padding: 0;
	color: var(--muted);
	text-decoration: none;
}
.post-comments__count {
	margin: 0;
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
