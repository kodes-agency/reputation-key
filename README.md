# Reputation Key

A reputation management platform built with TanStack Start, Better Auth, Drizzle ORM, and PostgreSQL.

## Quick Start

```bash
# 0. Use the pinned Node runtime — 22.23.2, exactly (.nvmrc)
fnm use            # or: nvm use
# Not a floor: the local stack fails ENOBUFS mid-boot on another major, and the
# ICU-fenced AI-language suites (~150 assertions) skip themselves. Check with:
pnpm local:doctor  # runtime, docker daemon, stack ports, stale containers

# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and BETTER_AUTH_SECRET

# 3. Set up the database
pnpm db:bootstrap-auth
pnpm auth:migrate
pnpm db:migrate
pnpm db:google-property-binding-index
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/migrations/2026-07-06-permission-version-triggers.sql

# 4. Generate auth secret (if not set)
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('base64url'))"

# 5. Start dev server
pnpm dev
```

## Architecture

- **Web app**: TanStack Start (React + SSR) — `pnpm dev` / `pnpm build` / `pnpm start`
- **Worker**: Plain Node.js script — `pnpm build:worker` / `pnpm start:worker`
- **Database**: PostgreSQL via Drizzle ORM; production state is co-located per Railway Data Cell
- **Auth**: Better Auth with DB-backed sessions
- **Redis**: Optional in basic development; physically separate Cache Redis and Queue Redis are required per production Data Cell

## Scripts

| Command             | Description                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`          | Start dev server on :3000                                                                                                         |
| `pnpm build`        | Build web app                                                                                                                     |
| `pnpm build:worker` | Build worker                                                                                                                      |
| `pnpm start`        | Run built web server                                                                                                              |
| `pnpm start:worker` | Run built worker                                                                                                                  |
| `pnpm test`         | Run unit tests                                                                                                                    |
| `pnpm test:e2e`     | Run Playwright E2E tests                                                                                                          |
| `pnpm typecheck`    | TypeScript check (src/services/e2e + the release scripts project)                                                                 |
| `pnpm lint`         | ESLint + filename/component-boundary checks                                                                                       |
| `pnpm lint:ci`      | `lint` + test-quality + Google/AI artifact gates                                                                                  |
| `pnpm format`       | Prettier format                                                                                                                   |
| `pnpm release:beta` | Legacy readiness/deploy harness; production promotion remains prohibited until the signed-image/cell release contract is complete |

### Git hooks

Husky is configured with two gates:

- **pre-commit** — runs `lint-staged` (eslint --fix + prettier --write on staged files)
- **pre-push** — runs `pnpm typecheck`, plus the Google/AI artifact attestation
  gates when the push touches their hash-pinned inputs

Install hooks after cloning: `pnpm install` (the `prepare` script registers Husky automatically).

## Project Structure

```
src/
├── contexts/       # Bounded business domains; Team is retained only as a quarantined migration package
│   └── <name>/    # Each has: domain/, application/, infrastructure/, server/
├── components/     # React UI
│   ├── ui/        # shadcn primitives
│   ├── forms/     # shared form blocks (SubmitButton, FormErrorBanner, etc.)
│   ├── layout/    # app shell (sidebars, header, top bar)
│   ├── hooks/     # shared hooks (useMutationAction, useAction, usePropertyId)
│   └── features/  # domain-concept folders (portal/, identity/, property/, inbox/, etc.)
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
