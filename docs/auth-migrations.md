# Auth-Table Schema Migrations — STRICT (no manual SQL)

**Status:** Accepted
**Scope:** Auth tables managed by better-auth

Auth tables and their custom columns are managed by the **better-auth CLI**, never by hand-written SQL. Manual `ALTER TABLE` / `CREATE TABLE` against auth tables is a **STRICT NO** — it desyncs better-auth's migration journal and silently drifts the live DB. (This exact drift once left `invitation.propertyIds` and 7 `organization` billing/SLA columns missing → every invite 500'd.)

**Auth-managed tables (better-auth CLI):** `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, and ALL `additionalFields` on them.

**Business tables (Drizzle):** all 139 app-owned tables — `drizzle.config.ts` points at `src/shared/db/schema/migratable.ts` (no `tablesFilter` whitelist since BQC-5.4). Migrate-based: `pnpm db:generate` then **commit `drizzle/`** (it is version-controlled); `pnpm db:migrate` is the deploy path. Do NOT use `db:push` on business tables — it desyncs the journal (root cause of the prior schema drift). The barrel deliberately excludes auth tables — neither `db:push` nor `db:migrate` will touch them. **Schema authority + current deploy order: `src/shared/db/CONTEXT.md` (BQC-5.4).**

## Fresh-DB provisioning (the one manual-SQL exception)

> **2026-07-28 (BQC-5.4): largely superseded.** The current better-auth CLI
> creates the 8 baseline tables on an empty database (verified — CI relies on
> it), so step 1 is no longer required; the `mv_*` materialized views in step
> 4 were folded into migration 0004 and dropped by migration 0008, so
> `pnpm db:matviews` is historical. The live deploy order is
> `auth:migrate → db:migrate → registered sidecars` (step 5 below) — see
> `src/shared/db/CONTEXT.md`. Kept below for the historical record.

Better Auth's CLI never captured a **baseline** migration — `better-auth_migrations/` contains only 2 incremental files that assume the 8 baseline tables already exist. So `pnpm auth:migrate` on an **empty** database silently reports "no migrations needed" and creates nothing. A committed bootstrap SQL is the reproducible fix:

| Step | Command                                                                                 | Creates                                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `pnpm db:bootstrap-auth`                                                                | The 8 BA auth tables + baseline indexes (`scripts/migrations/0000-auth-tables-bootstrap.sql`, idempotent `CREATE TABLE IF NOT EXISTS`)                                                                                                                                |
| 2    | `pnpm auth:migrate`                                                                     | Applies the 2 incremental BA files (idempotent no-ops post-bootstrap; safe for future increments too)                                                                                                                                                                 |
| 3    | `pnpm db:migrate`                                                                       | Drizzle business tables (`drizzle/`)                                                                                                                                                                                                                                  |
| 4    | `pnpm db:matviews`                                                                      | 3 materialized views (`mv_daily_metrics`, `mv_weekly_metrics`, `mv_daily_inbox_metrics`) + unique indexes + the GBP place-id partial unique index. Raw SQL by necessity (complex aggregations Drizzle can't express; adding to tablesFilter risks destructive drift). |
| 5    | `psql "$DATABASE_URL" -f scripts/migrations/2026-07-06-permission-version-triggers.sql` | DAC: `permission_version` + `organization_role_policy` tables, bump triggers/functions, last-owner backstop, the `organization_role_org_role_lower_unique` index                                                                                                      |

The bootstrap SQL is the **only** hand-written SQL for auth tables, and only because the CLI can't synthesize the baseline. It is idempotent (`IF NOT EXISTS`) so it no-ops on a DB that already has the tables (verified against Neon). Captured from the live Neon schema 2026-07-06; re-capture via `pg_dump --schema-only` if the auth schema changes. Detail: `docs/ba-fresh-db-provisioning.md`.

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
