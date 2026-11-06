import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
interface Candidate {
	id: string
	coverUrl: string
	sourceUrl: string
}
interface Check {
	url: string
	valid: boolean
	width?: number
	height?: number
	sha256?: string
	checkedAt: string
	error?: string
}
const root = resolve(process.env.CAMPUS_DATA_DIR ?? '.data', 'books'),
	rows = JSON.parse(
		await readFile(
			`${root}/${process.argv.includes('--turing') ? 'turing-catalogue' : 'catalogue'}.json`,
			'utf8',
		),
	) as Candidate[]
await mkdir(`${root}/covers`, { recursive: true })
let checks: Record<string, Check> = {}
try {
	checks = JSON.parse(
		await readFile(`${root}/cover-checks.json`, 'utf8'),
	) as Record<string, Check>
} catch {
	/* No optional source/checkpoint has been written yet. */
}
let cursor = 0,
	stopped = false
async function save() {
	await writeFile(
		`${root}/cover-checks.json.tmp`,
		JSON.stringify(checks, null, 2) + '\n',
	)
	await rename(`${root}/cover-checks.json.tmp`, `${root}/cover-checks.json`)
}
async function worker() {
	while (cursor < rows.length && !stopped) {
		const row = rows[cursor++]!
		if (checks[row.id]?.url === row.coverUrl && checks[row.id]?.valid) continue
		const check: Check = {
			url: row.coverUrl,
			valid: false,
			checkedAt: new Date().toISOString(),
		}
		try {
			const response = await fetch(row.coverUrl, {
				signal: AbortSignal.timeout(20000),
				headers: {
					'User-Agent': 'Mozilla/5.0 CampusPulseCourseMetadata/1.0',
					Referer: row.sourceUrl,
				},
			})
			if ([403, 429, 418].includes(response.status)) {
				stopped = true
				throw new Error(`SOURCE_REJECTED_${response.status}`)
			}
			if (!response.ok) throw new Error(`HTTP_${response.status}`)
			if (Number(response.headers.get('content-length')) > 5000000)
				throw new Error('IMAGE_TOO_LARGE')
			const bytes = Buffer.from(await response.arrayBuffer())
			if (bytes.length > 5000000) throw new Error('IMAGE_TOO_LARGE')
			const metadata = await sharp(bytes, {
				limitInputPixels: 25000000,
			}).metadata()
			if (
				!metadata.width ||
				!metadata.height ||
				metadata.width < 80 ||
				metadata.height < 100
			)
				throw new Error('IMAGE_DIMENSIONS')
			const webp = await sharp(bytes)
				.resize({ width: 600, withoutEnlargement: true })
				.webp({ quality: 85 })
				.toBuffer()
			await writeFile(`${root}/covers/${row.id}.webp`, webp)
			Object.assign(check, {
				valid: true,
				width: metadata.width,
				height: metadata.height,
				sha256: createHash('sha256').update(bytes).digest('hex'),
			})
		} catch (error) {
			check.error = error instanceof Error ? error.message : 'UNKNOWN'
		}
		checks[row.id] = check
		console.log(`${row.id}: ${check.valid ? 'valid' : check.error}`)
		if (cursor % 20 === 0) await save()
		await new Promise((resolve) => setTimeout(resolve, 600))
	}
}
await worker()
await save()
console.log(
	JSON.stringify({
		checked: Object.keys(checks).length,
		valid: Object.values(checks).filter((v) => v.valid).length,
		stopped,
	}),
)
