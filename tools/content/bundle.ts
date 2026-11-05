import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { create, Parser } from 'tar'
import { lock } from 'proper-lockfile'
import { validateAssetFiles } from './asset-validation.ts'

export interface ContentBundleOptions {
	rootDirectory?: string
	kind?: 'content' | 'assets' | 'snapshots'
}
export interface ContentBundleFile {
	path: string
	bytes: number
	sha256: string
}
export interface ContentBundleManifest {
	format:
		'campus-content-cache' | 'campus-assets-cache' | 'campus-snapshots-cache'
	formatVersion: 1
	dataVersion: string
	files: ContentBundleFile[]
}
interface CacheState {
	formatVersion: 1
	archiveSha256: string
}
interface VerifiedBundle {
	digest: string
	manifest: ContentBundleManifest
	files: Map<string, Buffer>
}
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const stateName = '.bundle-state.json'
const maxFileBytes = (options: ContentBundleOptions) =>
	(options.kind === 'snapshots' ? 32 : 8) * 1024 * 1024
const maxTotalBytes = 128 * 1024 * 1024
const maxCompressedBytes = 64 * 1024 * 1024
const maxFiles = 10000
const digest = (bytes: Buffer) =>
	createHash('sha256').update(bytes).digest('hex')
const compare = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1)
const rootOf = (options: ContentBundleOptions) =>
	resolve(options.rootDirectory ?? projectRoot)
const archiveOf = (options: ContentBundleOptions) =>
	join(
		rootOf(options),
		options.kind === 'assets'
			? 'tools/content/assets.tar.gz'
			: options.kind === 'snapshots'
				? 'tools/content/snapshots.tar.gz'
				: 'tools/content/generated-content.tar.gz',
	)
export const getContentCacheDirectory = (options: ContentBundleOptions = {}) =>
	join(
		rootOf(options),
		options.kind === 'assets'
			? '.data/assets-cache'
			: options.kind === 'snapshots'
				? '.data/snapshots-cache'
				: '.data/content-cache',
	)

function validPath(path: string) {
	return (
		path.length > 0 &&
		path.length <= 240 &&
		!/[\\\0:]/.test(path) &&
		path.split('/').every((part) => part && part !== '.' && part !== '..')
	)
}
const manifestName = (options: ContentBundleOptions) =>
	options.kind === 'assets' ? 'bundle-manifest.json' : 'manifest.json'
const bundleFormat = (options: ContentBundleOptions) =>
	options.kind === 'assets'
		? 'campus-assets-cache'
		: options.kind === 'snapshots'
			? 'campus-snapshots-cache'
			: 'campus-content-cache'

function validContentPath(path: string, options: ContentBundleOptions) {
	const first = path.normalize('NFC').toLowerCase().split('/')[0]
	return (
		validPath(path) &&
		first !== manifestName(options) &&
		first !== stateName &&
		(path.endsWith('.json') ||
			path === 'README.md' ||
			(options.kind === 'assets' && path.endsWith('.webp')))
	)
}
async function exists(path: string) {
	try {
		await lstat(path)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		return false
	}
}
async function withLock<T>(
	options: ContentBundleOptions,
	task: () => Promise<T>,
) {
	const data = join(rootOf(options), '.data')
	await mkdir(data, { recursive: true })
	const release = await lock(
		join(data, `${options.kind ?? 'content'}-bundle`),
		{
			realpath: false,
			stale: 10000,
			update: 2000,
			retries: { retries: 60, factor: 1, minTimeout: 500, maxTimeout: 500 },
		},
	)
	try {
		return await task()
	} finally {
		await release()
	}
}

/** Publish a checkpoint under the same lock as pack/unpack; model requests stay outside. */
export async function writeContentCacheFile(
	file: string,
	content: string | Buffer,
	options: ContentBundleOptions = {},
): Promise<void> {
	const cache = getContentCacheDirectory(options)
	const path = relative(cache, resolve(file)).split(sep).join('/')
	if (!validContentPath(path, options))
		throw new Error('CONTENT_WRITE_OUTSIDE_CACHE')
	const bytes = Buffer.from(content)
	if (bytes.length > maxFileBytes(options))
		throw new Error('CONTENT_BUNDLE_LIMIT')
	if (path.endsWith('.json')) JSON.parse(bytes.toString('utf8'))
	await withLock(options, () => publishCacheFile(cache, path, bytes))
}

