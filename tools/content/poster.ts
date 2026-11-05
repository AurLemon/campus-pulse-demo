import type { PosterOptions, Snapshot } from '@campus/contracts'

export interface PosterContent extends PosterOptions {
	id: string
	title: string
	tags: string[]
}
export function posterIdHash(id: string): number {
	let hash = 2166136261
	for (const character of id) {
		hash ^= character.codePointAt(0) ?? 0
		hash = Math.imul(hash, 16777619)
	}
	return hash >>> 0
}
/** Preserve explicit choices. New entries use a deterministic template and the existing title only. */
export function assignPosterOptions(
	row: PosterContent,
): Required<PosterOptions> {
	return {
		posterTemplate:
			row.posterTemplate ??
			(['orbit', 'quote', 'note'] as const)[posterIdHash(row.id) % 3]!,
		posterAspect: row.posterAspect ?? 'portrait',
		posterHighlight:
			(typeof row.posterHighlight === 'string' &&
			row.posterHighlight.length <= 40 &&
			row.title.includes(row.posterHighlight)
				? row.posterHighlight
				: undefined) ??
			row.tags.find((tag) => tag.length > 0 && row.title.includes(tag)) ??
			'',
	}
}
export function validPosterOptions(
	row: PosterOptions & { title: string },
): boolean {
	return (
		(row.posterTemplate === undefined ||
			['orbit', 'quote', 'note'].includes(row.posterTemplate)) &&
		(row.posterAspect === undefined ||
			['portrait', 'square', 'landscape'].includes(row.posterAspect)) &&
		(row.posterHighlight === undefined ||
			(typeof row.posterHighlight === 'string' &&
				row.posterHighlight.length <= 40 &&
				typeof row.title === 'string' &&
				row.title.includes(row.posterHighlight)))
	)
}
export function assignSnapshotPosters(snapshot: Snapshot): Snapshot {
	return {
		...snapshot,
		activities: snapshot.activities.map((row) => ({
			...row,
			...assignPosterOptions(row),
		})),
		posts: snapshot.posts.map((row) => ({
			...row,
			...assignPosterOptions(row),
		})),
	}
}
