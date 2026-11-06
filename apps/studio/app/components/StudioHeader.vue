<script setup lang="ts">
import type { StudioState } from '../../shared/contracts'
const { t } = useI18n()
const accountSwitchAvailable = import.meta.dev
const requestFetch = useRequestFetch()
const { data: observerState } = useAsyncData('studio-state', () =>
	requestFetch<StudioState>('/api/studio/state'),
)
const observerId = useState('studio-observer-user-id', () => '')
watch(
	observerState,
	(state) => {
		if (!observerId.value) observerId.value = state?.snapshot.users[0]?.id ?? ''
	},
	{ immediate: true },
)
const route = useRoute()
const sectionNav = ref<HTMLElement>()
const indicator = reactive({ x: 0, width: 0, visible: false })
const indicatorReady = ref(false)
let resizeObserver: ResizeObserver | undefined
let readyFrame = 0
let disposed = false
function updateIndicator() {
	const nav = sectionNav.value
	const link = nav?.querySelector<HTMLElement>(`a[href="${route.path}"]`)
	if (!nav || !link) {
		indicator.visible = false
		return
	}
	indicator.x = link.offsetLeft
	indicator.width = link.offsetWidth
	indicator.visible = true
}
watch(
	() => route.path,
	async () => {
		await nextTick()
		if (!disposed) updateIndicator()
	},
)
onMounted(() => {
	resizeObserver = new ResizeObserver(updateIndicator)
	if (sectionNav.value) {
		resizeObserver.observe(sectionNav.value)
		for (const link of sectionNav.value.querySelectorAll('a'))
			resizeObserver.observe(link)
	}
	updateIndicator()
	readyFrame = requestAnimationFrame(() => {
		indicatorReady.value = true
	})
	void document.fonts.ready.then(() => {
		if (!disposed) updateIndicator()
	})
})
onBeforeUnmount(() => {
	disposed = true
	resizeObserver?.disconnect()
	cancelAnimationFrame(readyFrame)
})
</script>
<template>
	<header class="studio-header">
		<NuxtLink to="/community" class="studio-brand" :aria-label="t('studio')">
			<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
				<path
					d="M15 38V11h11c12 0 12 18 0 18H15"
					stroke="currentColor"
					stroke-width="3.2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>{{ t('studio') }}</span>
		</NuxtLink>
		<nav
			ref="sectionNav"
			class="studio-sections"
			:class="{ 'is-ready': indicatorReady }"
			:aria-label="t('studio')"
		>
			<span
				class="studio-section-indicator"
				aria-hidden="true"
				:style="{
					transform: `translateX(${indicator.x}px)`,
					width: `${indicator.width}px`,
					opacity: indicator.visible ? 1 : 0,
				}"
			/>
			<NuxtLink to="/community">{{ t('workspaceCommunity') }}</NuxtLink
			><NuxtLink to="/books">{{ t('workspaceBooks') }}</NuxtLink
			><NuxtLink to="/agents">{{ t('workspaceAgents') }}</NuxtLink>
		</nav>
		<div class="header-meta">
			<StudioAccountSwitcher v-if="accountSwitchAvailable" /><UButton
				to="/feed"
				class="header-feed-link"
				:aria-label="t('feedDemo')"
				color="neutral"
				variant="ghost"
				icon="i-lucide-gallery-vertical-end"
				><span>{{ t('feedDemo') }}</span></UButton
			>
			<div v-if="observerState" class="header-observer">
				<StudioObserverPicker
					v-model="observerId"
					:users="observerState.snapshot.users"
				/>
			</div>
			<slot /><StudioThemeSwitcher />
		</div>
	</header>
</template>

<style scoped>
@media (max-width: 1100px) {
	.header-feed-link > span:not(.iconify) {
		display: none;
	}
}
@media (max-width: 800px) {
	:global(:root) {
		--studio-header-height: 164px;
	}
	.header-meta {
		order: 2;
		width: 100%;
		justify-content: flex-end;
	}
	.header-observer {
		flex: 1;
		max-width: 180px;
	}
	.studio-sections {
		order: 3;
	}
}

.header-observer {
	width: 180px;
	min-width: 0;
}
@media (max-width: 1100px) {
	.header-observer {
		width: 140px;
	}
}
@media (max-width: 600px) {
	.header-observer {
		width: 125px;
	}
}
.studio-sections {
	position: relative;
	display: flex;
	align-self: stretch;
	align-items: center;
	gap: 24px;
	margin-right: auto;
	margin-left: 36px;
	font-size: 13px;
	white-space: nowrap;
}
.studio-sections a {
	display: flex;
	align-items: center;
	height: 100%;
	position: relative;
	color: var(--studio-muted);
	text-decoration: none;
	transition: color 150ms;
}
.studio-sections a:hover,
.studio-sections .router-link-exact-active {
	color: var(--studio-text);
}
.studio-section-indicator {
	position: absolute;
	left: 0;
	bottom: -1px;
	height: 2px;
	background: var(--studio-accent);
	pointer-events: none;
}
.studio-sections.is-ready .studio-section-indicator {
	transition:
		transform 220ms ease,
		width 220ms ease,
		opacity 150ms ease;
}
@media (prefers-reduced-motion: reduce) {
	.studio-sections.is-ready .studio-section-indicator {
		transition: none;
	}
}

@media (max-width: 1100px) {
	.studio-sections {
		margin-left: 24px;
		gap: 18px;
	}
}
@media (max-width: 800px) {
	.studio-sections {
		order: 3;
		width: 100%;
		height: 40px;
		margin: 0;
		gap: 28px;
	}
}
</style>