async function publishCacheFile(cache: string, path: string, bytes: Buffer) {
	if (!(await lstat(cache)).isDirectory())
		throw new Error('CONTENT_CACHE_NOT_DIRECTORY')
	let parent = cache
	for (const part of path.split('/').slice(0, -1)) {
		parent = join(parent, part)
		await mkdir(parent, { recursive: true })
		const metadata = await lstat(parent)
		if (!metadata.isDirectory() || metadata.isSymbolicLink())
			throw new Error('CONTENT_WRITE_PARENT_INVALID')
	}
	const temporary = join(parent, `.content-${randomUUID()}.tmp`)
	try {
		await writeFile(temporary, bytes)
		await rename(temporary, join(cache, path))
	} finally {
		await rm(temporary, { force: true })
	}
}

async function scan(
	directory: string,
	options: ContentBundleOptions,
	allowEmpty = false,
): Promise<Map<string, Buffer>> {
	if (!(await lstat(directory)).isDirectory())
		throw new Error('CONTENT_CACHE_NOT_DIRECTORY')
	const files = new Map<string, Buffer>()
	let total = 0
	const folded = new Set<string>()
	async function visit(relative: string) {
		for (const name of (await readdir(join(directory, relative))).sort(
			compare,
		)) {
			const path = relative ? `${relative}/${name}` : name
			if (name === '.DS_Store' || name.endsWith('.tmp')) continue
			const full = join(directory, path)
			const metadata = await lstat(full)
			if (path === stateName) {
				if (!metadata.isFile() || metadata.isSymbolicLink())
					throw new Error('CONTENT_CACHE_STATE_INVALID')
				continue
			}
			if (metadata.isSymbolicLink())
				throw new Error(`CONTENT_LINK_REJECTED:${path}`)
			if (metadata.isDirectory()) {
				if (!validPath(path)) throw new Error(`CONTENT_PATH_INVALID:${path}`)
				await visit(path)
				continue
			}
			if (!metadata.isFile() || !validContentPath(path, options))
				throw new Error(`CONTENT_FILE_INVALID:${path}`)
			if (metadata.size > maxFileBytes(options) || files.size >= maxFiles)
				throw new Error('CONTENT_BUNDLE_LIMIT')
			const key = path.normalize('NFC').toLowerCase()
			if (folded.has(key)) throw new Error(`CONTENT_PATH_DUPLICATE:${path}`)
			folded.add(key)
			const bytes = await readFile(full)
			if (path.endsWith('.json')) JSON.parse(bytes.toString('utf8'))
			total += bytes.length
			if (total > maxTotalBytes) throw new Error('CONTENT_BUNDLE_LIMIT')
			files.set(path, bytes)
		}
	}
	await visit('')
	if (!files.size && !allowEmpty) throw new Error('CONTENT_CACHE_EMPTY')
	return new Map([...files].sort(([a], [b]) => compare(a, b)))
}
function describe(files: Map<string, Buffer>): ContentBundleFile[] {
	return [...files].map(([path, bytes]) => ({
		path,
		bytes: bytes.length,
		sha256: digest(bytes),
	}))
}
function sameFiles(a: Map<string, Buffer>, b: Map<string, Buffer>) {
	return (
		a.size === b.size &&
		[...a].every(([path, bytes]) => b.get(path)?.equals(bytes))
	)
}

