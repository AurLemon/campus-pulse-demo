import type { GlobalConfigProvider } from 'tdesign-vue-next'
import zhCN from 'tdesign-vue-next/es/locale/zh_CN'

// 上游语言包的数组为只读类型，ConfigProvider 要求可变数组。
const chineseConfig: GlobalConfigProvider = {
	...zhCN,
	datePicker: {
		...zhCN.datePicker,
		weekdays: [...zhCN.datePicker.weekdays],
		months: [...zhCN.datePicker.months],
		quarters: [...zhCN.datePicker.quarters],
	},
	rate: { ...zhCN.rate, rateText: [...zhCN.rate.rateText] },
}

const locales: Record<string, GlobalConfigProvider> = {
	'zh-CN': chineseConfig,
}

export function getUiLocale(locale: string): GlobalConfigProvider {
	return locales[locale] ?? chineseConfig
}
