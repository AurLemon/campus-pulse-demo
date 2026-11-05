import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
	ensureContentCache,
	packContentCache,
	writeContentCacheFile,
} from './bundle.ts'
import { topics } from './catalog.ts'
import { writeActivities, type WrittenActivity } from './model-content.ts'
if (process.argv.includes('--dry-run')) {
	console.log(
		JSON.stringify({
			mode: 'dry-run',
			action: 'small-content',
			activities: 6,
			cacheOpened: false,
		}),
	)
	process.exit(0)
}
const contentCache = await ensureContentCache()
const plans = topics.slice(0, 6).map((topic, index) => ({
	id: `a${index + 1}`,
	topic: topic.topic,
	location: topic.place,
	voice: topic.voice,
}))
const file = join(contentCache, 'small-activities.json')
let content: WrittenActivity[]
try {
	content = JSON.parse(await readFile(file, 'utf8')) as WrittenActivity[]
	if (
		!Array.isArray(content) ||
		content.length !== plans.length ||
		content.some(
			(activity, index) =>
				activity.id !== plans[index]?.id ||
				typeof activity.title !== 'string' ||
				!activity.title.trim() ||
				typeof activity.body !== 'string' ||
				activity.body.length < 25,
		)
	)
		throw new Error('ACTIVITY_CACHE_INVALID')
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	content = await writeActivities('small-activities-v1', plans)
	await writeContentCacheFile(file, JSON.stringify(content, null, '\t'))
}

const contentBundle = await packContentCache()
if (!contentBundle.cacheStateUpdated)
	throw new Error(
		'CONTENT_BUNDLE_STATE_PENDING: archive published; run data:unpack before changing the cache',
	)
console.log(JSON.stringify({ activities: content.length, contentBundle }))
