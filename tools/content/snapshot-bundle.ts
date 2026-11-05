import { basename, dirname, join, resolve } from 'node:path'
import {
	ensureContentCache,
	getContentCacheDirectory,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'

export interface SnapshotBundleOptions {
	rootDirectory?: string
}
const optionsFor = (options: SnapshotBundleOptions) => ({
	...options,
	kind: 'snapshots' as const,
})
export const getSnapshotCacheDirectory = (
	options: SnapshotBundleOptions = {},
) => getContentCacheDirectory(optionsFor(options))
export const ensureSnapshotCache = (options: SnapshotBundleOptions = {}) =>
	ensureContentCache(optionsFor(options))
export const packSnapshotCache = (options: SnapshotBundleOptions = {}) =>
	packContentCache(optionsFor(options))
export async function resolveSnapshotFile(file = 'small.json') {
	if (
		file === basename(file) ||
		dirname(resolve(file)) === resolve('tools/content/snapshots')
	) {
		const directory = await ensureSnapshotCache()
		return join(directory, basename(file))
	}
	return resolve(file)
}
export async function writeSnapshotFile(
	file: string,
	content: string | Buffer,
) {
	const directory = await ensureSnapshotCache()
	const path = file === basename(file) ? join(directory, file) : resolve(file)
	await writeContentCacheFile(path, content, optionsFor({}))
}
export async function publishSnapshots() {
	const bundle = await packSnapshotCache()
	if (!bundle.cacheStateUpdated)
		throw new Error(
			'SNAPSHOT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing snapshots',
		)
	return bundle
}
