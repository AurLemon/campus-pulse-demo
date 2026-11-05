import { ensureContentCache, packContentCache } from './bundle.ts'
import { ensureAssetCache, packAssetCache } from './asset-bundle.ts'
import { ensureSnapshotCache, packSnapshotCache } from './snapshot-bundle.ts'

try {
	const command = process.argv[2]
	const targets = [
		{
			name: 'snapshots',
			flag: '--snapshots',
			pack: packSnapshotCache,
			unpack: ensureSnapshotCache,
		},
		{
			name: 'content',
			flag: '--content',
			pack: packContentCache,
			unpack: ensureContentCache,
		},
		{
			name: 'assets',
			flag: '--assets',
			pack: packAssetCache,
			unpack: ensureAssetCache,
		},
	]
	const selected = targets.filter((target) =>
		process.argv.includes(target.flag),
	)
	for (const target of selected.length ? selected : targets) {
		if (command === 'pack') {
			const result = await target.pack()
			console.log(JSON.stringify({ kind: target.name, ...result }))
			if (!result.cacheStateUpdated) process.exitCode = 1
		} else if (command === 'unpack') {
			console.log(
				JSON.stringify({ kind: target.name, cache: await target.unpack() }),
			)
		} else
			throw new Error(
				'Usage: pnpm data:pack | pnpm data:unpack [--assets | --snapshots | --content]',
			)
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
}
