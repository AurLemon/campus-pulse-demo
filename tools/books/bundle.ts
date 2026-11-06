import '../agents/environment.ts'
import {
	readFile,
	writeFile,
	readdir,
	mkdir,
	rename,
	access,
	copyFile,
	rm,
} from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import * as tar from 'tar'
import lockfile from 'proper-lockfile'
const root = resolve(process.env.CAMPUS_DATA_DIR ?? '.data', 'books'),
	archive = resolve('tools/books/catalogue.tar.gz')
interface Manifest {
	version: string
	files: Record<string, string>
}
async function hash(path: string) {
	return createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
}
async function list(dir: string, prefix = ''): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true })
	const rows: string[] = []
	for (const entry of entries) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory())
			rows.push(...(await list(join(dir, entry.name), path)))
		else if (entry.isFile()) rows.push(path)
	}
	return rows
}
await mkdir(root, { recursive: true })
const release = await lockfile.lock(root, { realpath: false, retries: 0 })
try {
	if (process.argv[2] === 'pack') {
		const files = (await list(root))
			.filter(
				(path) =>
					path.startsWith('raw/') ||
					path.startsWith('covers/') ||
					[
						'catalogue.json',
						'candidates.json',
						'turing-catalogue.json',
						'cover-checks.json',
						'accepted.json',
						'import-report.json',
						'demo-reading-report.json',
						'metadata-repair-report.json',
						'verification-report.json',
					].includes(path),
			)
			.sort()
		const manifest: Manifest = {
			version: 'campus-books-v1',
			files: Object.fromEntries(
				await Promise.all(
					files.map(async (path) => [path, await hash(resolve(root, path))]),
				),
			),
		}
		await writeFile(
			resolve(root, 'manifest.json'),
			JSON.stringify(manifest, null, 2) + '\n',
		)
		const temporary = `${archive}.${randomUUID()}.tmp`
		try {
			await tar.c({ file: temporary, cwd: root, gzip: true, portable: true }, [
				...files,
				'manifest.json',
			])
			for (const path of files)
				if ((await hash(resolve(root, path))) !== manifest.files[path])
					throw new Error('BOOKS_CHANGED_DURING_PACK')
			await rename(temporary, archive)
		} catch (error) {
			await rm(temporary, { force: true })
			throw error
		}
		console.log(
			JSON.stringify({
				archive,
				files: files.length,
				digest: await hash(archive),
			}),
		)
	} else if (process.argv[2] === 'unpack') {
		const staging = resolve(
			process.env.CAMPUS_DATA_DIR ?? '.data',
			`books-restore-${randomUUID()}`,
		)
		await mkdir(staging, { recursive: true })
		try {
			await tar.x({
				file: archive,
				cwd: staging,
				strict: true,
				preservePaths: false,
			})
			const manifest = JSON.parse(
				await readFile(resolve(staging, 'manifest.json'), 'utf8'),
			) as Manifest
			if (manifest.version !== 'campus-books-v1')
				throw new Error('INVALID_BOOKS_BUNDLE')
			for (const [path, digest] of Object.entries(manifest.files)) {
				if (
					path.startsWith('/') ||
					/^[A-Za-z]:/.test(path) ||
					path.startsWith('\\\\') ||
					path.split('/').includes('..') ||
					(await hash(resolve(staging, path))) !== digest
				)
					throw new Error('INVALID_BOOKS_BUNDLE_CHECKSUM')
				try {
					await access(resolve(root, path))
					if ((await hash(resolve(root, path))) !== digest)
						throw new Error(`BOOKS_LOCAL_CONFLICT:${path}`)
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
				}
			}
			for (const path of Object.keys(manifest.files)) {
				const destination = resolve(root, path)
				try {
					await access(destination)
				} catch {
					await mkdir(dirname(destination), { recursive: true })
					await copyFile(resolve(staging, path), destination)
				}
			}
			console.log(
				JSON.stringify({
					restored: true,
					files: Object.keys(manifest.files).length,
				}),
			)
		} finally {
			await rm(staging, { recursive: true, force: true })
		}
	} else throw new Error('Usage: node tools/books/bundle.ts pack|unpack')
} finally {
	await release()
}
