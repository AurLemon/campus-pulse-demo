<script setup lang="ts">
import type { UserDetail } from '@campus/contracts'
const { openAuth } = useAuthOverlay()
const apiError = useApiError()

const { t } = useI18n(),
	{ topicLabel } = useTopics(),
	route = useRoute(),
	fetcher = useRequestFetch(),
	{ user } = await useCampus()
const tab = ref(String(route.query.tab ?? 'posts'))
const { data, error, refresh } = await useAsyncData(
	`profile-${route.params.id}`,
	() =>
		fetcher<UserDetail>(`/api/users/${route.params.id}`, {
			query: { tab: tab.value },
		}),
	{ watch: [tab] },
)
if (error.value)
	throw createError({ statusCode: 404, statusMessage: 'Not found' })
const own = computed(() => user.value?.id === data.value?.user.id),
	busy = ref(false),
	message = ref('')
async function social(
	action: 'follow' | 'friend' | 'accept',
	targetId: string,
	active = true,
) {
	if (busy.value) return
	if (!user.value) {
		await openAuth()
		return
	}
	busy.value = true
	message.value = ''
	try {
		await $fetch('/api/actions', {
			method: 'POST',
			body: { action, targetId, active },
		})
		await refresh()
	} catch (e) {
		message.value = apiError(e)
	} finally {
		busy.value = false
	}
}
const interestOpen = ref(false),
	interestBusy = ref(false),
	interestSelection = ref<string[]>([]),
	interestMessage = ref('')
const { data: campus } = await useCampus()
function changeInterests(value: boolean) {
	if (interestBusy.value) return
	if (!value) {
		interestOpen.value = false
		return
	}
	interestMessage.value = ''
	interestSelection.value = Object.keys(data.value?.user.interests ?? {})
	interestOpen.value = true
}
function toggleInterest(tag: string) {
	interestSelection.value = interestSelection.value.includes(tag)
		? interestSelection.value.filter((t) => t !== tag)
		: [...interestSelection.value, tag]
}
async function saveInterests() {
	if (interestBusy.value) return
	interestBusy.value = true
	interestMessage.value = ''
	let saved = false
	try {
		await $fetch('/api/me/interests', {
			method: 'PATCH',
			body: {
				interests: Object.fromEntries(
					interestSelection.value.map((tag) => [tag, 1]),
				),
			},
		})
		saved = true
		await refresh()
		if (error.value) throw error.value
		await refreshNuxtData(['sidebar', 'campus'])
		interestOpen.value = false
	} catch (e) {
		interestMessage.value = saved
			? t('profileComments.savedRefreshPending')
			: apiError(e)
	} finally {
		interestBusy.value = false
	}
}

async function profileSaved() {
	message.value = ''
	try {
		await refresh()
		if (error.value) throw error.value
		await refreshNuxtData(['campus', 'sidebar'])
	} catch {
		message.value = t('profileComments.savedRefreshPending')
	}
}

