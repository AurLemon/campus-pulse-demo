export default defineEventHandler(() => {
	throw createError({ statusCode: 405, statusMessage: 'STUDIO_READ_ONLY' })
})
