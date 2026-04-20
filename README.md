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
| `pnpm test`         | Run tests                 |
| `pnpm typecheck`    | TypeScript check          |
| `pnpm lint`         | ESLint                    |
| `pnpm format`       | Prettier format           |

## Project Structure

```
src/
├── contexts/       # Business domains (property, review, portal, etc.)
├── shared/         # Shared infrastructure
│   ├── auth/      # Better Auth config
│   ├── cache/     # Redis client
│   ├── config/    # Zod-validated env
│   ├── db/        # Drizzle ORM + schema
│   ├── domain/    # Brand types, Result
│   ├── health/    # Health check endpoint
│   └── observability/ # Pino logger
├── routes/        # TanStack Start routes
└── worker/        # Background worker entry point
```
