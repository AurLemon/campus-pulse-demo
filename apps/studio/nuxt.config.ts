import '../../tools/agents/environment.ts'
import studioBridge from '../../modules/studio-bridge'
export default defineNuxtConfig({
	compatibilityDate: '2026-11-03',
	modules: [studioBridge, '@nuxt/ui', '@nuxtjs/i18n'],
	css: ['~/assets/css/studio.css'],
	devtools: { enabled: false },
	devServer: { host: '127.0.0.1', port: 3001 },
	ui: { fonts: false },
	colorMode: { preference: 'system', fallback: 'light', classSuffix: '' },
	icon: { clientBundle: { scan: true } },
	runtimeConfig: {
		studioDatabaseUrl: '',
		studioProductOrigin: '',
	},
	i18n: {
		defaultLocale: 'zh-CN',
		strategy: 'no_prefix',
		detectBrowserLanguage: false,
		locales: [
			{
				code: 'zh-CN',
				language: 'zh-CN',
				files: ['zh-CN.json', 'studio-access.json', 'books.json'],
			},
		],
	},
	app: { head: { title: '在场 Studio', htmlAttrs: { lang: 'zh-CN' } } },
})
