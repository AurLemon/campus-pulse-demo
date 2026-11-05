<script setup lang="ts">
import { getUiLocale } from '../../lib/ui-locales'
import '~/assets/css/admin.css'
const { t } = useI18n(),
	{ user } = await useCampus()
</script>
<template>
	<TConfigProvider :global-config="getUiLocale('zh-CN')"
		><div class="admin-shell">
			<aside class="admin-sidebar">
				<NuxtLink to="/" class="admin-logo"><BrandMark /></NuxtLink>
				<nav>
					<NuxtLink to="/admin" class="admin-nav-active"
						><UIcon name="i-lucide-calendar-days" />{{
							t('ui.manage')
						}}</NuxtLink
					><NuxtLink to="/"
						><UIcon name="i-lucide-arrow-left" />{{
							t('ui.discover')
						}}</NuxtLink
					>
				</nav>
			</aside>
			<div class="admin-workspace">
				<header class="admin-topbar">
					<TBreadcrumb
						><TBreadcrumbItem>{{ t('ui.brand') }}</TBreadcrumbItem
						><TBreadcrumbItem>{{
							t('ui.manage')
						}}</TBreadcrumbItem></TBreadcrumb
					>
					<div class="admin-topbar-actions">
						<span>{{ user?.name }}</span
						><AdminThemeSwitcher />
					</div>
				</header>
				<main class="admin-content"><slot /></main>
			</div></div
	></TConfigProvider>
</template>
