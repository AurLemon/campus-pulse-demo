# Campus Pulse

A campus activity and content community.

- Poster feeds for activities and community content
- Event registration, follows, friends, and discussions
- Shared explainable Top-K recommendation engine

## Structure

```
apps/web       product Nuxt app
apps/studio    recommendation visualization app
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
pnpm dev # Web: http://127.0.0.1:3000
```

Run `pnpm dev:studio` in another terminal for Studio at `http://127.0.0.1:3001`.

Use `pnpm data:seed` to import bundled content before starting Web. `pnpm build` builds both apps.

See [Usage](docs/USAGE.md) and [Studio](apps/studio/README.md) for details.
