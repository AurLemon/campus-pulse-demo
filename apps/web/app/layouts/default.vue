<script setup lang="ts">
const { t } = useI18n(),
	route = useRoute()
const { user, logout } = await useCampus()
const { unread } = useMessageStatus(() => user.value?.id)
const { openAuth, authLocation } = useAuthOverlay()
const { composeLocation, openCompose } = useComposeOverlay()
const firstLoad = useState('brand-first-load', () => true)
onMounted(() => {
	setTimeout(() => (firstLoad.value = false), 1000)
})
const nav = computed(() => [
	{ to: '/', label: t('ui.discover'), icon: 'i-lucide-compass' },
	{ to: '/books', label: t('ui.books'), icon: 'i-lucide-book-open' },
	{ to: '/messages', label: t('ui.messages'), icon: 'i-lucide-message-circle' },
	{
		to: '/activities',
		label: t('ui.activities'),
		icon: 'i-lucide-calendar-days',
	},
	{
		to: user.value
			? `/users/${user.value.id}`
			: authLocation('login', 'profile'),
		label: t('ui.profile'),
		icon: 'i-lucide-user-round',
	},
])
const hasRail = computed(
	() => route.path === '/' || route.path === '/activities',
)
</script>
<template>
	<div
		class="campus-shell"
		:class="{
			'shell-with-rail': hasRail,
			'shell-messages': route.path === '/messages',
		}"
	>
		<a class="skip-content" href="#main-content">{{
			t('common.skipContent')
		}}</a>
		<aside class="site-sidebar">
			<NuxtLink to="/" class="wordmark" :aria-label="t('ui.brand')"
				><BrandMark :animated="firstLoad"
			/></NuxtLink>
			<nav class="desktop-nav">
				<NuxtLink
					v-for="item in nav"
					:key="item.icon"
					:to="item.to"
					:class="{
						selected:
							route.path === item.to ||
							(item.to !== '/' && route.path.startsWith(item.to + '/')),
					}"
					:aria-label="item.label"
					><UIcon :name="item.icon" /><span
						>{{ item.label
						}}<span
							v-if="item.to === '/messages' && unread"
							class="message-count"
							>{{ unread > 99 ? '99+' : unread }}</span
						></span
					></NuxtLink
				>
			</nav>
			<UButton
				:to="composeLocation()"
				@click="openCompose"
				class="publish-link"
				color="primary"
				variant="solid"
				size="lg"
				icon="i-lucide-plus"
				block
				><span>{{ t('ui.publish') }}</span></UButton
			>
			<div class="sidebar-bottom">
				<NuxtLink
					v-if="user?.role === 'ORGANIZER' || user?.role === 'ADMIN'"
					to="/admin"
					class="sidebar-management"
					><UIcon name="i-lucide-layout-dashboard" /><span>{{
						t('ui.manage')
					}}</span></NuxtLink
				><ThemeSwitcher />
				<div v-if="user" class="sidebar-account">
					<NuxtLink :to="`/users/${user.id}`" class="author"
						><UserAvatar :src="user.avatar" :name="user.name" /><span>{{
							user.name
						}}</span></NuxtLink
					><UButton
						icon="i-lucide-log-out"
						variant="ghost"
						color="neutral"
						:aria-label="t('ui.logout')"
						@click="logout"
					/>
				</div>
				<UButton v-else variant="soft" block @click="openAuth()">{{
					t('ui.login')
				}}</UButton>
			</div>
		</aside>
		<header class="mobile-header">
			<NuxtLink to="/"><BrandMark /></NuxtLink>
			<div>
				<UButton
					:to="composeLocation()"
					@click="openCompose"
					icon="i-lucide-plus"
					variant="ghost"
					color="neutral"
					:aria-label="t('ui.publish')"
				/>
				<UButton
					to="/?search=1"
					icon="i-lucide-search"
					color="neutral"
					variant="ghost"
					:aria-label="t('ui.search')"
				/><ThemeSwitcher />
			</div>
		</header>
		<main
			id="main-content"
			class="main-column"
			:class="{ 'messages-main': route.path === '/messages' }"
			tabindex="-1"
		>
			<slot />
		</main>
		<div class="community-rail-slot" :inert="!hasRail" :aria-hidden="!hasRail">
			<CommunitySidebar />
		</div>
		<nav class="mobile-nav">
			<NuxtLink
				v-for="item in nav"
				:key="item.icon"
				:to="item.to"
				:class="{
					selected:
						route.path === item.to ||
						(item.to !== '/' && route.path.startsWith(item.to + '/')),
				}"
				><UIcon :name="item.icon" /><span
					>{{ item.label
					}}<span
						v-if="item.to === '/messages' && unread"
						class="message-count"
						>{{ unread > 99 ? '99+' : unread }}</span
					></span
				></NuxtLink
			>
		</nav>
	</div>
</template>

<style scoped>
.campus-shell.shell-messages {
	column-gap: 0;
	height: 100dvh;
	min-height: 0;
	overflow: hidden;
}
.messages-main {
	height: 100dvh;
	min-height: 0;
	overflow: hidden;
	padding-block: 0;
}
@media (max-width: 767px) {
	.messages-main {
		height: calc(100dvh - 68px);
		padding-top: 15px;
		padding-bottom: calc(86px + env(safe-area-inset-bottom));
	}
}

.message-count {
	margin-left: 5px;
	padding: 1px 5px;
	border-radius: 999px;
	background: var(--ui-primary);
	color: white;
	font-size: 11px;
}
</style>
