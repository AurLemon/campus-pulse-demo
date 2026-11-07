export interface MentionUser {
	id: string
	name: string
}
export interface TextMention {
	start: number
	end: number
	userId: string
	label: string
}

/** Resolve complete, unambiguous display names outside URLs, email and code. */
export function resolveMentions(
	text: string,
	users: MentionUser[],
): TextMention[] {
	if (!/[@＠]/u.test(text)) return []
	const names = new Map<string, string | null>()
	for (const user of users) {
		if (!user.name) continue
		names.set(user.name, names.has(user.name) ? null : user.id)
	}
	const candidates = [...names]
		.filter((entry): entry is [string, string] => !!entry[1])
		.sort((a, b) => b[0].length - a[0].length)
	const excluded = [
		...text.matchAll(
			/```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s]+|www\.[^\s]+/giu,
		),
	].map((match) => ({ start: match.index, end: match.index + match[0].length }))
	const mentions: TextMention[] = []
	let end = 0
	for (const match of text.matchAll(/[@＠]/gu)) {
		const start = match.index
		if (
			start < end ||
			/[a-zA-Z0-9._%+/-]/.test(text[start - 1] ?? '') ||
			excluded.some((range) => start >= range.start && start < range.end)
		)
			continue
		const candidate = candidates.find(([name]) => {
			if (!text.startsWith(name, start + 1)) return false
			const following = text[start + 1 + name.length]
			return !following || !/[\p{L}\p{N}_-]/u.test(following)
		})
		if (!candidate) continue
		end = start + 1 + candidate[0].length
		mentions.push({
			start,
			end,
			userId: candidate[1],
			label: text.slice(start, end),
		})
	}
	return mentions
}
