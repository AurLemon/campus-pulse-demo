import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createSSRApp, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'

// Compile the real SFC with the versions already supplied by Vue and TypeScript.
const source = await readFile(
	'apps/web/app/components/ReactionIcon.vue',
	'utf8',
)
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, {
	id: 'reaction-icon-test',
	inlineTemplate: true,
})
const javascript = ts
	.transpileModule(compiled.content, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2023,
			module: ts.ModuleKind.ESNext,
		},
	})
	.outputText.replace(
		/from (['"])vue\1/g,
		`from ${JSON.stringify(import.meta.resolve('vue'))}`,
	)
const { default: ReactionIcon } = (await import(
	`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)) as { default: Component }
for (const kind of ['heart', 'star'] as const) {
	for (const active of [false, true]) {
		test(`真实 Vue 图标组件渲染 ${kind} active=${active}`, async () => {
			const html = await renderToString(
				createSSRApp(ReactionIcon, { kind, active }),
			)
			assert.match(html, /aria-hidden="true"/)
			assert.equal((html.match(/<path /g) ?? []).length, 1)
			assert.equal(html.includes('reaction-icon-active'), active)
			assert.ok(html.includes(kind === 'heart' ? 'M20.84' : 'm12 3'))
		})
	}
}
