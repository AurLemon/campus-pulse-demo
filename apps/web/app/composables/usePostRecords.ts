import type { Bootstrap, PostView } from '@campus/contracts'

/** Keep list counters in sync with a refreshed detail, scoped to the signed-in viewer. */
export function usePostRecords() {
	const { data: campus } = useNuxtData<Bootstrap>('campus')
	const records = useState<Record<string, PostView>>('post-records', () => ({}))
	const key = (id: string) => `${campus.value?.user?.id ?? 'guest'}:${id}`
	function remember(post: PostView) {
		records.value[key(post.id)] = post
		const keys = Object.keys(records.value)
		if (keys.length > 200)
			records.value = Object.fromEntries(
				keys.slice(-200).map((entry) => [entry, records.value[entry]!]),
			)
	}
	const find = (id: string) => records.value[key(id)]
	return { remember, find }
}
