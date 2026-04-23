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
│   ├── auth/              # Better Auth server + client config, middleware, emails
│   ├── cache/             # Redis client factory
│   ├── config/            # Zod-validated env schema
│   ├── db/                # Drizzle ORM (pg driver)
│   │   └── schema/        # Table definitions + barrel
│   ├── domain/            # Brand types, Result, IDs, roles, clock
│   ├── events/            # Event bus (Phase 4)
│   ├── fn/                # Shared functional utilities
│   ├── jobs/              # BullMQ queue/worker (Phase 4)
│   ├── observability/     # Logger (pino)
│   ├── rate-limit/        # Rate limiting (Phase 4)
│   └── testing/           # Test fixtures, capturing event bus, in-memory fakes
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

| Integration        | Purpose                                    | Key Files                                                                                                                                                |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TanStack Start** | Full-stack React framework                 | `src/router.tsx`, `vite.config.ts`                                                                                                                       |
| **TanStack Query** | Server state management                    | `src/integrations/tanstack-query/`                                                                                                                       |
| **Better Auth**    | Email+password auth with DB sessions       | `src/shared/auth/auth.ts`, `src/shared/auth/auth-client.ts`, `src/shared/auth/auth-cli.ts`, `src/shared/auth/middleware.ts`, `src/shared/auth/emails.ts` |
| **Drizzle ORM**    | Type-safe ORM for PostgreSQL (pg driver)   | `src/shared/db/`, `drizzle.config.ts`                                                                                                                    |
| **Zod v4**         | Runtime validation & env schema            | `src/shared/config/env.ts`                                                                                                                               |
| **Pino**           | Structured logging                         | `src/shared/observability/logger.ts`                                                                                                                     |
| **ioredis**        | Redis client (queue, cache, rate limiting) | `src/shared/cache/redis.ts`                                                                                                                              |
| **BullMQ**         | Job queues (Phase 4+)                      | `src/shared/jobs/` (empty placeholder)                                                                                                                   |
| **Shadcn**         | UI component library                       | `components.json`, `src/lib/utils.ts`                                                                                                                    |
| **Tailwind v4**    | Utility-first CSS                          | `src/styles.css`                                                                                                                                         |

## Environment Variables

| Variable              | Purpose                                     | Required |
| --------------------- | ------------------------------------------- | -------- |
| `DATABASE_URL`        | Neon PostgreSQL connection string           | Yes      |
| `DATABASE_URL_POOLER` | Neon pooler connection (optional)           | No       |
| `BETTER_AUTH_SECRET`  | Auth signing key (≥32 chars)                | Yes      |
| `BETTER_AUTH_URL`     | Base URL for auth (`http://localhost:3000`) | Yes      |
| `RESEND_API_KEY`      | Resend API key for transactional emails     | Yes      |
| `REDIS_URL`           | Redis connection (optional in dev)          | No       |
| `LOG_LEVEL`           | Pino log level (default: `info`)            | No       |

All env vars are validated via Zod in `src/shared/config/env.ts`. Missing required vars throw on startup.

## Scripts

