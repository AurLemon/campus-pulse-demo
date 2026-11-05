import { topics, voices, intents, facets, contexts } from './catalog.ts'
import type { WrittenActivity } from './model-content.ts'
export function linkedActivityIndex(
	index: number,
	activityCount: number,
): number | null {
	if (index < activityCount) return index
	return (index - activityCount) % 3 === 0
		? Math.floor((index - activityCount) / 3) % activityCount
		: null
}
export function postIntent(index: number, activityCount: number): string {
	if (index < activityCount)
		return '活动招募通知，讲清活动方式与参与条件，不虚构时间名额'
	const activityIndex = linkedActivityIndex(index, activityCount)
	let intent = intents[(Math.floor(index / 8) + index) % intents.length]!
	if (
		activityIndex !== null &&
		(activityIndex % 3 !== 2 ||
			(activityIndex > 5 && activityIndex % 29 === 0)) &&
		intent.includes('回顾')
	)
		intent = '分享活动准备中的困难'
	return intent
}
export function isActivityReview(
	index: number,
	activityCount: number,
): boolean {
	return (
		linkedActivityIndex(index, activityCount) !== null &&
		postIntent(index, activityCount).includes('回顾')
	)
}
export function contentPlan(
	index: number,
	size: 'small' | 'full',
	activities: WrittenActivity[],
) {
	const activityCount = size === 'full' ? 120 : 6,
		activityIndex = linkedActivityIndex(index, activityCount),
		t = topics[(activityIndex ?? index) % topics.length]!,
		comments =
			size === 'full'
				? [0, 0, 1, 2, 2, 3, 4, 6][index % 8]!
				: [2, 0, 1, 3][index % 4]!
	return {
		id: `p${index + 1}`,
		topic: `${t.topic}，具体讨论${facets[t.tag]![Math.floor(index / 8) % 15]}，情境：${contexts[Math.floor(index / 120) % 10]}`,
		commentVoices: Array.from(
			{ length: comments },
			(_, j) =>
				voices[
					((index + j + 3) % (size === 'full' ? 180 : 17)) % voices.length
				],
		),
		intent: `${postIntent(index, activityCount)}。选择具体生活切入点，不重复空泛感想。第${index + 1}条`,
		voice:
			voices[
				(size === 'full' && index < activityCount
					? index % 24
					: index % (size === 'full' ? 70 : 12)) % voices.length
			]!,
		replyRequired:
			comments > 0
				? '第一条评论reply必须是字符串，其余必须null'
				: '无评论无回复',
		activity:
			activityIndex === null ? undefined : activities[activityIndex]?.title,
		activityBody:
			activityIndex === null ? undefined : activities[activityIndex]?.body,
		authorRole:
			activityIndex === null
				? '普通发帖者'
				: index < activityCount
					? '本场组织者，正式通知，不能另定与活动说明冲突的参加规则'
					: '本场参与者或关注者，只能谈自己准备与疑问，不能宣布主办流程、名额或要求',
		activityPhase:
			activityIndex === null
				? '没有关联活动'
				: activityIndex > 5 && activityIndex % 29 === 0
					? '活动已取消，只讨论取消前的准备或替代安排，不声称参加过本场活动'
					: activityIndex % 3 === 2
						? '活动已结束，招募帖为保留的历史通知，其余按意图可回顾'
						: '活动尚未举办，只能写计划、招募或准备，禁止声称已经参加或回顾本场活动',
		comments,
		replies: comments > 0 ? 1 : 0,
	}
}
