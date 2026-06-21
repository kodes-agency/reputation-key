# Auth-Table Schema Migrations — STRICT (no manual SQL)

**Status:** Accepted
**Scope:** Auth tables managed by better-auth

Auth tables and their custom columns are managed by the **better-auth CLI**, never by hand-written SQL. Manual `ALTER TABLE` / `CREATE TABLE` against auth tables is a **STRICT NO** — it desyncs better-auth's migration journal and silently drifts the live DB. (This exact drift once left `invitation.propertyIds` and 7 `organization` billing/SLA columns missing → every invite 500'd.)

**Auth-managed tables (better-auth CLI):** `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, and ALL `additionalFields` on them.

**Business tables (Drizzle):** only the tables in `drizzle.config.ts` `tablesFilter` (`properties`, `reviews`, `portals`, …). Use `pnpm db:generate` / `db:migrate`. Drizzle's filter deliberately excludes auth tables — `db:push` will not and must not touch them.

**Single source of truth for auth additionalFields:** `src/shared/auth/org-schema.ts` — imported by BOTH `src/shared/auth/auth.ts` (runtime) and `src/shared/auth/auth-cli.ts` (migration CLI). Edit it ONCE; both configs see the change. Never re-declare additionalFields inline in either file.

## Workflow — adding/changing an auth additionalField (e.g. a new column on `organization` / `invitation`)

1. Edit `src/shared/auth/org-schema.ts` (the only place).
2. `pnpm auth:generate` → review the generated SQL under `better-auth_migrations/`.
3. `pnpm auth:migrate` to apply.

## Do NOT

- Add `scripts/migrations/*.sql` for auth tables — that folder is legacy business-table patches only.
- Re-declare `additionalFields` inline in `auth.ts` or `auth-cli.ts` — use `org-schema.ts`.
- Hand-patch an auth column with raw SQL when the tooling "didn't add it."

If `auth:generate` reports "schema already up to date" but you expect a missing column, the CLI config (`auth-cli.ts`) has drifted from `auth.ts` — fix the shared `org-schema.ts`, then re-generate. Never bypass with manual SQL.
