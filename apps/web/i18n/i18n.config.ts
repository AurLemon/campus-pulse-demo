export default defineI18nConfig(() => ({
	legacy: false,
	fallbackLocale: 'zh-CN',
	missingWarn: true,
	fallbackWarn: true,
	datetimeFormats: {
		'zh-CN': {
			date: { year: 'numeric', month: 'long', day: 'numeric' },
			dateTime: {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			},
		},
	},
	numberFormats: {
		'zh-CN': {
			decimal: { maximumFractionDigits: 2 },
			percent: { style: 'percent', maximumFractionDigits: 1 },
		},
	},
}))
