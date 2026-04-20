# Reputation Key — Project Context

## Project Overview

**Name:** reputation-key
**Framework:** TanStack Start (React) — full-stack app with file-based routing
**Package Manager:** pnpm
**Runtime:** Node.js 22 (web: Nitro, worker: plain Node)

## Architecture

### Two-Process Deployment

| Service    | Entry                 | Build                      | Runtime                         |
| ---------- | --------------------- | -------------------------- | ------------------------------- |
| **Web**    | Vite → Nitro SSR      | `pnpm build`               | `node .output/server/index.mjs` |
| **Worker** | `src/worker/index.ts` | `pnpm build:worker` (tsup) | `node dist-worker/index.js`     |

The web process is a TanStack Start app using Nitro for SSR. The worker is a plain Node script that imports from shared code — no Nitro, no SSR.

### Directory Structure

```
src/
├── components/          # Shared UI components (Header, Footer, etc.)
├── contexts/             # Business domain vertical slices (Phase 5+)
│   └── (property/, review/, portal/, etc.)
├── integrations/         # Framework integrations
│   └── tanstack-query/   # Query client provider + devtools
├── lib/                  # Shared utilities (cn helper, etc.)
├── routes/               # TanStack Start file-based routes
│   ├── __root.tsx         # Shell component
│   ├── index.tsx           # Home page
│   └── api/
│       ├── auth/$.ts       # Better Auth handler
│       └── health/index.ts # Health check endpoint
├── shared/               # Shared domain infrastructure
│   ├── auth/              # Better Auth server + client config
│   ├── cache/             # Redis client factory
│   ├── config/            # Zod-validated env schema
│   ├── db/                # Drizzle ORM (pg driver)
│   │   └── schema/        # Table definitions + barrel
│   ├── domain/            # Brand types, Result, IDs
│   ├── events/            # Event bus (Phase 4)
│   ├── health/            # Health check server function
│   ├── jobs/              # BullMQ queue/worker (Phase 4)
│   ├── observability/     # Logger (pino)
│   ├── rate-limit/        # Rate limiting (Phase 4)
│   └── testing/           # Test helpers (Phase 4)
├── worker/                # Background worker entry point
├── styles.css             # Tailwind v4 + CSS tokens
├── router.tsx             # Router creation
├── test-setup.ts          # Vitest global setup
└── vite-env.d.ts          # Vite type declarations
```

### Context Pattern (Phase 5+)

Each business domain lives in `src/contexts/<domain>/`:

```
contexts/<domain>/
├── domain/            # Types, rules, constructors, events, errors
├── application/       # Use cases, ports, DTOs
├── infrastructure/    # Repositories, adapters, mappers
└── server/            # TanStack Start server functions
```

## Key Integrations

| Integration        | Purpose                                    | Key Files                                                   |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| **TanStack Start** | Full-stack React framework                 | `src/router.tsx`, `vite.config.ts`                          |
| **TanStack Query** | Server state management                    | `src/integrations/tanstack-query/`                          |
| **Better Auth**    | Email+password auth with DB sessions       | `src/shared/auth/auth.ts`, `src/shared/auth/auth-client.ts` |
| **Drizzle ORM**    | Type-safe ORM for PostgreSQL (pg driver)   | `src/shared/db/`, `drizzle.config.ts`                       |
| **Zod v4**         | Runtime validation & env schema            | `src/shared/config/env.ts`                                  |
| **Pino**           | Structured logging                         | `src/shared/observability/logger.ts`                        |
| **ioredis**        | Redis client (queue, cache, rate limiting) | `src/shared/cache/redis.ts`                                 |
| **BullMQ**         | Job queues (Phase 4+)                      | `src/shared/jobs/` (empty placeholder)                      |
| **Shadcn**         | UI component library                       | `components.json`, `src/lib/utils.ts`                       |
| **Tailwind v4**    | Utility-first CSS                          | `src/styles.css`                                            |

## Environment Variables

| Variable              | Purpose                                     | Required |
| --------------------- | ------------------------------------------- | -------- |
| `DATABASE_URL`        | Neon PostgreSQL connection string           | Yes      |
| `DATABASE_URL_POOLER` | Neon pooler connection (optional)           | No       |
| `BETTER_AUTH_SECRET`  | Auth signing key (≥32 chars)                | Yes      |
| `BETTER_AUTH_URL`     | Base URL for auth (`http://localhost:3000`) | Yes      |
| `REDIS_URL`           | Redis connection (optional in dev)          | No       |
| `LOG_LEVEL`           | Pino log level (default: `info`)            | No       |

All env vars are validated via Zod in `src/shared/config/env.ts`. Missing required vars throw on startup.

## Scripts

| Command             | Purpose                       |
| ------------------- | ----------------------------- |
| `pnpm dev`          | Start dev server on port 3000 |
| `pnpm build`        | Build web app (Nitro output)  |
| `pnpm build:worker` | Build worker with tsup        |
| `pnpm start`        | Run built web server          |
| `pnpm start:worker` | Run built worker              |
| `pnpm test`         | Run tests (Vitest)            |
| `pnpm test:watch`   | Run tests in watch mode       |
| `pnpm typecheck`    | TypeScript type check         |
| `pnpm lint`         | ESLint check                  |
| `pnpm format`       | Prettier format               |
| `pnpm db:generate`  | Generate Drizzle migration    |
| `pnpm db:migrate`   | Apply Drizzle migration       |
| `pnpm db:push`      | Push schema to DB (dev)       |
| `pnpm db:studio`    | Drizzle Studio                |

## Deployment (Railway)

- Web service: `pnpm build && pnpm start` (Nitro server)
- Worker service: `pnpm build:worker && pnpm start:worker` (plain Node)
- Redis: Railway Redis plugin
- PostgreSQL: Neon (connection via `DATABASE_URL`)
- CI: GitHub Actions (`.github/workflows/ci.yml`)

### Gotchas

- The worker doesn't use Nitro — it's built with tsup and runs as plain Node
- `vite-plugin-neon-new` was removed; use `DATABASE_URL` directly
- Better Auth uses DB-backed sessions (not stateless) — the `Pool` connection is in `src/shared/auth/auth.ts`
- The `betterAuth` singleton is lazy-created on first request via `getAuth()`
- Health check at `/api/health` returns `{ db: boolean, redis: boolean }` — Redis is optional in dev
- Route tree is auto-generated at `src/routeTree.gen.ts` — don't edit manually
- Two tsconfig files: `tsconfig.json` (app) and `tsconfig.node.json` (config files)
