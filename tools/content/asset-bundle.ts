import {
	ensureContentCache,
	getContentCacheDirectory,
	packContentCache,
	writeContentCacheFile,
	type ContentBundleOptions,
} from './bundle.ts'

type AssetBundleOptions = Omit<ContentBundleOptions, 'kind'>
const assetOptions = (options: AssetBundleOptions) => ({
	...options,
	kind: 'assets' as const,
})
export const getAssetCacheDirectory = (options: AssetBundleOptions = {}) =>
	getContentCacheDirectory(assetOptions(options))

export async function ensureAssetCache(options: AssetBundleOptions = {}) {
	const directory = await ensureContentCache(assetOptions(options))
	return directory
}
export async function packAssetCache(options: AssetBundleOptions = {}) {
	return packContentCache(assetOptions(options))
}
export async function writeAssetCacheFile(
	file: string,
	bytes: string | Buffer,
	options: AssetBundleOptions = {},
) {
	return writeContentCacheFile(file, bytes, assetOptions(options))
}
