import {
	listConversationPage,
	listNotifications,
	listFriendRequests,
} from '@campus/domain/messages'
import { api, actor } from '../../utils/api'
export default api(async (event) => {
	const user = await actor(event)
	const [page, notifications, friendRequests] = await Promise.all([
		listConversationPage(user.id),
		listNotifications(user.id),
		listFriendRequests(user.id),
	])
	return {
		conversations: page.items,
		conversationNextCursor: page.nextCursor,
		conversationHasMore: page.hasMore,
		notifications,
		friendRequests,
	}
})
