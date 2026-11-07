<script setup lang="ts">
import {
	resolveMentions,
	type MentionUser,
	type TextMention,
} from '@campus/contracts/mentions'
interface MentionTextProps {
	text: string
	mentions?: TextMention[]
}
interface TextSegment {
	start: number
	text: string
	userId?: string
}
const props = withDefaults(defineProps<MentionTextProps>(), {
	mentions: undefined,
})
const users = useState<MentionUser[]>('public-mention-users', () => [])
const segments = computed<TextSegment[]>(() => {
	const parts: TextSegment[] = []
	let offset = 0
	for (const mention of props.mentions ??
		resolveMentions(props.text, users.value)) {
		if (mention.start > offset)
			parts.push({
				start: offset,
				text: props.text.slice(offset, mention.start),
			})
		parts.push({
			start: mention.start,
			text: mention.label,
			userId: mention.userId,
		})
		offset = mention.end
	}
	if (offset < props.text.length)
		parts.push({ start: offset, text: props.text.slice(offset) })
	return parts
})
</script>
<template>
	<template v-for="segment in segments" :key="segment.start"
		><NuxtLink
			v-if="segment.userId"
			:to="`/users/${encodeURIComponent(segment.userId)}`"
			class="content-mention"
			@click.stop
			>{{ segment.text }}</NuxtLink
		><template v-else>{{ segment.text }}</template></template
	>
</template>
<style scoped>
.content-mention {
	color: var(--accent, #3b82f6);
	text-decoration: none;
}
.content-mention:hover {
	text-decoration: underline;
}
</style>
