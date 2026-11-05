import type { MediaAsset, Snapshot } from '@campus/contracts'

export interface Asset extends MediaAsset {
	file: string
	tags: string[]
	license: string
}

function selectCover(
	tags: string[],
	index: number,
	title: string,
	body: string,
	assets: Asset[],
): Asset | undefined {
	const byId = (id: string) => assets.find((asset) => asset.id === id)
	const text = `${title} ${body}`
	if (tags.includes('sports')) {
		const sportCover = (value: string) => {
			if (/羽毛|羽球/.test(value))
				return byId(index % 2 ? 'photo-badminton' : 'photo-shuttle')
			if (/篮球|投篮|三分|上篮|篮板/.test(value))
				return byId(index % 2 ? 'photo-court' : 'photo-court-blue')
			if (/慢跑|夜跑|晨跑|配速|跑步|跑道/.test(value))
				return byId('photo-track')
			return undefined
		}
		// An explicit sport in the title wins over incidental warm-up/running in the body.
		return sportCover(title) ?? sportCover(text)
	}
	if (tags.includes('volunteer')) {
		// Sorting, counting or a certificate alone does not establish a book-related activity.
		if (
			!/旧书|图书|书籍|书本|书架|书目|书刊|书页|捐书|借书|还书|二手书/.test(
				text,
			)
		)
			return undefined
		return byId(index % 2 ? 'photo-books' : 'photo-old-books')
	}
	if (tags.includes('technology')) return byId('photo-code')
	if (tags.includes('music')) {
		if (/吉他/.test(text)) return byId('photo-guitar')
		// Do not randomly assign a guitar to every musical instrument.
		if (/钢琴|小提琴|大提琴|架子鼓|电子琴|尤克里里|古筝|二胡/.test(text))
			return undefined
		if (/琴弦|拨片/.test(text)) return byId('photo-guitar')
		return byId(index % 2 ? 'photo-microphone' : 'photo-stage')
	}
	if (tags.includes('photography')) {
		if (/落叶|秋天|秋日/.test(text)) return byId('photo-autumn')
		return byId(index % 2 ? 'photo-camera' : 'photo-gear')
	}
	const matches = assets.filter((asset) =>
		asset.tags.some((tag) => tags.includes(tag)),
	)
	return matches.length ? matches[index % matches.length] : undefined
}

function stableIdHash(id: string): number {
	let hash = 2166136261
	for (const character of id) {
		hash ^= character.codePointAt(0) ?? 0
		hash = Math.imul(hash, 16777619)
	}
	return hash >>> 0
}

/** Pure content-tool projection. Unknown/uploaded media and real posts are retained. */
export function attachMedia(snapshot: Snapshot, assets: Asset[]): Snapshot {
	const stockIds = new Set(assets.map((asset) => asset.id))
	const reassignable = snapshot.posts.filter(
		(post) =>
			post.source === 'Synthetic' &&
			!post.mediaIds?.some((id) => !stockIds.has(id)),
	)
	const candidates = reassignable.flatMap((post) => {
		const hash = stableIdHash(post.id)
		const media = selectCover(post.tags, hash, post.title, post.body, assets)
		return media ? [{ id: post.id, hash, media }] : []
	})
	candidates.sort(
		(a, b) => a.hash - b.hash || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1),
	)
	// Select a fixed quota by stable ID, so input order and GUIDE frequency cannot skew the mix.
	// A smaller compatible photo pool intentionally produces more title posters.
	const photoCount = Math.round(reassignable.length * 0.35)
	const photos = new Map(
		candidates
			.slice(0, photoCount)
			.map((candidate) => [candidate.id, candidate.media]),
	)
	const reassignableIds = new Set(reassignable.map((post) => post.id))
	return {
		...snapshot,
		activities: snapshot.activities.map((activity, index) => {
			if (
				activity.source === 'Real' ||
				(activity.coverId && !stockIds.has(activity.coverId))
			)
				return activity
			return {
				...activity,
				coverId:
					selectCover(
						activity.tags,
						index,
						activity.title,
						activity.body,
						assets,
					)?.id ?? null,
			}
		}),
		posts: snapshot.posts.map((post) => {
			if (!reassignableIds.has(post.id)) return post
			const media = photos.get(post.id)
			return {
				...post,
				mediaIds: media ? [media.id] : [],
				purpose:
					post.purpose ?? (post.activityId ? 'RECRUITMENT' : 'DISCUSSION'),
			}
		}),
	}
}
