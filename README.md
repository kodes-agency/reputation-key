# Reputation Key

A reputation management platform built with TanStack Start, Better Auth, Drizzle ORM, and PostgreSQL.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and BETTER_AUTH_SECRET

# 3. Set up the database
pnpm db:push          # Push schema to DB (dev)
# or
pnpm db:generate      # Generate migration SQL
pnpm db:migrate       # Apply migrations

# 4. Generate auth secret (if not set)
npx -y @better-auth/cli secret

# 5. Start dev server
pnpm dev
```

## Architecture

- **Web app**: TanStack Start (React + SSR) — `pnpm dev` / `pnpm build` / `pnpm start`
- **Worker**: Plain Node.js script — `pnpm build:worker` / `pnpm start:worker`
- **Database**: PostgreSQL (Neon) via Drizzle ORM
- **Auth**: Better Auth with DB-backed sessions
- **Redis**: Optional in dev, required for queues/caching in production

## Scripts

| Command             | Description               |
| ------------------- | ------------------------- |
| `pnpm dev`          | Start dev server on :3000 |
| `pnpm build`        | Build web app             |
| `pnpm build:worker` | Build worker              |
| `pnpm start`        | Run built web server      |
| `pnpm start:worker` | Run built worker          |
| `pnpm test`         | Run unit tests            |
| `pnpm test:e2e`     | Run Playwright E2E tests  |
| `pnpm typecheck`    | TypeScript check          |
| `pnpm lint`         | ESLint                    |
| `pnpm format`       | Prettier format           |

### Git hooks

Husky is configured with two gates:

- **pre-commit** — runs `lint-staged` (eslint --fix + prettier --write on staged files)
- **pre-push** — runs `pnpm typecheck && pnpm lint && pnpm test`

Install hooks after cloning: `pnpm install` (the `prepare` script registers Husky automatically).

## Project Structure

```
src/
├── contexts/       # Bounded business domains (identity, property, portal, guest, team, staff)
│   └── <name>/    # Each has: domain/, application/, infrastructure/, server/
├── components/     # React UI
│   ├── ui/        # shadcn primitives
│   ├── forms/     # shared form blocks (SubmitButton, FormErrorBanner, etc.)
│   ├── layout/    # app shell (sidebars, header, top bar)
│   ├── hooks/     # shared hooks (useMutationAction, useAction, usePropertyId)
│   └── features/  # domain-concept folders (portal/, identity/, property/, team/, etc.)
├── shared/         # Cross-cutting infrastructure
│   ├── auth/      # Better Auth config, middleware, permissions
│   ├── cache/     # Redis client + cache port/impl
│   ├── config/    # Zod-validated env schema
│   ├── db/        # Drizzle ORM, pool, schema/, migrations
│   ├── domain/    # Brand types, IDs, roles, permissions, clock, Result
│   ├── events/    # Event bus, master DomainEvent union
│   ├── jobs/      # BullMQ queue, worker, registry
│   ├── hooks/     # usePermissions
│   ├── observability/ # Pino logger, request tracing (tracedHandler)
│   ├── rate-limit/ # Rate limiting middleware
│   ├── testing/   # In-memory port fakes, test fixtures
│   └── fn/        # pipe and other utilities
├── routes/         # TanStack Router file-based routes
│   └── _authenticated/ # Protected routes with layout shell
├── hooks/          # Low-level utility hooks (use-as-ref, use-lazy-ref)
├── lib/            # Shared utilities (utils, compose-refs, lookups)
├── composition.ts  # Dependency wiring
├── bootstrap.ts    # Event/job handler registration
└── worker/         # Background worker entry point
```
