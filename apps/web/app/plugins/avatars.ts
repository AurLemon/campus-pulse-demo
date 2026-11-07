import type { MentionUser } from '@campus/contracts/mentions'
interface AvatarEntry {
	id: string
	name: string
	avatar: string
}
export default defineNuxtPlugin(async () => {
	const mentionUsers = useState<MentionUser[]>('public-mention-users', () => [])
	const index = useState<Record<string, string>>(
		'public-avatar-index',
		() => ({}),
	)
	const { data } = await useFetch<AvatarEntry[]>('/api/avatars', {
		key: 'public-avatars',
	})
	mentionUsers.value = (data.value ?? []).map(({ id, name }) => ({ id, name }))
	const names = new Map<string, string | null>()
	for (const entry of data.value ?? [])
		names.set(entry.name, names.has(entry.name) ? null : entry.avatar)
	index.value = Object.fromEntries(
		[...names].filter((entry): entry is [string, string] => Boolean(entry[1])),
	)
})
