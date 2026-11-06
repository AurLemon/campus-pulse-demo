/** Local default portraits shared by current and newly registered accounts. */
export function defaultUserAvatar(id: string): string {
	// Preserve the portraits already assigned to the original 200 accounts.
	const existing = /^u([1-9][0-9]*)$/.exec(id)
	const number = existing ? Number(existing[1]) : 0
	if (number >= 1 && number <= 200) return `/media/anime-avatar-u${number}.webp`
	let hash = 2166136261
	for (const character of id) {
		hash ^= character.codePointAt(0) ?? 0
		hash = Math.imul(hash, 16777619)
	}
	return `/media/anime-avatar-u${((hash >>> 0) % 200) + 1}.webp`
}
