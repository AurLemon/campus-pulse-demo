<script setup lang="ts">
import type { CommentView } from '@campus/contracts'
const props = withDefaults(
	defineProps<{
		comments: CommentView[]
		postAuthorId: string
		viewerId?: string
		onRefresh?: () => Promise<void>
		busy?: boolean
	}>(),
	{ busy: false, viewerId: undefined, onRefresh: undefined },
)
const emit = defineEmits<{ reply: [commentId: string] }>()
const { t } = useI18n(),
	date = useCampusDate(),
	apiError = useApiError()
const expanded = ref<string[]>([]),
	editingId = ref<string | null>(null),
	editingBody = ref(''),
	deletingId = ref<string | null>(null),
	mutationId = ref<string | null>(null),
	message = ref('')
const editInputId = `comment-edit-${useId()}`
const roots = computed(() =>
	props.comments.filter((comment) => !comment.parentId),
)
const repliesByRoot = computed(() => {
	const groups = new Map<string, CommentView[]>()
	for (const comment of props.comments) {
		if (!comment.parentId) continue
		const group = groups.get(comment.parentId) ?? []
		group.push(comment)
		groups.set(comment.parentId, group)
	}
	return groups
})
function replies(rootId: string) {
	return repliesByRoot.value.get(rootId) ?? []
}
function rows(root: CommentView) {
	const group = replies(root.id)
	return [
		root,
		...(expanded.value.includes(root.id) ? group : group.slice(0, 1)),
	]
}
function toggle(rootId: string) {
	expanded.value = expanded.value.includes(rootId)
		? expanded.value.filter((id) => id !== rootId)
		: [...expanded.value, rootId]
}
function canManage(comment: CommentView) {
	return (
		!!props.viewerId && props.viewerId === comment.authorId && !comment.deleted
	)
}
function startEdit(comment: CommentView) {
	if (props.busy || mutationId.value) return
	editingId.value = comment.id
	editingBody.value = comment.body
	message.value = ''
	nextTick(() => document.getElementById(editInputId)?.focus())
}
function cancelEdit() {
	if (mutationId.value) return
	editingId.value = null
	message.value = ''
}
function askDelete(comment: CommentView) {
	if (props.busy || mutationId.value) return
	deletingId.value = comment.id
	message.value = ''
}
function closeDelete(value: boolean) {
	if (!value && !mutationId.value) {
		deletingId.value = null
		message.value = ''
	}
}
async function saveEdit() {
	if (
		!editingId.value ||
		mutationId.value ||
		props.busy ||
		!editingBody.value.trim()
	)
		return
	mutationId.value = editingId.value
	const viewer = props.viewerId
	message.value = ''
	try {
		await $fetch(`/api/comments/${editingId.value}`, {
			method: 'PATCH',
			body: { body: editingBody.value },
		})
		editingId.value = null
		await props.onRefresh?.()
	} catch (error) {
		if (props.viewerId === viewer) message.value = apiError(error)
	} finally {
		mutationId.value = null
	}
}
async function confirmDelete() {
	if (!deletingId.value || mutationId.value || props.busy) return
	const target = deletingId.value
	mutationId.value = target
	const viewer = props.viewerId
	message.value = ''
	try {
		await $fetch(`/api/comments/${target}`, { method: 'DELETE' })
		if (editingId.value === target) editingId.value = null
		deletingId.value = null
		await props.onRefresh?.()
	} catch (error) {
		if (props.viewerId === viewer) message.value = apiError(error)
	} finally {
		mutationId.value = null
	}
}
watch(
	() => props.viewerId,
	() => {
		editingId.value = null
		deletingId.value = null
		editingBody.value = ''
		message.value = ''
	},
)
watch(
	() => props.comments,
	(comments, previous) => {
		const previousIds = new Set(previous?.map((comment) => comment.id) ?? [])
		for (const comment of comments)
			if (
				comment.parentId &&
				!previousIds.has(comment.id) &&
				previous &&
				!expanded.value.includes(comment.parentId)
			)
				expanded.value.push(comment.parentId)
		const rootIds = new Set(
			comments
				.filter((comment) => !comment.parentId)
				.map((comment) => comment.id),
		)
		expanded.value = expanded.value.filter((id) => rootIds.has(id))
	},
)
</script>
<template>
	<ol class="comment-thread">
		<li v-for="root in roots" :key="root.id" class="comment-thread__item">
			<div
				v-for="comment in rows(root)"
				:key="comment.id"
				class="comment-thread__row"
				:class="{ 'comment-thread__row--reply': !!comment.parentId }"
			>
				<NuxtLink
					:to="`/users/${comment.authorId}`"
					class="comment-thread__avatar"
					:aria-label="comment.author.name"
					><UserAvatar :name="comment.author.name"
				/></NuxtLink>
				<div class="comment-thread__content">
					<div class="comment-thread__byline">
						<NuxtLink
							:to="`/users/${comment.authorId}`"
							class="comment-thread__name"
							>{{ comment.author.name }}</NuxtLink
						><span
							v-if="comment.authorId === postAuthorId"
							class="comment-thread__author"
							>{{ t('comments.author') }}</span
						>
						<UDropdownMenu
							v-if="canManage(comment)"
							:items="[
								{
									label: t('profileComments.editComment'),
									onSelect: () => startEdit(comment),
								},
								{
									label: t('profileComments.deleteComment'),
									onSelect: () => askDelete(comment),
								},
							]"
							:content="{ align: 'end' }"
							><UButton
								class="comment-thread__menu"
								icon="i-lucide-ellipsis"
								variant="ghost"
								color="neutral"
								size="xs"
								:aria-label="t('profileComments.commentActions')"
								:disabled="busy || !!mutationId"
						/></UDropdownMenu>
					</div>
					<form
						v-if="editingId === comment.id && !comment.deleted"
						class="comment-thread__editor"
						@submit.prevent="saveEdit"
					>
						<UTextarea
							:id="editInputId"
							v-model="editingBody"
							class="w-full"
							:rows="2"
							autoresize
							:maxlength="2000"
							required
							:disabled="!!mutationId"
						/>
						<p v-if="message && !deletingId" class="error" role="alert">
							{{ message }}
						</p>
						<div class="comment-thread__edit-actions">
							<UButton
								color="neutral"
								variant="ghost"
								size="xs"
								:disabled="!!mutationId"
								@click="cancelEdit"
								>{{ t('profileComments.cancel') }}</UButton
							><UButton
								color="neutral"
								variant="soft"
								size="xs"
								type="submit"
								:loading="mutationId === comment.id"
								:disabled="!!mutationId || !editingBody.trim()"
								>{{ t('profileComments.save') }}</UButton
							>
						</div>
					</form>
					<p
						v-else
						class="comment-thread__body"
						:class="{ 'comment-thread__deleted': comment.deleted }"
					>
						{{ comment.deleted ? t('profileComments.deleted') : comment.body }}
					</p>
					<div class="comment-thread__meta">
						<time :datetime="comment.createdAt">{{
							date(comment.createdAt)
						}}</time
						><UButton
							v-if="!comment.deleted && !root.deleted"
							type="button"
							color="neutral"
							variant="link"
							size="xs"
							class="comment-thread__reply"
							:disabled="busy || !!mutationId"
							@click="emit('reply', root.id)"
							>{{ t('comments.reply') }}</UButton
						>
					</div>
				</div>
			</div>
			<UButton
				v-if="replies(root.id).length > 1"
				type="button"
				variant="link"
				color="neutral"
				size="xs"
				class="comment-thread__expand"
				:aria-expanded="expanded.includes(root.id)"
				@click="toggle(root.id)"
				>{{
					expanded.includes(root.id)
						? t('comments.collapseReplies')
						: t('comments.expandReplies', {
								count: replies(root.id).length - 1,
							})
				}}</UButton
			>
		</li>
	</ol>
	<UModal
		:open="!!deletingId"
		:title="t('profileComments.deleteTitle')"
		:dismissible="!mutationId"
		:close="!mutationId"
		@update:open="closeDelete"
	>
		<template #body
			><p class="comment-thread__delete-hint">
				{{ t('profileComments.deleteHint') }}
			</p>
			<p v-if="message" class="error" role="alert">{{ message }}</p></template
		>
		<template #footer
			><div class="comment-thread__edit-actions">
				<UButton
					color="neutral"
					variant="ghost"
					:disabled="!!mutationId"
					@click="closeDelete(false)"
					>{{ t('profileComments.cancel') }}</UButton
				><UButton
					color="neutral"
					variant="soft"
					:loading="!!mutationId"
					:disabled="!!mutationId"
					@click="confirmDelete"
					>{{ t('profileComments.delete') }}</UButton
				>
			</div></template
		>
	</UModal>