async function readBundle(
	path: string,
	options: ContentBundleOptions,
): Promise<VerifiedBundle> {
	if ((await stat(path)).size > maxCompressedBytes)
		throw new Error('CONTENT_BUNDLE_LIMIT')
	const compressed = await readFile(path)
	if (compressed[0] !== 0x1f || compressed[1] !== 0x8b)
		throw new Error('CONTENT_BUNDLE_NOT_GZIP')
	const plain = gunzipSync(compressed, { maxOutputLength: maxTotalBytes })
	const files = new Map<string, Buffer>()
	const folded = new Set<string>()
	let failure: string | undefined
	await new Promise<void>((done, reject) => {
		const parser = new Parser({
			strict: true,
			onReadEntry(entry) {
				const path = entry.path
				const key = path.normalize('NFC').toLowerCase()
				const allowed =
					entry.type === 'File' &&
					(path === manifestName(options) || validContentPath(path, options)) &&
					entry.size <= maxFileBytes(options) &&
					!folded.has(key) &&
					folded.size <= maxFiles
				if (!allowed) failure ??= `CONTENT_ARCHIVE_ENTRY_INVALID:${path}`
				folded.add(key)
				const chunks: Buffer[] = []
				entry.on('data', (chunk: Buffer) => {
					if (allowed) chunks.push(chunk)
				})
				entry.on('end', () => {
					if (allowed) files.set(path, Buffer.concat(chunks))
				})
			},
		})
		parser.once('error', reject)
		parser.once('end', done)
		parser.end(plain)
	})
	if (failure) throw new Error(failure)
	const manifestBytes = files.get(manifestName(options))
	if (!manifestBytes) throw new Error('CONTENT_MANIFEST_MISSING')
	const manifest = JSON.parse(
		manifestBytes.toString('utf8'),
	) as ContentBundleManifest
	if (
		!manifest ||
		manifest.format !== bundleFormat(options) ||
		manifest.formatVersion !== 1 ||
		typeof manifest.dataVersion !== 'string' ||
		!Array.isArray(manifest.files) ||
		!manifest.files.length ||
		manifest.files.length !== files.size - 1
	)
		throw new Error('CONTENT_MANIFEST_INVALID')
	let previous = ''
	for (const file of manifest.files) {
		if (
			!file ||
			typeof file.path !== 'string' ||
			!validContentPath(file.path, options) ||
			compare(previous, file.path) >= 0 ||
			!Number.isInteger(file.bytes) ||
			file.bytes < 0 ||
			typeof file.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/.test(file.sha256)
		)
			throw new Error('CONTENT_MANIFEST_INVALID')
		previous = file.path
		const bytes = files.get(file.path)
		if (!bytes || bytes.length !== file.bytes || digest(bytes) !== file.sha256)
			throw new Error(`CONTENT_HASH_MISMATCH:${file.path}`)
		if (file.path.endsWith('.json')) JSON.parse(bytes.toString('utf8'))
	}
	files.delete(manifestName(options))
	if (options.kind === 'assets') await validateAssetFiles(files)
	return { digest: digest(compressed), manifest, files }
}
async function writeState(directory: string, archiveSha256: string) {
	const temporary = join(directory, `${stateName}.${process.pid}.tmp`)
	await writeFile(
		temporary,
		JSON.stringify({ formatVersion: 1, archiveSha256 } satisfies CacheState) +
			'\n',
	)
	await rename(temporary, join(directory, stateName))
}
async function compatibleCache(
	directory: string,
	bundle: VerifiedBundle,
	options: ContentBundleOptions,
	restoreMissing = false,
) {
	const files = await scan(directory, options, true)
	let state: CacheState | undefined
	try {
		state = JSON.parse(
			await readFile(join(directory, stateName), 'utf8'),
		) as CacheState
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	if (state?.formatVersion === 1 && state.archiveSha256 === bundle.digest) {
		if (restoreMissing) {
			const folded = new Set(
				[...files.keys()].map((path) => path.normalize('NFC').toLowerCase()),
			)
			let restored = false
			for (const [path, bytes] of bundle.files) {
				if (files.has(path)) continue
				if (folded.has(path.normalize('NFC').toLowerCase()))
					throw new Error('CONTENT_CACHE_PATH_CASE_CONFLICT')
				if (await exists(join(directory, path)))
					throw new Error('CONTENT_CACHE_PATH_CASE_CONFLICT')
				await publishCacheFile(directory, path, bytes)
				restored = true
			}
			if (restored) {
				const current = await scan(directory, options)
				if ([...bundle.files.keys()].some((path) => !current.has(path)))
					throw new Error('CONTENT_CACHE_PATH_CASE_CONFLICT')
				return current
			}
		}
		return files
	}
	if (!sameFiles(files, bundle.files))
		throw new Error(
			'CONTENT_BUNDLE_CONFLICT: archive and local cache differ; preserve local work before replacing the cache',
		)
	await writeState(directory, bundle.digest)
	return files
}

export async function ensureContentCache(
	options: ContentBundleOptions = {},
): Promise<string> {
	return withLock(options, async () => {
		const cache = getContentCacheDirectory(options)
		const bundle = await readBundle(archiveOf(options), options)
		if (await exists(cache)) {
			const files = await compatibleCache(cache, bundle, options, true)
			if (options.kind === 'assets') await validateAssetFiles(files)
			return cache
		}
		const temporary = await mkdtemp(
			join(rootOf(options), '.data/content-unpack-'),
		)
		try {
			for (const [path, bytes] of bundle.files) {
				await mkdir(dirname(join(temporary, path)), { recursive: true })
				await writeFile(join(temporary, path), bytes)
			}
			if (!sameFiles(await scan(temporary, options), bundle.files))
				throw new Error('CONTENT_UNPACK_MISMATCH')
			await writeState(temporary, bundle.digest)
			await rename(temporary, cache)
		} finally {
			await rm(temporary, { recursive: true, force: true })
		}
		return cache
	})
}

export async function packContentCache(options: ContentBundleOptions = {}) {
	return withLock(options, async () => {
		const cache = getContentCacheDirectory(options)
		const archive = archiveOf(options)
		const before = (await exists(archive))
			? await readBundle(archive, options)
			: undefined
		const files = before
			? await compatibleCache(cache, before, options)
			: await scan(cache, options)
		if (!files.size) throw new Error('CONTENT_CACHE_EMPTY')
		if (options.kind === 'assets') await validateAssetFiles(files)
		let dataVersion = before?.manifest.dataVersion ?? 'unversioned'
		try {
			const snapshot = JSON.parse(
				await readFile(
					join(rootOf(options), '.data/snapshots-cache/pulse-full.json'),
					'utf8',
				),
			) as { version?: unknown }
			if (typeof snapshot.version === 'string') dataVersion = snapshot.version
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
		const manifest: ContentBundleManifest = {
			format: bundleFormat(options),
			formatVersion: 1,
			dataVersion,
			files: describe(files),
		}
		const temporary = await mkdtemp(
			join(rootOf(options), '.data/content-pack-'),
		)
		await mkdir(dirname(archive), { recursive: true })
		const packed = join(
			dirname(archive),
			`.${options.kind ?? 'content'}-${randomUUID()}.tmp`,
		)
		try {
			for (const [path, bytes] of files) {
				await mkdir(dirname(join(temporary, path)), { recursive: true })
				await writeFile(join(temporary, path), bytes, { mode: 0o644 })
			}
			await writeFile(
				join(temporary, manifestName(options)),
				JSON.stringify(manifest, null, '\t') + '\n',
				{ mode: 0o644 },
			)
			await create(
				{
					cwd: temporary,
					file: packed,
					gzip: true,
					portable: true,
					noMtime: true,
					strict: true,
				},
				[manifestName(options), ...files.keys()],
			)
			const verified = await readBundle(packed, options)
			if (
				!sameFiles(files, verified.files) ||
				!sameFiles(files, await scan(cache, options))
			)
				throw new Error('CONTENT_CACHE_CHANGED_DURING_PACK')
			if (before && digest(await readFile(archive)) !== before.digest)
				throw new Error('CONTENT_ARCHIVE_CHANGED_DURING_PACK')
			await rename(packed, archive)
			let cacheStateUpdated = true
			let cacheStateError: string | undefined
			try {
				await writeState(cache, verified.digest)
			} catch (error) {
				// The verified archive is already published. A later ensure can repair matching state.
				cacheStateUpdated = false
				cacheStateError = error instanceof Error ? error.message : String(error)
			}
			return {
				files: files.size,
				archive,
				digest: verified.digest,
				cacheStateUpdated,
				cacheStateError,
			}
		} finally {
			await rm(temporary, { recursive: true, force: true })
			await rm(packed, { force: true })
		}
	})
}