| Command              | Purpose                             |
| -------------------- | ----------------------------------- |
| `pnpm dev`           | Start dev server on port 3000       |
| `pnpm build`         | Build web app (Nitro output)        |
| `pnpm build:worker`  | Build worker with tsup              |
| `pnpm start`         | Run built web server                |
| `pnpm start:worker`  | Run built worker                    |
| `pnpm test`          | Run tests (Vitest)                  |
| `pnpm test:watch`    | Run tests in watch mode             |
| `pnpm typecheck`     | TypeScript type check               |
| `pnpm lint`          | ESLint check                        |
| `pnpm format`        | Prettier format                     |
| `pnpm db:generate`   | Generate Drizzle migration          |
| `pnpm db:migrate`    | Apply Drizzle migration             |
| `pnpm db:push`       | Push schema to DB (dev)             |
| `pnpm db:studio`     | Drizzle Studio                      |
| `pnpm auth:generate` | Generate Better Auth SQL migration  |
| `pnpm auth:migrate`  | Apply Better Auth migrations        |
| `pnpm preview`       | Preview production build (Vite)     |
| `pnpm lint:fix`      | ESLint check with auto-fix          |
| `pnpm format:check`  | Prettier check without writing      |
| `pnpm db:pull`       | Pull schema from DB (introspection) |

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
- **Better Auth tables use camelCase columns** (`emailVerified`, `createdAt`, `userId`, etc.) — not snake_case. The Drizzle schema in `shared/db/schema/auth.ts` must match. Use `pnpm auth:migrate` for auth schema changes.
- **Better Auth CLI** requires its own config file (`auth-cli.ts`) with a default export and no Vite path aliases (`#/...`). Don't point it at `auth.ts`.
- Health check at `/api/health` returns `{ status: 'ok'|'degraded', db: boolean, redis: boolean, timestamp: string }` — Redis is optional in dev
- Route tree is auto-generated at `src/routeTree.gen.ts` — don't edit manually
- Two tsconfig files: `tsconfig.json` (app) and `tsconfig.node.json` (config files)
- **CRITICAL: IDE/LS diagnostics for "Cannot find module" are FALSE POSITIVES.** This project uses `moduleResolution: "bundler"` in tsconfig.json, which the IDE's TypeScript language server may not fully support. ALWAYS verify type errors with `npx tsc --noEmit` — if it exits with code 0, the errors are not real. Known false-positive modules: `@tanstack/react-router`, `better-auth`, `better-auth/plugins`, `better-auth/tanstack-start`, `drizzle-orm/pg-core`, `resend`. Do NOT waste time trying to "fix" these import errors — they work correctly at build time via the bundler. Before reporting or fixing any TypeScript error, run `npx tsc --noEmit` to confirm it's a real issue.

<!-- intent-skills:start -->

# Skill mappings - when working in these areas, load the linked skill file into context.

skills:

- task: "Working with routes, route trees, createRouter/createRoute, or file-based routing conventions"
  load: "node_modules/@tanstack/router-core/skills/router-core/SKILL.md"
- task: "Route protection, authentication guards, beforeLoad redirects, or RBAC in routes"
  load: "node_modules/@tanstack/router-core/skills/router-core/auth-and-guards/SKILL.md"
- task: "Data loading with loaders, beforeLoad, caching (staleTime/gcTime), pending/error components, or router.invalidate"
  load: "node_modules/@tanstack/router-core/skills/router-core/data-loading/SKILL.md"
- task: "Navigation, Link component, useNavigate, preloading, or scroll restoration"
  load: "node_modules/@tanstack/router-core/skills/router-core/navigation/SKILL.md"
- task: "Search params, validateSearch, Zod/Valibot search validation, or search middleware"
  load: "node_modules/@tanstack/router-core/skills/router-core/search-params/SKILL.md"
- task: "Server functions (createServerFn), server routes/API endpoints, or server context utilities"
  # To load this skill, run: npx @tanstack/intent@latest list | grep server-functions
  load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/server-functions/SKILL.md"
- task: "TanStack Start middleware, request middleware, or server function middleware"
  # To load this skill, run: npx @tanstack/intent@latest list | grep middleware
  load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/middleware/SKILL.md"
- task: "SSR setup, streaming SSR, head content management, or loader dehydration/hydration"
  load: "node_modules/@tanstack/router-core/skills/router-core/ssr/SKILL.md"
- task: "Deploying to Railway, Cloudflare Workers, Vercel, or configuring SSR/SPA/prerender modes"
  # To load this skill, run: npx @tanstack/intent@latest list | grep deployment
  load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/deployment/SKILL.md"
- task: "Code splitting, lazy routes, createLazyFileRoute, or autoCodeSplitting configuration"
  load: "node_modules/@tanstack/router-core/skills/router-core/code-splitting/SKILL.md"
- task: "Configuring the TanStack Router Vite plugin, route generation, or code split groupings"
  load: "node_modules/@tanstack/router-plugin/skills/router-plugin/SKILL.md"
- task: "Not found pages, error boundaries, route masking, or CatchBoundary"
  load: "node_modules/@tanstack/router-core/skills/router-core/not-found-and-errors/SKILL.md"
- task: "Path params, dynamic segments, splat routes, or useParams"
  load: "node_modules/@tanstack/router-core/skills/router-core/path-params/SKILL.md"
- task: "Environment variables, .env files, or dotenv configuration"
  load: "node_modules/dotenv/skills/dotenv/SKILL.md"
- task: "TanStack Start React setup, StartClient/StartServer, or React-specific imports"
load: "node_modules/@tanstack/react-start/skills/react-start/SKILL.md"
<!-- intent-skills:end -->
