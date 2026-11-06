import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import {
	ensureAssetCache,
	writeAssetCacheFile,
	packAssetCache,
} from './asset-bundle.ts'

const run = promisify(execFile),
	root = process.cwd(),
	cache = await ensureAssetCache()
const chrome =
	process.env.CAMPUS_SCREENSHOT_CHROME ??
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const directory = await mkdtemp(join(tmpdir(), 'campus-technical-capture-'))
const escape = (text: string) =>
	text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const entries = [
	{
		id: 'technical-array-map',
		file: 'array-map.mjs',
		code: 'const selectedTags = undefined\nconsole.log(selectedTags.map(tag => tag.toUpperCase()))\n',
		command: 'node array-map.mjs',
		executable: process.execPath,
		args: ['array-map.mjs'],
		expected: 'TypeError',
		facts: [
			'实际执行Node.js程序',
			'selectedTags的值是undefined',
			'在undefined上调用map导致TypeError',
			'代码与完整错误输出都可读',
		],
		cause: 'selectedTags为undefined，调用map前应初始化数组或先判断是否为数组',
	},
	{
		id: 'technical-capacity-type',
		file: 'capacity.ts',
		code: "interface Activity {\n  capacity: number\n}\n\nconst activity: Activity = { capacity: '30' }\nconsole.log(activity.capacity)\n",
		command: 'tsc --noEmit --strict capacity.ts',
		executable: process.execPath,
		args: [
			resolve('node_modules/typescript/bin/tsc'),
			'--noEmit',
			'--strict',
			'--skipLibCheck',
			'--target',
			'ES2023',
			'--typeRoots',
			'./empty-types',
			'capacity.ts',
		],
		expected: 'TS2322',
		facts: [
			'实际执行TypeScript编译器',
			'Activity.capacity声明为number',
			'对象的capacity赋值为字符串30',
			'编译器实际返回TS2322类型不匹配错误',
		],
		cause:
			'capacity要求number，代码却传入字符串，需按字段类型提供数字或在输入边界转换',
	},
]
interface CaptureFact {
	id: string
	kind: 'screenshot'
	file: string
	url: string
	mediaPath: string
	sha256: string
	width: number
	height: number
	topics: string[]
	verifiedFacts: string[]
	review: { status: 'approved'; note: string }
	reproduction: {
		renderedHtml: string
		sourceFile: string
		sourceCode: string
		actualArguments: string[]
		command: string
		exitCode: number
		stdout: string
		stderr: string
		nodeVersion: string
		cause: string
	}
}
const facts: CaptureFact[] = []
try {
	await mkdir(join(directory, 'empty-types'))
	for (const entry of entries) {
		const { writeFile } = await import('node:fs/promises')
		await writeFile(join(directory, entry.file), entry.code)
		let stdout = '',
			stderr = '',
			exitCode = 0
		try {
			const output = await run(entry.executable, entry.args, {
				cwd: directory,
				timeout: 30000,
			})
			stdout = output.stdout
			stderr = output.stderr
		} catch (error) {
			const failure = error as {
				stdout?: string
				stderr?: string
				code?: number
			}
			stdout = failure.stdout ?? ''
			stderr = failure.stderr ?? ''
			exitCode = typeof failure.code === 'number' ? failure.code : 1
		}
		const sanitize = (text: string) =>
			text
				.replaceAll('/private' + directory, '/demo')
				.replaceAll(directory, '/demo')
				.replaceAll(root, '/project')
		stdout = sanitize(stdout)
		stderr = sanitize(stderr)
		if (exitCode === 0 || !(stdout + stderr).includes(entry.expected))
			throw new Error(`REPRODUCTION_FAILED:${entry.id}`)
		const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#12151c;color:#e4e8ef;font:17px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:30px}.window{border:1px solid #39404e;border-radius:12px;overflow:hidden}.bar{background:#252b36;padding:13px 20px;color:#a8b5c9;font-size:14px}.editor{padding:20px 24px;background:#191e28;white-space:pre-wrap;min-height:240px}.terminal{border-top:1px solid #39404e;padding:20px 24px;white-space:pre-wrap;font-size:15px;color:#ecb5b7;overflow-wrap:anywhere}.command{color:#b3d0ae;padding-bottom:14px}.label{font-size:12px;color:#7f8da5;float:right}</style><div class="window"><div class="bar">${escape(entry.file)}<span class="label">locally reproduced / ${escape(process.version)}</span></div><div class="editor">${escape(entry.code)}</div><div class="terminal"><div class="command">$ ${escape(entry.command)}</div>${escape(stdout + stderr)}</div></div></html>`
		const htmlFile = join(directory, entry.id + '.html'),
			png = join(directory, entry.id + '.png')
		await writeFile(htmlFile, html)
		await run(
			chrome,
			[
				'--headless=new',
				'--disable-gpu',
				'--disable-background-networking',
				'--no-first-run',
				`--user-data-dir=${join(directory, 'chrome-' + entry.id)}`,
				'--hide-scrollbars',
				'--window-size=1280,940',
				`--screenshot=${png}`,
				pathToFileURL(htmlFile).href,
			],
			{ timeout: 45000, maxBuffer: 1024 * 1024 },
		)
		const bytes = await sharp(await readFile(png))
				.webp({ quality: 92 })
				.toBuffer(),
			metadata = await sharp(bytes).metadata(),
			file = entry.id + '.webp'
		await writeAssetCacheFile(join(cache, file), bytes)
		facts.push({
			id: entry.id,
			kind: 'screenshot',
			file,
			url: '/media/' + file,
			mediaPath: '.data/media/' + file,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			width: metadata.width!,
			height: metadata.height!,
			topics: ['technology', 'learning'],
			verifiedFacts: entry.facts,
			review: {
				status: 'approved',
				note: '来自隔离小程序的实际执行输出，已移除本机绝对路径，非真实用户截图',
			},
			reproduction: {
				renderedHtml: html,
				sourceFile: entry.file,
				sourceCode: entry.code,
				actualArguments: entry.args.map((argument) =>
					argument.replaceAll(root, '<project>'),
				),
				command: entry.command,
				exitCode,
				stdout,
				stderr,
				nodeVersion: process.version,
				cause: entry.cause,
			},
		})
	}
	await writeAssetCacheFile(
		join(cache, 'technical-media-facts.json'),
		JSON.stringify(facts, null, '\t'),
	)
	const manifest = JSON.parse(
		await readFile(join(cache, 'manifest.json'), 'utf8'),
	) as Array<Record<string, unknown>>
	for (const fact of facts) {
		const row = {
			id: fact.id,
			file: fact.file,
			url: fact.url,
			mime: 'image/webp',
			width: fact.width,
			height: fact.height,
			alt: fact.verifiedFacts.join('，'),
			origin: 'Generated',
			sourceUrl: null,
			attribution: 'Locally reproduced code output, synthetic example',
			license: 'Original code example and locally generated screenshot',
			tags: fact.topics,
		}
		const index = manifest.findIndex((item) => item.id === fact.id)
		if (index < 0) manifest.push(row)
		else manifest[index] = row
	}
	await writeAssetCacheFile(
		join(cache, 'manifest.json'),
		JSON.stringify(manifest, null, '\t'),
	)
	const packed = await packAssetCache()
	if (!packed.cacheStateUpdated) throw new Error('ASSET_BUNDLE_STATE_PENDING')
	console.log(
		JSON.stringify({
			captured: facts.map((f) => ({
				id: f.id,
				exitCode: f.reproduction.exitCode,
				width: f.width,
				height: f.height,
			})),
			paidRequests: 0,
		}),
	)
} finally {
	await rm(directory, { recursive: true, force: true })
}