</template>
<style scoped>
.comment-thread,
.comment-thread__replies {
	margin: 0;
	padding: 0;
	list-style: none;
}
.comment-thread {
	display: flex;
	flex-direction: column;
	gap: 26px;
}
.comment-thread__item {
	min-width: 0;
	border: 0;
	background: transparent;
	box-shadow: none;
}
.comment-thread__row {
	background: transparent;
	border: 0;
	box-shadow: none;
	display: flex;
	align-items: flex-start;
	gap: 11px;
	min-width: 0;
}
.comment-thread__avatar {
	display: inline-flex;
	flex: 0 0 auto;
	margin-top: 1px;
	border-radius: 50%;
}
.comment-thread__avatar :deep(.avatar) {
	width: 32px;
	height: 32px;
	font-size: 13px;
}
.comment-thread__content {
	flex: 1;
	min-width: 0;
}
.comment-thread__byline {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 7px;
	min-height: 20px;
	margin-bottom: 4px;
}
.comment-thread__name {
	color: var(--muted);
	font-size: 12px;
	font-weight: 400;
	line-height: 1.5;
	overflow-wrap: anywhere;
}
.comment-thread__name:hover {
	color: var(--ink);
}
.comment-thread__author {
	color: var(--muted);
	background: var(--surface-raised);
	padding: 1px 5px;
	border-radius: 4px;
	font-size: 10px;
	line-height: 1.5;
	flex-shrink: 0;
}
.comment-thread__body {
	margin: 0;
	color: var(--ink);
	font-size: 14px;
	font-weight: 400;
	line-height: 1.7;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.comment-thread__meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 13px;
	margin-top: 5px;
	color: var(--muted);
	font-size: 11px;
	line-height: 1.6;
}
.comment-thread__reply {
	min-height: 24px;
	margin: 0;
	padding: 0;
	color: var(--muted);
	font-size: 11px;
	font-weight: 400;
	background: transparent;
	border: 0;
	box-shadow: none;
	text-decoration: none;
}
.comment-thread__reply:hover {
	color: var(--ink);
	text-decoration: none;
}
.comment-thread__replies {
	background: transparent;
	border: 0;
	box-shadow: none;
	display: flex;
	flex-direction: column;
	gap: 18px;
	margin-top: 15px;
}
.comment-thread__row--reply {
	margin: 15px 0 0 43px;
	gap: 9px;
}
.comment-thread__row--reply .comment-thread__avatar :deep(.avatar) {
	width: 24px;
	height: 24px;
	font-size: 10px;
}
.comment-thread__row--reply .comment-thread__byline {
	margin-bottom: 2px;
	min-height: 18px;
}
.comment-thread__row--reply .comment-thread__body {
	font-size: 13px;
}
.comment-thread__expand {
	display: inline-flex;
	min-height: 22px;
	margin: 8px 0 0 43px;
	padding: 0;
	color: var(--muted);
	font-size: 12px;
	font-weight: 400;
	text-decoration: none;
	background: transparent;
	border: 0;
	box-shadow: none;
}
.comment-thread__expand:hover {
	color: var(--ink);
	text-decoration: none;
}
@media (max-width: 767px) {
	.comment-thread {
		gap: 24px;
	}
	.comment-thread__body {
		font-size: 14px;
	}
	.comment-thread__meta {
		gap: 15px;
	}
	.comment-thread__reply {
		min-height: 28px;
	}
	.comment-thread__expand {
		min-height: 26px;
	}
}

.comment-thread__avatar:hover,
.comment-thread__name:hover {
	text-decoration: none;
	filter: brightness(0.9);
	opacity: 0.8;
}
.comment-thread__menu {
	margin-left: auto;
	padding: 0;
	min-height: 22px;
	color: var(--muted);
	background: transparent;
}
.comment-thread__deleted {
	color: var(--muted);
	font-size: 13px;
}
.comment-thread__editor {
	margin: 4px 0 0;
}
.comment-thread__editor .error {
	font-size: 12px;
	margin: 6px 0;
}
.comment-thread__edit-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 8px;
	width: 100%;
}
.comment-thread__delete-hint {
	margin: 0;
	color: var(--muted);
	font-size: 14px;
	line-height: 1.7;
}
</style>
