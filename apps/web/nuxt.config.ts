import studioBridge from '../../modules/studio-bridge'
export default defineNuxtConfig({
	compatibilityDate: '2026-11-03',
	modules: [
		studioBridge,
		'@nuxt/ui',
		'@tdesign-vue-next/nuxt',
		'@nuxtjs/i18n',
		'@nuxt/eslint',
	],
	css: ['~/assets/css/main.css'],
	devtools: { enabled: false },
	devServer: { host: '127.0.0.1' },
	ui: { fonts: false },
	colorMode: { preference: 'system', fallback: 'light', classSuffix: '' },
	icon: { clientBundle: { scan: true } },
	i18n: {
		defaultLocale: 'zh-CN',
		strategy: 'no_prefix',
		detectBrowserLanguage: false,
		locales: [
			{
				code: 'zh-CN',
				language: 'zh-CN',
				name: '简体中文',
				files: [
					'zh-CN/app.json',
					'zh-CN/admin.json',
					'zh-CN/common.json',
					'zh-CN/errors.json',
					'zh-CN/community.json',
					'zh-CN/feed.json',
					'zh-CN/posts.json',
					'zh-CN/comments.json',
					'zh-CN/activities.json',
					'zh-CN/social.json',
					'zh-CN/profile.json',
					'profile-comments.json',
					'zh-CN/compose.json',
					'zh-CN/recommendation.json',
				],
			},
		],
	},
	app: {
		head: {
			htmlAttrs: { lang: 'zh-CN' },
			link: [
				{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
				{
					rel: 'preconnect',
					href: 'https://fonts.gstatic.com',
					crossorigin: 'anonymous',
				},
				{
					rel: 'stylesheet',
					href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@250..900&family=ZCOOL+KuaiLe&display=swap',
				},
			],
		},
	},
})
