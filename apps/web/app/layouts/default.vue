<script setup lang="ts">
const { t } = useI18n(),
	route = useRoute()
const { user, logout } = await useCampus()
const { openAuth, authLocation } = useAuthOverlay()
const { composeLocation, openCompose } = useComposeOverlay()
const firstLoad = useState('brand-first-load', () => true)
onMounted(() => {
	setTimeout(() => (firstLoad.value = false), 1000)
})
const nav = computed(() => [
	{ to: '/', label: t('ui.discover'), icon: 'i-lucide-compass' },
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
	<div class="campus-shell" :class="{ 'shell-with-rail': hasRail }">
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
							(item.to === '/activities' &&
								route.path.startsWith('/activities')),
					}"
					:aria-label="item.label"
					><UIcon :name="item.icon" /><span>{{ item.label }}</span></NuxtLink
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
						><UserAvatar :name="user.name" /><span>{{
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
					to="/?search=1"
					icon="i-lucide-search"
					color="neutral"
					variant="ghost"
					:aria-label="t('ui.search')"
				/><ThemeSwitcher />
			</div>
		</header>
		<main id="main-content" class="main-column" tabindex="-1"><slot /></main>
		<CommunitySidebar v-if="hasRail" />
		<nav class="mobile-nav">
			<NuxtLink :to="nav[0]!.to" :class="{ selected: route.path === '/' }"
				><UIcon name="i-lucide-compass" /><span>{{
					t('ui.discover')
				}}</span></NuxtLink
			><NuxtLink
				to="/activities"
				:class="{ selected: route.path.startsWith('/activities') }"
				><UIcon name="i-lucide-calendar-days" /><span>{{
					t('ui.activities')
				}}</span></NuxtLink
			><NuxtLink
				:to="composeLocation()"
				@click="openCompose"
				class="mobile-publish"
				><UIcon name="i-lucide-plus" /><span>{{
					t('ui.publish')
				}}</span></NuxtLink
			><NuxtLink
				:to="nav[2]!.to"
				:class="{ selected: route.path.startsWith('/users') }"
				><UIcon name="i-lucide-user-round" /><span>{{
					t('ui.profile')
				}}</span></NuxtLink
			>
		</nav>
	</div>
</template>
