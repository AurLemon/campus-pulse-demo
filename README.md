# Campus Pulse

A campus activity, reading and content community.

- Poster feeds for activities and community content
- Event registration, follows, friends, and discussions
- Explainable activity Top-K and book Top-N recommendations
- User/item collaborative filtering, content profiles and optional shared interests
- Private messages, notifications and a separately managed community-agent runtime

## Structure

```
apps/web       product Nuxt app
apps/studio    recommendation visualization and runtime control
apps/agents    independent community worker
packages/      contracts, domain, TypeScript recommendation engine
tools/         content maintenance
prisma/        SQLite schema
docs/          usage docs
```

## Tech Stack

- Nuxt 4, Vue 3, TypeScript, Nuxt UI and Tailwind CSS; TDesign for activity administration
- Prisma 7 with SQLite; explainable recommendation engine using a Top-K min-heap, with weight, score, and heap playback in Studio

## Development

Node 24.x (24.15+) and pnpm 12.5.1.

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm dev # Web + Studio (parallel)
```

`pnpm dev` starts Web, Studio and its independent Agent worker together. Web starts from port 3000, Studio searches sequentially from the selected Web port + 1. Occupied ports are skipped and the final URLs are printed. Use `pnpm dev --port 3100` to choose another starting Web port. `pnpm dev:web` starts only Web; `pnpm dev:studio` starts only Studio and its worker alongside an existing Web server. Each persistent worker startup enables automatic scheduling with unlimited spending and decision counts, preserving ledger entries, unknown-usage reservations and concurrency settings. See [Agent runtime](docs/COMMUNITY_AGENTS.md) before starting model calls.

Use `pnpm data:seed` to import the final community preset (`natural-v3-media.json`) before starting Web. Restore real book metadata with `pnpm data:books:unpack` and `pnpm data:books`. Optional `pnpm data:books --seed-demo` creates recorded demonstration borrowing history. Existing user content is preserved. `pnpm build` builds both apps.

For a fresh checkout, follow [Setup and data import](docs/SETUP.md), including optional project-local model configuration. See [Usage](docs/USAGE.md) and [Studio](apps/studio/README.md) for details.

## License

Copyright (c) 2026 AurLemon (Lin Junle). Project code is licensed under the [MIT License](LICENSE).
