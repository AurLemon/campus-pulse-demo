import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AgentPersona } from '../../packages/contracts/agents.ts'
import { resolveSnapshotFile } from '../../tools/content/snapshot-bundle.ts'
import { store, setting, configure, MAX_ACTORS } from './store.ts'
interface PublicActor {
	humanControlled?: boolean
	id: string
	name: string
	campus: string
	interests: string[]
	followingIds: string[]
	friendIds?: string[]
}
export async function syncPersonas(actors: PublicActor[]) {
	let authored: Record<string, Partial<AgentPersona>> = {}
	try {
		authored = JSON.parse(
			await readFile(resolve('.data/agents/personas.json'), 'utf8'),
		) as typeof authored
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
	}
	try {
		const generated = JSON.parse(
			await readFile(
				resolve('.data/content-cache/pulse-natural-v3/personas.json'),
				'utf8',
			),
		) as Array<Partial<Omit<AgentPersona, 'interests'>> & { id: string }>
		for (const person of generated) {
			authored[person.id] = {
				...authored[person.id],
				voice: person.voice,
				className: person.className,
				recentEvents:
					person.recentEvents ?? (person.routine ? [person.routine] : []),
				routine: person.routine,
				circle: person.circle,
				circles: person.circles,
				secondaryInterests: person.secondaryInterests,
				lifeContext: person.lifeContext,
				onlineHabits: person.onlineHabits,
				profileAsOf: person.profileAsOf,
				ordinaryLifeFacts: person.ordinaryLifeFacts,
				currentMotives: person.currentMotives,
				writingHabits: person.writingHabits,
				knowledgeEdges: person.knowledgeEdges,
				engagementBias: person.engagementBias,
			}
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
	}
	// Supplement internal persona instructions only. Live actor identities still come exclusively from the product database.
	try {
		const supplemental = JSON.parse(
			await readFile(await resolveSnapshotFile('ads-personas.json'), 'utf8'),
		) as Array<Partial<AgentPersona> & { id?: string }>
		for (const person of supplemental) {
			const id = person.actorId ?? person.id
			if (id) authored[id] = { ...person, ...authored[id] }
		}
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
	}

	const insert = store.prepare(
		'INSERT INTO personas(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
	)
	store.transaction(() => {
		for (const actor of actors.slice(0, MAX_ACTORS)) {
			const seed = createHash('sha256')
				.update(actor.id)
				.digest()
				.readUInt32BE(0)
			const grade = 1 + (seed % 4)
			const base: AgentPersona = {
				actorId: actor.id,
				name: actor.name,
				campus: actor.campus,
				grade,
				className: `${2027 - grade}级${1 + ((seed >>> 5) % 8)}班`,
				interests: actor.interests,
				activeHours:
					seed % 3 === 0
						? [7, 8, 12, 18, 19]
						: seed % 3 === 1
							? [12, 13, 18, 20, 21]
							: [15, 18, 21, 22, 23],
				activityWeight: seed % 10 < 3 ? 0.25 : seed % 10 < 8 ? 0.6 : 0.9,
				cooldownMinutes: 5 + (seed % 15),
				relationships: (actor.friendIds ?? []).slice(0, 12),
				voice: '',
				recentEvents: [],
			}
			const extra = authored[actor.id] ?? {}
			insert.run(
				actor.id,
				JSON.stringify({
					...base,
					...extra,
					actorId: actor.id,
					name: actor.name,
					campus: actor.campus,
					interests: actor.interests,
					relationships: (actor.friendIds ?? []).slice(0, 12),
					followingIds: actor.followingIds.slice(0, 16),
					socialEdges: [
						...(actor.friendIds ?? [])
							.slice(0, 12)
							.map((actorId) => ({ actorId, kind: 'friend' })),
						...actor.followingIds
							.filter((id) => !actor.friendIds?.includes(id))
							.slice(0, 16)
							.map((actorId) => ({ actorId, kind: 'following' })),
					],
				}),
			)
		}
	})()
	const actual = Math.min(MAX_ACTORS, actors.length)
	if (actual > 200 && setting('actorPopulationVersion', 0) < 1) {
		if (setting('actorLimit', actual) === 200) configure('actorLimit', actual)
		configure('actorPopulationVersion', 1)
	}
}
