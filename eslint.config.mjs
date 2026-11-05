import withNuxt from './apps/web/.nuxt/eslint.config.mjs'

export default withNuxt({
	ignores: ['generated/**'],
	rules: {
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/no-unused-vars': 'warn',
		'vue/no-use-v-if-with-v-for': 'warn',
		'vue/require-v-for-key': 'warn',
		'vue/html-self-closing': 'warn',
		'vue/attribute-hyphenation': 'off',
		'vue/attributes-order': 'off',
		'vue/component-name-in-template-casing': 'off',
		'vue/multi-word-component-names': 'off',
	},
})
