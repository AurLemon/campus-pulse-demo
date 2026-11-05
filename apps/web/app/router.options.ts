import type { RouterConfig } from '@nuxt/schema'

export default <RouterConfig>{
	scrollBehavior(to, from, savedPosition) {
		// The discovery page restores its own data checkpoint and scroll position after mounting.
		// Reading window.scrollY here can observe the shorter destination DOM and overwrite that checkpoint.
		if (to.path === '/') return false
		if (
			to.path === from.path &&
			(to.query.post !== from.query.post ||
				to.query.activity !== from.query.activity ||
				to.query.auth !== from.query.auth ||
				to.query.compose !== from.query.compose)
		)
			return false
		return savedPosition ?? { left: 0, top: 0 }
	},
}