const friendshipLabel = computed(() =>
	data.value?.relationship.friendship?.status === 'ACCEPTED'
		? 'ui.friendAccepted'
		: data.value?.relationship.friendship
			? 'ui.friendPending'
			: 'ui.friend',
)
</script>
<template>
	<div v-if="data" class="profile-page">
		<header class="profile-header">
			<UserAvatar :name="data.user.name" large />
			<div>
				<h1>{{ data.user.name }}</h1>
				<span class="profile-campus">{{ data.user.campus }}</span>
				<p class="muted">{{ data.user.bio || t('ui.bioEmpty') }}</p>
				<div class="tags">
					<span v-for="tag in Object.keys(data.user.interests)" :key="tag"
						>#{{ topicLabel(tag) }}</span
					>
				</div>
			</div>
		</header>
		<div v-if="!own" class="social-actions">
			<UButton
				:disabled="busy"
				:variant="data.relationship.following ? 'soft' : 'solid'"
				@click="social('follow', data.user.id, !data.relationship.following)"
				>{{
					t(data.relationship.following ? 'ui.unfollow' : 'ui.follow')
				}}</UButton
			><UButton
				variant="soft"
				color="neutral"
				:disabled="busy || !!data.relationship.friendship"
				@click="social('friend', data.user.id)"
				>{{ t(friendshipLabel) }}</UButton
			>
		</div>
		<div v-if="own" class="profile-settings profile-personal-actions">
			<ProfileEdit :profile="data.user" @saved="profileSaved" />
			<UButton
				v-if="user?.role !== 'STUDENT'"
				to="/admin"
				color="neutral"
				variant="ghost"
				>{{ t('ui.manage') }}</UButton
			>
			<UPopover
				:open="interestOpen"
				:dismissible="!interestBusy"
				:content="{ align: 'end', side: 'bottom' }"
				@update:open="changeInterests"
			>
				<UButton color="neutral" variant="soft" icon="i-lucide-tags">{{
					t('ui.interestEdit')
				}}</UButton>
				<template #content>
					<section class="profile-interest-popover">
						<h2>{{ t('profileComments.interestTitle') }}</h2>
						<div class="interest-tags">
							<button
								v-for="topic in campus?.topics"
								:key="topic"
								type="button"
								:class="{ selected: interestSelection.includes(topic) }"
								:aria-pressed="interestSelection.includes(topic)"
								:disabled="interestBusy"
								@click="toggleInterest(topic)"
							>
								{{ topicLabel(topic) }}
							</button>
						</div>
						<p v-if="interestMessage" class="error" role="alert">
							{{ interestMessage }}
						</p>
						<div class="profile-interest-actions">
							<UButton
								color="neutral"
								variant="ghost"
								:disabled="interestBusy"
								@click="interestOpen = false"
								>{{ t('ui.cancel') }}</UButton
							><UButton
								color="neutral"
								variant="soft"
								:loading="interestBusy"
								:disabled="interestBusy"
								@click="saveInterests"
								>{{ t('ui.save') }}</UButton
							>
						</div>
					</section>
				</template>
			</UPopover>
		</div>

		<p v-if="message" class="error" role="alert">{{ message }}</p>
		<section v-if="own && data.requests.length" class="friend-requests">
			<h2>{{ t('ui.requests') }}</h2>
			<div v-for="request in data.requests" :key="request.id">
				<NuxtLink :to="`/users/${request.requester.id}`" class="author"
					><UserAvatar :name="request.requester.name" />{{
						request.requester.name
					}}</NuxtLink
				><UButton
					size="sm"
					:disabled="busy"
					@click="social('accept', request.id)"
					>{{ t('ui.accept') }}</UButton
				>
			</div>
		</section>
		<div class="tabs">
			<button :class="{ active: tab === 'posts' }" @click="tab = 'posts'">
				{{ t('ui.myPosts') }}</button
			><button
				v-if="own"
				:class="{ active: tab === 'favorites' }"
				@click="tab = 'favorites'"
			>
				{{ t('ui.myFavorites') }}</button
			><button
				v-if="own"
				:class="{ active: tab === 'registrations' }"
				@click="tab = 'registrations'"
			>
				{{ t('ui.myRegistrations') }}
			</button>
		</div>
		<MasonryFeed v-if="data.posts.length" :items="data.posts"
			><template #default="{ item }"
				><PostCard :post="item" /></template></MasonryFeed
		><MasonryFeed v-if="data.activities.length" :items="data.activities"
			><template #default="{ item }"><ActivityCard :activity="item" /></template
		></MasonryFeed>
		<div
			v-if="!data.posts.length && !data.activities.length"
			class="empty-state"
		>
			<h2>{{ t('ui.empty') }}</h2>
			<UButton to="/activities" variant="soft">{{
				t('ui.activities')
			}}</UButton>
		</div>
	</div>
</template>

<style scoped>
.profile-personal-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
}
.profile-personal-actions > :last-child {
	margin-left: auto;
}
.profile-interest-popover {
	width: min(330px, calc(100vw - 32px));
	padding: 18px;
}
.profile-interest-popover h2 {
	margin: 0 0 14px;
	font-size: 15px;
	font-weight: 600;
}
.profile-interest-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
}
.profile-interest-popover .error {
	font-size: 13px;
	margin: 12px 0 0;
}
@media (max-width: 767px) {
	.profile-personal-actions {
		justify-content: flex-start;
	}
}
</style>
