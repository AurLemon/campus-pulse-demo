<script setup lang="ts">
import type {
	ConversationView,
	ConversationPage,
	ConversationMessages,
	DirectMessageView,
	NotificationView,
} from '@campus/contracts/messages'
import type { MediaAsset } from '@campus/contracts'
const { t } = useI18n()
const { user } = await useCampus()
const { openAuth } = useAuthOverlay()
const route = useRoute()
const date = useCampusDate()
const apiError = useApiError()
const conversations = ref<ConversationView[]>([])
const conversationCursor = ref<string | null>(null)
const conversationHasMore = ref(false)
const loadingConversations = ref(false)
const inboxLoaded = ref(false)
let loadedOlderConversations = false
function mergeConversations(rows: ConversationView[]) {
	const merged = new Map(conversations.value.map((row) => [row.id, row]))
	for (const row of rows) merged.set(row.id, row)
	conversations.value = [...merged.values()].sort(
		(a, b) =>
			b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
	)
}
const notifications = ref<NotificationView[]>([])
const selected = ref<string | null>(null)
const category = ref('reactions')
const mobileDetail = ref(false)
const items = ref<DirectMessageView[]>([])
interface ComposerInput {
	textareaRef: HTMLTextAreaElement | null
}
const composerInput = useTemplateRef<ComposerInput>('composerInput')
const composerForm = useTemplateRef<HTMLFormElement>('composerForm')
const draft = ref('')
const media = ref<MediaAsset[]>([])
const error = ref('')
const busy = ref(false)
const uploading = ref(false)
const clientMessageId = ref('')
const conversationDrafts = new Map<
	string,
	{ body: string; media: MediaAsset[]; clientMessageId: string }
