import { resolveSnapshotFile } from './snapshot-bundle.ts'
import { readFile } from 'node:fs/promises'
import type { Snapshot } from '@campus/contracts'

export interface CommunityPersona {
	id: string
	name: string
	bio: string
	style: 'prose' | 'lines' | 'spaces' | 'casual' | 'mixed'
	circle: string
}
export interface NaturalThread {
	id: string
	before: string
	body: string
	comments: Array<{ id: string; before: string; body: string }>
}
export interface NaturalContent {
	version: 2
	source: 'Synthetic'
	personas: CommunityPersona[]
	threads: NaturalThread[]
}

export async function readNaturalContent(): Promise<NaturalContent | null> {
	try {
		return JSON.parse(
			await readFile(
				await resolveSnapshotFile('community-natural-v2.json'),
				'utf8',
			),
		) as NaturalContent
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
		throw error
	}
}
// These are author-specific typography preferences, not semantic rewrites.
// Formal notices and long articles retain their carefully reviewed structure.
function typography(body: string, style: CommunityPersona['style']): string {
	if (style === 'prose' || style === 'mixed') return body
	if (style === 'casual') return body.replace(/。$/, '')
	if (style === 'lines') return body.replace(/。\s*/g, '\n').trim()
	return body.replace(/。\s*/g, '  ').replace(/，/g, ' ').trim()
}
export async function applyNaturalContent(snapshot: Snapshot): Promise<void> {
	const content = await readNaturalContent()
	if (!content) return
	const personas = new Map(content.personas.map((p) => [p.id, p]))
	for (const user of snapshot.users) {
		const persona = personas.get(user.id)
		if (!persona) continue
		user.name = persona.name
		user.bio = persona.bio
	}
	for (const post of snapshot.posts) {
		const persona = personas.get(post.authorId)
		if (!persona || post.activityId || post.kind === 'ARTICLE') continue
		post.body = typography(post.body, persona.style)
	}
	for (const comment of snapshot.comments) {
		const persona = personas.get(comment.authorId)
		if (persona) comment.body = typography(comment.body, persona.style)
	}
	const posts = new Map(snapshot.posts.map((p) => [p.id, p]))
	const comments = new Map(snapshot.comments.map((c) => [c.id, c]))
	for (const thread of content.threads) {
		const post = posts.get(thread.id)
		const persona = post && personas.get(post.authorId)
		if (
			!post ||
			!persona ||
			post.body !== typography(thread.before, persona.style)
		)
			continue
		post.body = thread.body
		for (const patch of thread.comments) {
			const comment = comments.get(patch.id)
			const voice = comment && personas.get(comment.authorId)
			if (
				comment &&
				voice &&
				comment.postId === post.id &&
				comment.body === typography(patch.before, voice.style)
			)
				comment.body = patch.body
		}
	}
}
