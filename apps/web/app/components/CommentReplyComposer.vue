<script setup lang="ts">
import type { MediaAsset, PublicUser } from '@campus/contracts'
interface ReplyComposerProps {
	postId: string
	parentId: string
	commentId: string
	replyName: string
	user: PublicUser
	onRefresh: () => Promise<void>
}
interface ReplyDraft {
	body: string
	media: MediaAsset[]
	operationId: string
}
const props = defineProps<ReplyComposerProps>()
const emit = defineEmits<{ cancel: []; sent: [] }>()
const { t } = useI18n()
const apiError = useApiError()
const { openAuth } = useAuthOverlay()
const inputId = `comment-reply-${useId()}`
const drafts = useState<Record<string, ReplyDraft>>(
	'comment-reply-drafts',
	() => ({}),
)
const draftKey = `${props.user.id}:${props.postId}:${props.commentId}`
drafts.value[draftKey] ??= { body: '', media: [], operationId: '' }
const draft = computed(() => drafts.value[draftKey]!)
const busy = ref(false)
const uploading = ref(false)
const message = ref('')
let disposed = false
onBeforeUnmount(() => {
	disposed = true
})
watch(
	() => [draft.value.body, draft.value.media],
	() => {
		if (!busy.value) draft.value.operationId = ''
	},
	{ deep: true },
)
async function submit() {
	if (
		busy.value ||
		uploading.value ||
		(!draft.value.body.trim() && !draft.value.media.length)
	)
		return
	busy.value = true
	message.value = ''
	draft.value.operationId ||= crypto.randomUUID()
	try {
		await $fetch('/api/comments', {
			method: 'POST',
			body: {
				postId: props.postId,
				parentId: props.parentId,
				body: draft.value.body,
				mediaIds: draft.value.media.map((asset) => asset.id),
				operationId: draft.value.operationId,
			},
		})
		drafts.value[draftKey] = { body: '', media: [], operationId: '' }
		if (disposed) return
		await props.onRefresh()
		if (!disposed) emit('sent')
	} catch (failure) {
		if (disposed) return
		message.value = apiError(failure)
		const response = failure as {
			data?: { data?: { code?: string }; code?: string }
		}
		if ((response.data?.data?.code ?? response.data?.code) === 'UNAUTHORIZED')
			void openAuth()
	} finally {
		busy.value = false
	}
}
</script>
<template>
	<div class="comment-reply-composer">
		<UserAvatar :src="user.avatar" :name="user.name" />
		<form @submit.prevent="submit">
			<div class="comment-reply-composer__context">
				<span>{{ t('comments.replying', { name: replyName }) }}</span>
				<UButton
					variant="link"
					color="neutral"
					size="xs"
					:disabled="busy || uploading"
					@click="emit('cancel')"
					>{{ t('ui.cancel') }}</UButton
				>
			</div>
			<UTextarea
				:id="inputId"
				v-model="draft.body"
				class="w-full"
				:rows="1"
				:maxrows="6"
				autoresize
				:maxlength="2000"
				:disabled="busy"
				:placeholder="t('comments.replyPlaceholder', { name: replyName })"
				:aria-label="t('comments.replyPlaceholder', { name: replyName })"
			/>
			<MessageMediaPicker
				v-model="draft.media"
				:disabled="busy"
				@busy="uploading = $event"
			/>
			<p v-if="message" class="error" role="alert">{{ message }}</p>
			<div class="comment-reply-composer__actions">
				<UButton
					type="submit"
					color="neutral"
					variant="soft"
					size="sm"
					:loading="busy"
					:disabled="
						busy || uploading || (!draft.body.trim() && !draft.media.length)
					"
					>{{ t('ui.send') }}</UButton
				>
			</div>
		</form>
	</div>
</template>
<style scoped>
.comment-reply-composer {
	display: flex;
	align-items: flex-start;
	gap: 10px;
}
.comment-reply-composer :deep(.avatar) {
	width: 24px;
	height: 24px;
	flex: 0 0 auto;
}
.comment-reply-composer form {
	flex: 1;
	min-width: 0;
}
.comment-reply-composer__context {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	margin-bottom: 6px;
	color: var(--muted);
	font-size: 11px;
}
.comment-reply-composer__context button {
	padding: 0;
}
.comment-reply-composer__actions {
	display: flex;
	justify-content: flex-end;
	margin-top: 8px;
}
.comment-reply-composer .error {
	margin: 6px 0;
	font-size: 12px;
}
</style>
