<script setup lang="ts">
interface HeartReactionProps {
	liked: boolean
	count: number
	busy?: boolean
	bursting?: boolean
}
defineProps<HeartReactionProps>()
const { t } = useI18n()
</script>
<template>
	<button
		type="button"
		class="card-heart"
		:class="{ 'is-liked': liked, 'is-bursting': bursting }"
		:aria-label="t(liked ? 'ui.liked' : 'ui.like')"
		:aria-pressed="liked"
		:disabled="busy"
	>
		<span class="card-heart-glyph"
			><ReactionIcon kind="heart" :active="liked" />
			<span v-if="bursting" class="card-heart-particle" aria-hidden="true"
				><ReactionIcon kind="heart" active
			/></span> </span
		>{{ count }}
	</button>
</template>
<style scoped>
.card-heart-glyph {
	position: relative;
	display: flex;
}
.card-heart-glyph :deep(svg) {
	width: 15px;
	height: 15px;
}
.is-bursting .card-heart-glyph > :first-child {
	animation: card-heart-pop 450ms ease;
}
.card-heart-particle {
	position: absolute;
	inset: 0;
	pointer-events: none;
	animation: card-heart-float 700ms ease-out forwards;
}
@keyframes card-heart-pop {
	0%,
	100% {
		transform: scale(1);
	}
	35% {
		transform: scale(1.3) rotate(-10deg);
	}
	65% {
		transform: scale(0.92);
	}
}
@keyframes card-heart-float {
	0% {
		opacity: 0;
		transform: translateY(0) scale(0.6);
	}
	20% {
		opacity: 0.85;
	}
	100% {
		opacity: 0;
		transform: translate(7px, -30px) scale(0.8) rotate(16deg);
	}
}
@media (prefers-reduced-motion: reduce) {
	.is-bursting .card-heart-glyph > :first-child {
		animation: none;
	}
	.card-heart-particle {
		display: none;
	}
}
</style>
