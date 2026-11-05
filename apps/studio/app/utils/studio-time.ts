import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

dayjs.extend(utc)
dayjs.extend(timezone)

export const STUDIO_TIME_ZONE = 'Asia/Taipei'
const INPUT_FORMAT = 'YYYY-MM-DDTHH:mm'

export function formatStudioClock(value: string): string {
	const date = dayjs(value)
	return date.isValid() ? date.tz(STUDIO_TIME_ZONE).format(INPUT_FORMAT) : ''
}

export function parseStudioClock(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return ''
	try {
		const date = dayjs.tz(value, STUDIO_TIME_ZONE)
		return date.isValid() && date.format(INPUT_FORMAT) === value
			? date.toISOString()
			: ''
	} catch {
		return ''
	}
}