>()
let restoringDraft = false
watch(
	selected,
	(current, previous) => {
		restoringDraft = true
		if (previous)
			conversationDrafts.set(previous, {
				body: draft.value,
				media: [...media.value],
				clientMessageId: clientMessageId.value,
			})
		const saved = current ? conversationDrafts.get(current) : undefined
		draft.value = saved?.body ?? ''
		media.value = saved?.media ?? []
		clientMessageId.value = saved?.clientMessageId ?? ''
		void nextTick(() => {
			restoringDraft = false
		})
	},
	{ flush: 'sync' },
)
function backToList() {
	if (busy.value || uploading.value) return
	selected.value = null
	category.value = 'reactions'
	mobileDetail.value = false
}
const thread = ref<HTMLElement>()
const viewportStyle = ref<Record<string, string>>()
function updateViewport() {
	const viewport = window.visualViewport
	if (!viewport) return
	const visibleBottom = viewport.height + viewport.offsetTop
	viewportStyle.value = {
		'--messages-visible-bottom': `${visibleBottom}px`,
		'--messages-keyboard-inset': `${Math.max(0, document.documentElement.clientHeight - visibleBottom)}px`,
	}
}
const active = computed(() =>
	conversations.value.find((row) => row.id === selected.value),
)
const categories = [
	{ id: 'reactions', icon: 'i-lucide-heart', kinds: ['LIKE', 'FAVORITE'] },
	{ id: 'follows', icon: 'i-lucide-user-plus', kinds: ['FOLLOW'] },
	{
		id: 'comments',
		icon: 'i-lucide-message-circle',
		kinds: ['COMMENT', 'REPLY'],
	},
]
const visibleNotifications = computed(() =>
	notifications.value.filter((row) =>
		categories
			.find((group) => group.id === category.value)
			?.kinds.includes(row.kind),
	),
)
let timer: ReturnType<typeof setInterval> | undefined
let readTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
let polling = false
let nextInboxAt = 0
let nextPollAt = 0
let generation = 0
let identityVersion = 0
let requests = new AbortController()
const acknowledged = new Map<string, number>()
function currentIdentity(id: string | undefined, version: number) {
	return !disposed && user.value?.id === id && identityVersion === version
}
async function refreshInbox() {
	const actorId = user.value?.id
	if (!actorId) return
	const version = identityVersion
	const result = await $fetch<{
		conversations: ConversationView[]
		notifications: NotificationView[]
		conversationNextCursor: string | null
		conversationHasMore: boolean
	}>('/api/messages', { signal: requests.signal })
	if (!currentIdentity(actorId, version)) return
	mergeConversations(result.conversations)
	if (!loadedOlderConversations) {
		conversationCursor.value = result.conversationNextCursor
		conversationHasMore.value = result.conversationHasMore
	}
	const selectedId = selected.value
	if (
		selectedId &&
		!result.conversations.some((row) => row.id === selectedId)
	) {
		const metadata = await $fetch<ConversationView>(
			`/api/messages/${selectedId}/meta`,
			{ signal: requests.signal },
		)
		if (!currentIdentity(actorId, version)) return
		mergeConversations([metadata])
	}
	notifications.value = result.notifications
	inboxLoaded.value = true
	nextInboxAt = Date.now() + 5000
}
async function poll() {
	if (
		polling ||
		document.hidden ||
		!user.value ||
		Date.now() < nextPollAt ||
		(!selected.value && Date.now() < nextInboxAt)
	)
		return
	const actorId = user.value.id,
		version = identityVersion
	polling = true
	try {
		if (selected.value) await loadMessages(selected.value)
		if (currentIdentity(actorId, version) && Date.now() >= nextInboxAt)
			await refreshInbox()
	} catch (failure) {
		if (currentIdentity(actorId, version)) {
			nextPollAt = Date.now() + 3000
			error.value = apiError(failure)
		}
	} finally {
		polling = false
	}
}
async function acknowledgeVisible() {
	const id = selected.value,
		actorId = user.value?.id,
		version = identityVersion,
		current = generation
	const viewport = thread.value
	if (!id || !actorId || !viewport || document.hidden) return
	const bounds = viewport.getBoundingClientRect()
	const visibleTop = Math.max(0, bounds.top)
	const visibleBottom = Math.min(window.innerHeight, bounds.bottom)
	if (visibleBottom <= visibleTop) return
	let sequence = acknowledged.get(id) ?? 0
	for (const row of viewport.querySelectorAll<HTMLElement>(
		'[data-message-sequence]',
	)) {
		const rectangle = row.getBoundingClientRect()
		if (rectangle.bottom > visibleTop && rectangle.top < visibleBottom)
			sequence = Math.max(sequence, Number(row.dataset.messageSequence) || 0)
	}
	if (sequence <= (acknowledged.get(id) ?? 0)) return
	await $fetch(`/api/messages/${id}/read`, {
		method: 'POST',
		body: { sequence },
		signal: requests.signal,
	})
	if (currentIdentity(actorId, version) && generation === current)
		acknowledged.set(id, Math.max(sequence, acknowledged.get(id) ?? 0))
}
function onThreadScroll() {
	clearTimeout(readTimer)
	readTimer = setTimeout(() => {
		const actorId = user.value?.id,
			version = identityVersion
		void acknowledgeVisible().catch((failure) => {
			if (currentIdentity(actorId, version)) error.value = apiError(failure)
		})
	}, 200)
}
async function loadMessages(id: string, forceScroll = false) {
	const current = generation,
		actorId = user.value?.id,
		version = identityVersion
	const viewport = thread.value
	const nearBottom =
		!viewport ||
		viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 80
	let after = items.value.at(-1)?.sequence ?? 0
	let more = true
	while (more && selected.value === id) {
		const result = await $fetch<ConversationMessages>(`/api/messages/${id}`, {
			query: { after },
			signal: requests.signal,
		})
		if (
			!currentIdentity(actorId, version) ||
			generation !== current ||
			selected.value !== id
		)
			return
		const known = new Set(items.value.map((row) => row.id))
		items.value.push(...result.items.filter((row) => !known.has(row.id)))
		after = result.nextSequence
		more = result.hasMore
	}
	await nextTick()
	if (
		!currentIdentity(actorId, version) ||
		generation !== current ||
		selected.value !== id ||
		document.hidden
	)
		return
	if (thread.value && (forceScroll || nearBottom))
		thread.value.scrollTop = thread.value.scrollHeight
	await acknowledgeVisible()
}
async function choose(id: string) {
	if (busy.value || uploading.value) return
	const actorId = user.value?.id,
		version = identityVersion,
		current = ++generation
	error.value = ''
	try {
		const metadata = await $fetch<ConversationView>(
			`/api/messages/${id}/meta`,
			{ signal: requests.signal },
		)
		if (!currentIdentity(actorId, version) || generation !== current) return
		mergeConversations([metadata])
		selected.value = id
		mobileDetail.value = true
		category.value = ''
		items.value = []
		await loadMessages(id, true)
		if (currentIdentity(actorId, version)) await refreshInbox()
	} catch (failure) {
		if (currentIdentity(actorId, version)) error.value = apiError(failure)
	}
}
async function loadMoreConversations() {
	if (
		loadingConversations.value ||
		!conversationHasMore.value ||
		!conversationCursor.value
	)
		return
	const actorId = user.value?.id,
		version = identityVersion,
		cursor = conversationCursor.value
	loadingConversations.value = true
	error.value = ''
	try {
		const page = await $fetch<ConversationPage>('/api/messages/conversations', {
			query: { cursor },
			signal: requests.signal,
		})
		if (!currentIdentity(actorId, version)) return
		mergeConversations(page.items)
		conversationCursor.value = page.nextCursor
		conversationHasMore.value = page.hasMore
		loadedOlderConversations = true
	} catch (failure) {
		if (currentIdentity(actorId, version)) error.value = apiError(failure)
	} finally {
		if (currentIdentity(actorId, version)) loadingConversations.value = false
	}
}
async function readAllNotifications() {
	const actorId = user.value?.id,
		version = identityVersion
	try {
		await $fetch('/api/messages/notifications/read', {
			method: 'POST',
			body: { all: true },
			signal: requests.signal,
		})
		if (currentIdentity(actorId, version)) await refreshInbox()
	} catch (failure) {
		if (currentIdentity(actorId, version)) error.value = apiError(failure)
	}
}
async function showCategory(id: string) {
	if (busy.value || uploading.value) return
	const actorId = user.value?.id,
		version = identityVersion
	generation++
	selected.value = null
	category.value = id
	mobileDetail.value = true
	const unread = visibleNotifications.value
		.filter((row) => !row.read)
		.map((row) => row.id)
	if (!unread.length) return
	try {
		await $fetch('/api/messages/notifications/read', {
			method: 'POST',
			body: { ids: unread },
			signal: requests.signal,
		})
		if (currentIdentity(actorId, version)) await refreshInbox()
	} catch (failure) {
		if (currentIdentity(actorId, version)) error.value = apiError(failure)
	}
}
function onComposerKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault()
		void send()
	}
}
async function send() {
	if (
		!selected.value ||
		busy.value ||
		uploading.value ||
		(!draft.value.trim() && !media.value.length)
	)
		return
	const actorId = user.value?.id,
		version = identityVersion,
		id = selected.value,
		current = generation
	const textarea = composerInput.value?.textareaRef
	const form = composerForm.value
	let restoreFocus = !!textarea && !!form?.contains(document.activeElement)
	const focusEvents = new AbortController()
	function cancelFocusRestore(event: Event) {
		if (
			event.target instanceof Node &&
			!form?.contains(event.target) &&
			(event.type === 'pointerdown' || event.target !== document.body)
		)
			restoreFocus = false
	}
	document.addEventListener('pointerdown', cancelFocusRestore, {
		capture: true,
		signal: focusEvents.signal,
	})
	document.addEventListener('focusin', cancelFocusRestore, {
		signal: focusEvents.signal,
	})
	if (restoreFocus) textarea?.focus({ preventScroll: true })
	busy.value = true
	error.value = ''
	clientMessageId.value ||= crypto.randomUUID()
	try {
		await $fetch<DirectMessageView>('/api/messages/' + id, {
			method: 'POST',
			body: {
				body: draft.value,
				mediaIds: media.value.map((row) => row.id),
				clientMessageId: clientMessageId.value,
			},
			signal: requests.signal,
		})
		if (
			!currentIdentity(actorId, version) ||
			generation !== current ||
			selected.value !== id
		)
			return
		draft.value = ''
		media.value = []
		clientMessageId.value = ''
		await loadMessages(id, true)
		if (currentIdentity(actorId, version)) await refreshInbox()
	} catch (failure) {
		if (currentIdentity(actorId, version)) error.value = apiError(failure)
	} finally {
		if (currentIdentity(actorId, version)) busy.value = false
		await nextTick()
		if (
			restoreFocus &&
			currentIdentity(actorId, version) &&
			generation === current &&
			selected.value === id &&
			document.hasFocus() &&
			(document.activeElement === document.body ||
				!!form?.contains(document.activeElement))
		)
			textarea?.focus({ preventScroll: true })
		focusEvents.abort()
	}
}
watch(
	[draft, media],
	() => {
		if (!busy.value && !restoringDraft) clientMessageId.value = ''
	},
	{ deep: true },
)
function visibility() {
	if (!document.hidden) void poll()
}
async function openRequestedPeer() {
	const peer = typeof route.query.to === 'string' ? route.query.to : null
	const actorId = user.value?.id,
		version = identityVersion
	if (!peer || !actorId) return
	try {
		const row = await $fetch<{ id: string }>('/api/messages', {
			method: 'POST',
			body: { peerId: peer },
			signal: requests.signal,
		})
		if (!currentIdentity(actorId, version)) return
		await refreshInbox()
		if (currentIdentity(actorId, version)) await choose(row.id)
	} catch (failure) {
		if (currentIdentity(actorId, version)) error.value = apiError(failure)
	}
}
onMounted(() => {
	updateViewport()
	window.visualViewport?.addEventListener('resize', updateViewport)
	window.visualViewport?.addEventListener('scroll', updateViewport)
	window.addEventListener('resize', updateViewport)
	timer = setInterval(() => void poll(), 1000)
	document.addEventListener('visibilitychange', visibility)
	void poll()
	void openRequestedPeer()
})
watch(
	() => route.query.to,
	() => {
		if (import.meta.client) void openRequestedPeer()
	},
)
onBeforeUnmount(() => {
	disposed = true
	generation++
	identityVersion++
	requests.abort()
	clearInterval(timer)
	clearTimeout(readTimer)
	document.removeEventListener('visibilitychange', visibility)
	window.visualViewport?.removeEventListener('resize', updateViewport)
	window.visualViewport?.removeEventListener('scroll', updateViewport)
	window.removeEventListener('resize', updateViewport)
})
watch(
	() => user.value?.id,
	() => {
		generation++
		identityVersion++
		nextInboxAt = 0
		nextPollAt = 0
		requests.abort()
		requests = new AbortController()
		clearTimeout(readTimer)
		selected.value = null
		conversationDrafts.clear()
		conversationCursor.value = null
		conversationHasMore.value = false
		loadingConversations.value = false
		loadedOlderConversations = false
		acknowledged.clear()
		category.value = 'reactions'
		mobileDetail.value = false
		items.value = []
		conversations.value = []
		notifications.value = []
		inboxLoaded.value = false
		draft.value = ''
		media.value = []
		clientMessageId.value = ''
		error.value = ''
		busy.value = false
		uploading.value = false
		if (import.meta.client && user.value) {
			void poll()
			void openRequestedPeer()
		}
	},
	{ flush: 'sync' },
)
</script>
<template>
	<section class="messages-page" :style="viewportStyle">
		<UButton v-if="!user" color="neutral" variant="soft" @click="openAuth()">{{
			t('messages.login')
		}}</UButton>
		<div
			v-else
			class="messages-layout"
			:class="{
				'has-detail': mobileDetail,
				'has-conversation': selected,
			}"
		>
			<aside class="messages-list">
				<UButton
					v-if="notifications.some((row) => !row.read)"
					color="neutral"
					variant="ghost"
					size="xs"
					@click="readAllNotifications"
					>{{ t('messages.readAll') }}</UButton
				>
				<button
					v-for="group in categories"
					:key="group.id"
					class="messages-category"
					:class="{ selected: category === group.id }"
					:aria-pressed="category === group.id"
					@click="showCategory(group.id)"
				>
					<UIcon :name="group.icon" /><span>{{
						t(`messages.${group.id}`)
					}}</span
					><b
						v-if="
							notifications.some(
								(row) => group.kinds.includes(row.kind) && !row.read,
							)
						"
						class="unread-dot"
					/>
				</button>
				<h2>{{ t('messages.direct') }}</h2>
				<button
					v-for="row in conversations"
					:key="row.id"
					class="conversation-row"
					:class="{ selected: row.id === selected }"
					@click="choose(row.id)"
				>
					<UserAvatar :src="row.peer.avatar" :name="row.peer.name" /><span
						class="conversation-copy"
						><strong
							>{{ row.peer.name
							}}<i v-if="row.online" class="online-dot" /></strong
						><small>{{
							row.lastMessage?.body ||
							(row.lastMessage?.media.length
								? t('messages.image')
								: t('messages.start'))
						}}</small></span
					><b v-if="row.unread">{{ row.unread }}</b>
				</button>
				<UButton
					v-if="conversationHasMore"
					color="neutral"
					variant="ghost"
					class="w-full"
					:loading="loadingConversations"
					:disabled="loadingConversations"
					@click="loadMoreConversations"
					>{{ t('messages.moreConversations') }}</UButton
				>
				<p
					v-if="inboxLoaded && !conversations.length"
					class="inbox-empty muted"
				>
					{{ t('messages.empty') }}
				</p>
			</aside>
			<div v-if="selected || category" class="messages-detail">
				<UButton
					v-if="selected || category"
					:disabled="busy || uploading"
					class="messages-back"
					icon="i-lucide-arrow-left"
					color="neutral"
					variant="ghost"
					@click="backToList"
					>{{ t('ui.back') }}</UButton
				>
				<template v-if="selected"
					><header>
						<UserAvatar
							:src="active?.peer.avatar"
							:name="active?.peer.name ?? ''"
						/>
						<NuxtLink :to="`/users/${active?.peer.id}`">{{
							active?.peer.name
						}}</NuxtLink
						><i
							v-if="active?.online"
							class="online-dot"
							:aria-label="t('messages.online')"
						/>
					</header>
					<div
						ref="thread"
						class="messages-thread"
						@scroll.passive="onThreadScroll"
						role="log"
						aria-live="polite"
					>
						<article
							v-for="row in items"
							:key="row.id"
							class="message-bubble"
							:data-message-sequence="row.sequence"
							:class="{ 'is-mine': row.senderId === user.id }"
						>
							<p v-if="row.body">{{ row.body }}</p>
							<a
								v-for="asset in row.media"
								:key="asset.id"
								:href="asset.url"
								target="_blank"
								rel="noopener"
								><img
									:src="asset.url"
									:alt="asset.alt"
									:width="asset.width"
									:height="asset.height" /></a
							><time>{{ date(row.createdAt) }}</time>
						</article>
						<div v-if="!items.length" class="thread-empty muted">
							<UIcon name="i-lucide-messages-square" />
							<p>{{ t('messages.start') }}</p>
						</div>
					</div>
					<form
						ref="composerForm"
						class="message-composer"
						@submit.prevent="send"
					>
						<UTextarea
							ref="composerInput"
							v-model="draft"
							class="w-full"
							:maxlength="2000"
							:rows="2"
							autoresize
							:maxrows="5"
							:ui="{
								base: 'resize-none ring-0 focus-visible:ring-0 bg-transparent shadow-none',
							}"
							@keydown="onComposerKeydown"
							:placeholder="t('messages.placeholder')"
							:readonly="busy"
						/><MessageMediaPicker
							v-model="media"
							:scope="`${user.id}:${selected}`"
							:disabled="busy"
							@busy="uploading = $event"
						/><UButton
							type="submit"
							color="primary"
							variant="solid"
							icon="i-lucide-arrow-up"
							:loading="busy"
							:disabled="busy || uploading || (!draft.trim() && !media.length)"
							>{{ t('ui.send') }}</UButton
						>
					</form></template
				>
				<div v-else-if="category" class="notifications">
					<article v-for="row in visibleNotifications" :key="row.id">
						<UserAvatar
							:src="row.actor?.avatar"
							:name="row.actor?.name ?? t('messages.deletedUser')"
						/>
						<div>
							<NuxtLink v-if="row.actor" :to="`/users/${row.actor.id}`">{{
								row.actor.name
							}}</NuxtLink
							><span v-else>{{ t('messages.deletedUser') }}</span>
							<p>{{ t(`messages.kind${row.kind}`) }}</p>
							<NuxtLink v-if="row.targetUrl" :to="row.targetUrl">{{
								t('messages.view')
							}}</NuxtLink
							><small v-else>{{ t('messages.unavailable') }}</small
							><time>{{ date(row.createdAt) }}</time>
						</div>
					</article>
					<p v-if="!visibleNotifications.length" class="muted">
						{{ t('messages.noNotifications') }}
					</p>
				</div>
			</div>
		</div>
		<p v-if="error" class="error" role="alert">{{ error }}</p>
	</section>
