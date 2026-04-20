# Reputation Key — Project Context

## Project Overview

**Name:** reputation-key
**Framework:** TanStack Start (React) — API-First template with file-based routing
**Package Manager:** pnpm
**Runtime:** Node.js 22 (Nitro server)

## Scaffold Command

```bash
npx @tanstack/cli@latest create reputation-key --agent --tailwind --add-ons tanstack-query,neon,better-auth,drizzle,shadcn,railway
```

> Note: `--tailwind` is deprecated (Tailwind is always enabled). The scaffold initially used npm; we switched to pnpm post-install.

## Chosen Stack & Integrations

| Integration | Purpose | Key Files |
|---|---|---|
| **TanStack Query** | Server state management, SSR query integration | `src/integrations/tanstack-query/`, `src/router.tsx` |
| **Neon** | Serverless PostgreSQL via `@neondatabase/serverless` | `src/db.ts`, `neon-vite-plugin.ts`, `db/init.sql` |
| **Better Auth** | Email+password auth with `tanstackStartCookies` plugin | `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/routes/api/auth/$.ts` |
| **Drizzle** | Type-safe ORM for PostgreSQL | `src/db/index.ts`, `src/db/schema.ts`, `drizzle.config.ts` |
| **Shadcn** | UI component library (new-york style, zinc base) | `components.json`, `src/lib/utils.ts` (cn helper) |
| **Railway** | Deployment target (Nitro → Node.js) | `nixpacks.toml`, `vite.config.ts` (nitro plugin) |
| **Tailwind v4** | Utility-first CSS | `src/styles.css`, `@tailwindcss/vite` plugin |

## Environment Variables

| Variable | Purpose | Source |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string | Neon Launchpad or `vite-plugin-neon-new` dev ephemeral DB |
| `DATABASE_URL_POOLER` | Neon pooler connection string (optional) | Neon console |
| `BETTER_AUTH_URL` | Base URL for auth (e.g. `http://localhost:3000`) | Set in `.env.local` |
| `BETTER_AUTH_SECRET` | Signing key for auth sessions | Generate: `npx -y @better-auth/cli secret` |

**Files:** `.env.example` has the template, `.env.local` has local values (gitignored).

## Architecture

### Routing

- File-based routing in `src/routes/`
- Root route: `src/routes/__root.tsx` (shell component with `<html>`, `<head>`, `<body>`)
- Auto-generated route tree: `src/routeTree.gen.ts`
- Router created in `src/router.tsx` with SSR query integration
- Default preload: `intent`, staleTime: `0`

### Server Functions

- Use `createServerFn` from `@tanstack/react-start` for server-side logic
- Input validation via `.inputValidator()` on server functions
- API routes via `server` property on `createFileRoute` (see `src/routes/api/auth/$.ts`)

### Database Layer (Dual Access)

1. **Drizzle ORM** (`src/db/index.ts`): `drizzle-orm/node-postgres` — type-safe queries via schema in `src/db/schema.ts`
2. **Neon Serverless** (`src/db.ts`): `@neondatabase/serverless` — raw SQL via HTTP, used in Neon demo

Current schema: `todos` table (id, title, createdAt). Extend in `src/db/schema.ts`.

### Auth

- Server: `betterAuth()` in `src/lib/auth.ts` with `tanstackStartCookies` plugin
- Client: `createAuthClient()` in `src/lib/auth-client.ts`
- Handler route: `src/routes/api/auth/$.ts` (GET + POST)
- Header integration: `src/integrations/better-auth/header-user.tsx`
- To persist users in DB, add `database: new Pool({ connectionString: process.env.DATABASE_URL })` to auth config, then run `npx -y @better-auth/cli migrate`

### Styling

- Tailwind v4 with `@tailwindcss/vite` plugin and `@tailwindcss/typography`
- CSS variables for theming (light/dark) in `src/styles.css`
- Shadcn tokens mapped as CSS custom properties (`--background`, `--foreground`, etc.)
- Custom theme tokens (`--sea-ink`, `--lagoon`, `--palm`, etc.)
- Fonts: Manrope (sans), Fraunces (display/serif)
- `cn()` utility in `src/lib/utils.ts` (clsx + tailwind-merge)

### Dev Experience

- TanStack Devtools panel (bottom-right) with Router + Query plugins
- Theme toggle (light/dark/auto) in header
- Demo pages in `src/routes/demo/` — can be deleted when no longer needed

## Deployment (Railway)

