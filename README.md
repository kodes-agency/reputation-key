# Reputation Key

A reputation management platform built with TanStack Start, Better Auth, Drizzle ORM, and PostgreSQL.

**Authority:** [`docs/BETA.md`](docs/BETA.md) is the one page that governs the closed beta — what it is, what we owe Google and users, what the product does, and which rules are enforced by which test. It outranks every other document here.

## Quick Start

```bash
# 0. Use the pinned Node runtime — 22.23.2, exactly (.nvmrc)
fnm use            # or: nvm use
pnpm local:doctor  # Docker, published stack ports, stale containers, VM headroom

# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and BETTER_AUTH_SECRET

# 3. Set up the database through the production-equivalent authority
# (pinned Better Auth schema, three-entry Drizzle journal, and provider-subject
# initialization). DEPLOY_MIGRATE=1 is the explicit local/CI authority;
# Railway deployments use platform identity instead.
# On an empty database, also set one sealed
# REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS entry in .env.local.
DEPLOY_MIGRATE=1 pnpm db:migrate-deploy

# 4. Generate auth secret (if not set)
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('base64url'))"

# 5. Start dev server
pnpm dev
```

## Database Migrations

Two migration systems run in a fixed order, both behind one command:

```bash
DEPLOY_MIGRATE=1 pnpm db:migrate-deploy
```

It provisions the pinned Better Auth tables, applies the Drizzle journal, and performs provider-subject initialization. Railway invokes the same runner under platform identity instead of setting `DEPLOY_MIGRATE`. Use this same journaled workflow in development, CI and production. **Never** run `pnpm db:push` against this schema — it bypasses the authoritative journal and conceals deploy-time drift.

- **Auth schema change:** edit `src/shared/auth/org-schema.ts` (the single source for `additionalFields`), then `pnpm auth:migrate`.
- **Business schema change:** edit `src/shared/db/schema/`, run `pnpm db:baseline`, review and commit `drizzle/`, then run `pnpm db:migrate`.

CI runs `pnpm db:migrate-deploy` (`.github/workflows/ci.yml`, Predeploy migration parity). Schema authority and current deploy order: `src/shared/db/CONTEXT.md`.

## Architecture

- **Web app**: TanStack Start (React + SSR) — `pnpm dev` / `pnpm build` / `pnpm start`
- **Worker**: Plain Node.js script — built by `pnpm build`, run with `pnpm start:worker`
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Better Auth with DB-backed sessions
- **Redis**: Optional in basic development; physically separate Cache Redis and Queue Redis are required in production

## Scripts

| Command             | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm dev`          | Start dev server on :3000                                         |
| `pnpm local:up`     | Inner loop: services in Compose, web (HMR) + worker on the host   |
| `pnpm local:down`   | Remove the local services and their volumes                       |
| `pnpm build`        | Build the web, worker, and migration bundles                      |
| `pnpm start`        | Run built web server                                              |
| `pnpm start:worker` | Run built worker                                                  |
| `pnpm test:unit`    | Run unit tests                                                    |
| `pnpm test:e2e`     | Run Playwright E2E tests                                          |
| `pnpm typecheck`    | TypeScript check (src/services/e2e + the release scripts project) |
| `pnpm lint`         | ESLint + filename/component-boundary checks                       |
| `pnpm lint:ci`      | `lint` + test-quality + Google/AI artifact gates                  |
| `pnpm format`       | Prettier format                                                   |

### Local stacks

Both stacks share the committed `e2e/stack.env` and the same Compose services:
Postgres, Redis, the TLS Google Business Profile sandbox, the AI provider stub
and the mail stub. `scripts/e2e/stack-services.sh` issues a run-scoped local CA
with `openssl` into the ignored `e2e/.certs/` (the sandbox is TLS-only,
ADR 0050), starts the services, runs the deploy migration and the e2e seed.
Nothing here talks to real Google, OpenAI or Resend.

**Inner loop - `pnpm local:up`.** The web dev server (HMR) and the worker run
on the host against those services; every feature runs, including Google
import/sync through the sandbox, the AI pipeline (the stub synthesizes answers
for unscripted requests) and email. `http://127.0.0.1:3000`; sign in as
`test@example.com` (password `E2E_TEST_PASSWORD` in `e2e/stack.env`) or
`staff@example.com` / `password123`. Ctrl-C stops both processes;
`pnpm local:down` removes the services and their volumes. The host processes
resolve the Compose service names to loopback through
`scripts/local/loopback-hosts.mjs` because `local-provider-fetch.ts`
deliberately compiles the AI stub address in.

The seed binds no property to Google, and the sandbox has no default scope.
To get a Google-bound property with synced reviews for the AI features, run
the import workflow against the running stack:

```bash
E2E_EXTERNAL_STACK= NODE_EXTRA_CA_CERTS=e2e/.certs/ca.crt pnpm test:e2e --project=critical e2e/critical/workflows/google-import-sync.spec.ts
```

Then, in the app: Settings → AI & replies → that property (reply language,
enable AI), and a portal's Settings tab for the public display name a reply
draft must use.

**Pre-merge - `pnpm e2e:stack:up`.** The containerised production build
(`NODE_ENV=test`, `E2E=1`) on the same services - what CI's e2e job runs.
Use it to click through a build or to run the suite; the suite is not meant
for the dev server (production server-function ids, the auth rate limit):

```bash
pnpm e2e:stack:up
pnpm test:e2e --project=critical
pnpm e2e:stack:down
```

Use a fresh volume and image lifecycle on every pass when reproducing a flake:

```bash
for i in 1 2 3; do pnpm e2e:stack:down && pnpm e2e:stack:up && pnpm test:e2e --project=critical; done
```

**Deploy - `pnpm ops deploy-ci-images --sha <main sha> --apply`** once `main`
is green; CI has already run the same stack, so deploying is not a test step.

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