</template>
<style scoped>
.messages-page {
	display: flex;
	flex-direction: column;
	height: var(--messages-visible-bottom, 100dvh);
	max-height: 100%;
	min-height: 0;
	overflow: hidden;
	width: 100%;
	margin: 0;
	padding: 0;
}
.messages-layout {
	display: grid;
	grid-template-columns: clamp(260px, 22vw, 320px) minmax(0, 1fr);
	gap: 0;
	min-height: 0;
	flex: 1;
	overflow: hidden;
}
.messages-list {
	min-width: 0;
	min-height: 0;
	overscroll-behavior: contain;
	padding: 16px;
	overflow-y: auto;
}
.messages-list h2 {
	margin: 28px 12px 10px;
	font-size: 12px;
	font-weight: 500;
	color: var(--muted);
}
.messages-category,
.conversation-row {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 13px 12px;
	border: 0;
	border-radius: 12px;
	text-align: left;
	background: transparent;
	cursor: pointer;
	transition: background-color 150ms ease;
}
.messages-category {
	min-height: 52px;
	margin-bottom: 4px;
	font-size: 14px;
}
.messages-category.selected,
.messages-category:hover,
.conversation-row:hover,
.conversation-row.selected {
	background: var(--surface-raised);
}
.messages-category > .iconify {
	width: 22px;
	height: 22px;
	flex-shrink: 0;
}
.conversation-copy {
	display: flex;
	flex: 1;
	min-width: 0;
	flex-direction: column;
	gap: 5px;
}
.conversation-copy strong {
	font-size: 14px;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.conversation-copy small {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--muted);
	font-size: 12px;
}
.conversation-row > b {
	font-size: 11px;
	background: var(--accent);
	color: white;
	border-radius: 20px;
	min-width: 20px;
	text-align: center;
}
.online-dot,
.unread-dot {
	display: inline-block;
	flex-shrink: 0;
	width: 7px;
	height: 7px;
	background: #33a66c;
	border-radius: 50%;
	margin-left: 7px;
}
.unread-dot {
	background: var(--accent);
	margin-left: auto;
}
.messages-detail {
	min-width: 0;
	height: 100%;
	min-height: 0;
	display: flex;
	flex-direction: column;
	border-left: 1px solid var(--ui-border-muted);
	overflow: hidden;
}
.messages-detail header {
	display: flex;
	gap: 10px;
	align-items: center;
	padding: 16px 24px;
	min-height: 68px;
	border-bottom: 1px solid var(--ui-border-muted);
	flex-shrink: 0;
	font-size: 14px;
	font-weight: 500;
}
.messages-detail header a {
	color: inherit;
	text-decoration: none;
}
.muted {
	color: var(--muted);
	font-size: 13px;
}
.messages-thread {
	display: flex;
	flex-direction: column;
	gap: 18px;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 24px;
	min-height: 0;
	flex: 1;
}
.thread-empty {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	gap: 14px;
}
.thread-empty > .iconify {
	width: 36px;
	height: 36px;
	opacity: 0.5;
}
.message-bubble {
	align-self: flex-start;
	max-width: min(85%, 480px);
	padding: 12px 16px 8px;
	background: var(--surface-raised);
	border-radius: 16px 16px 16px 4px;
}
.message-bubble.is-mine {
	align-self: flex-end;
	background: color-mix(in srgb, var(--accent) 16%, var(--canvas));
	border-radius: 16px 16px 4px 16px;
}
.message-bubble p {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	margin: 0;
	font-size: 14px;
	line-height: 1.65;
}
.message-bubble img {
	width: auto;
	height: auto;
	max-width: 100%;
	max-height: 280px;
	border-radius: 10px;
	margin-top: 6px;
}
.message-bubble time,
.notifications time {
	display: block;
	font-size: 10px;
	color: var(--muted);
	margin-top: 6px;
}
.message-bubble time {
	text-align: right;
}
.message-composer {
	max-height: 50%;
	overflow-y: auto;
	overscroll-behavior: contain;
	margin: 0 20px 12px;
	padding: 10px 12px;
	border: 1px solid var(--ui-border-muted);
	border-radius: 16px;
	background: var(--surface);
	display: grid;
	grid-template-columns: 1fr auto;
	align-items: end;
	gap: 8px;
	flex-shrink: 0;
}
.message-composer:focus-within {
	border-color: var(--muted);
}
.message-composer :deep(textarea:focus),
.message-composer :deep(textarea:focus-visible) {
	outline: none;
	box-shadow: none;
}
.message-composer > :first-child {
	grid-column: 1 / -1;
}
.message-composer > button {
	align-self: end;
	min-height: 36px;
	border-radius: 10px;
}
.notifications {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 24px;
}
.notifications article {
	display: flex;
	gap: 12px;
	padding: 16px 0;
}
.notifications p {
	margin: 6px 0;
}
.notifications > .muted:only-child {
	display: grid;
	place-items: center;
	height: 100%;
	min-height: 0;
	margin: 0;
}
.inbox-empty {
	padding: 24px 12px;
	text-align: center;
}
.messages-list > .conversation-row + .conversation-row {
	margin-top: 4px;
}
.messages-back {
	display: none;
}
.messages-list,
.messages-thread,
.message-composer,
.notifications {
	scrollbar-width: none;
}
.messages-list::-webkit-scrollbar,
.messages-thread::-webkit-scrollbar,
.message-composer::-webkit-scrollbar,
.notifications::-webkit-scrollbar {
	display: none;
}
@media (min-width: 768px) {
	.messages-list h2 {
		margin: 24px 12px 8px;
	}
	.messages-category,
	.conversation-row {
		justify-content: flex-start;
	}
}
@media (max-width: 767px) {
	.messages-page {
		height: calc(
			var(--messages-visible-bottom, 100dvh) - 83px -
				max(
					0px,
					calc(
						86px + env(safe-area-inset-bottom) -
							var(--messages-keyboard-inset, 0px)
					)
				)
		);
	}
	.messages-layout {
		display: block;
	}
	.messages-list {
		height: 100%;
		padding: 0;
	}
	.messages-detail {
		display: none;
		border: 0;
	}
	.has-detail .messages-list {
		display: none;
	}
	.has-detail .messages-detail {
		display: flex;
	}
	.messages-back {
		display: flex;
		align-self: flex-start;
		flex-shrink: 0;
	}
	.messages-detail header {
		padding: 12px 8px;
	}
	.messages-thread {
		padding: 16px 4px;
	}
	.message-composer {
		margin: 0 0 8px;
	}
}
@media (prefers-reduced-motion: reduce) {
	.messages-category,
	.conversation-row {
		transition: none;
	}
}
</style>