- Uses Nitro nightly for Node.js server output
- Build: `pnpm run build` → outputs to `.output/server/index.mjs`
- Start: `node .output/server/index.mjs` (configured as `pnpm run start`)
- `nixpacks.toml` configured for Node.js 22 with pnpm
- Set all env vars in Railway dashboard

### Gotchas

- `vite-plugin-neon-new` has a peer dependency mismatch (expects Vite ^6||^7, project uses Vite 8) — works but watch for breakage
- Neon ephemeral DBs from dev plugin expire in 72 hours; claim or provision a persistent DB
- Better Auth runs in stateless mode by default; add database pool to persist user data
- The `.cta.json` `packageManager` field was updated from `npm` to `pnpm` post-scaffold
- Drizzle migration workflow: `pnpm db:generate` → `pnpm db:migrate` (or `pnpm db:push` for dev)

## Next Steps

1. **Generate Better Auth secret:** `npx -y @better-auth/cli secret` → add to `.env.local`
2. **Provision persistent Neon database** (or claim the ephemeral one from first `pnpm dev`)
3. **Wire Better Auth to Drizzle DB** — add `database: new Pool(...)` to `src/lib/auth.ts`, run `npx -y @better-auth/cli migrate`
4. **Update schema** — edit `src/db/schema.ts` for your domain, then `pnpm db:generate && pnpm db:migrate`
5. **Add Shadcn components** — `pnpm dlx shadcn@latest add button card dialog ...`
6. **Remove demo pages** — delete `src/routes/demo/` when ready
7. **Customize branding** — update Header, Footer, `src/styles.css` theme tokens, page titles
8. **Deploy to Railway** — push to GitHub, connect repo in Railway, set env vars

<!-- intent-skills:start -->
# Skill mappings - when working in these areas, load the linked skill file into context.
skills:
  - task: "TanStack Start React framework setup, createStart, StartClient/StartServer, React-specific imports"
    load: "node_modules/@tanstack/react-start/skills/react-start/SKILL.md"
  - task: "Server Components in TanStack Start, renderServerComponent, Composite Components, React Flight"
    load: "node_modules/@tanstack/react-start/skills/react-start/server-components/SKILL.md"
  - task: "Server functions, createServerFn, inputValidator, useServerFn, server context utilities"
    load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/server-functions/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep server-functions
  - task: "Middleware, createMiddleware, request and function middleware, context passing"
    load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/middleware/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep middleware
  - task: "Deployment to Railway, Nitro, SSR options, prerendering, SEO"
    load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/deployment/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep deployment
  - task: "Execution model, isomorphic functions, createServerOnlyFn, createClientOnlyFn, environment variables"
    load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/execution-model/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep execution-model
  - task: "API routes, server property on createFileRoute, HTTP handlers, createHandlers"
    load: "node_modules/.pnpm/@tanstack+start-client-core@1.167.17/node_modules/@tanstack/start-client-core/skills/start-core/server-routes/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep server-routes
  - task: "Router core concepts, route trees, createRouter, file naming conventions, type safety"
    load: "node_modules/.pnpm/@tanstack+router-core@1.168.15/node_modules/@tanstack/router-core/skills/router-core/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep router-core
  - task: "Route protection, beforeLoad, redirect, auth guards, layout routes for authentication"
    load: "node_modules/.pnpm/@tanstack+router-core@1.168.15/node_modules/@tanstack/router-core/skills/router-core/auth-and-guards/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep auth-and-guards
  - task: "Data loading, route loaders, staleTime, pendingComponent, errorComponent, router.invalidate"
    load: "node_modules/.pnpm/@tanstack+router-core@1.168.15/node_modules/@tanstack/router-core/skills/router-core/data-loading/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep data-loading
  - task: "Code splitting, autoCodeSplitting, lazy routes, createLazyFileRoute, codeSplitGroupings"
    load: "node_modules/.pnpm/@tanstack+router-core@1.168.15/node_modules/@tanstack/router-core/skills/router-core/code-splitting/SKILL.md"
    # To reload path after install updates, run: npx @tanstack/intent@latest list | grep code-splitting
  - task: "TanStack Router plugin for Vite, route generation, autoCodeSplitting config"
    load: "node_modules/@tanstack/router-plugin/skills/router-plugin/SKILL.md"
  - task: "Devtools Vite plugin configuration, must be FIRST plugin"
    load: "node_modules/@tanstack/devtools-vite/skills/devtools-vite-plugin/SKILL.md"
  - task: "Environment variables, .env files, dotenv, dotenvx"
    load: "node_modules/dotenv/skills/dotenv/SKILL.md"
<!-- intent-skills:end -->
