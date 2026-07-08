# Ticket: Better Auth cannot bootstrap a fresh database

**Status:** ✅ Resolved (2026-07-06)
**Severity:** ~~Blocks clean-slate provisioning~~ Fixed
**Discovered:** 2026-07-06, during DAC Stage 2 DB verification

## Resolution

A committed idempotent bootstrap SQL now provisions the 8 baseline auth tables from scratch. The 2 incremental BA migration files were made idempotent (`IF NOT EXISTS`) so `pnpm auth:migrate` is safe to run after the bootstrap.

**Provisioning runbook (fresh DB):** see `docs/auth-migrations.md` → "Fresh-DB provisioning".

- Step 1: `pnpm db:bootstrap-auth` → `scripts/migrations/0000-auth-tables-bootstrap.sql`
- Step 2: `pnpm auth:migrate` (idempotent no-ops post-bootstrap)
- Step 3: `pnpm db:migrate` (Drizzle business tables)
- Step 4: DAC triggers SQL (`scripts/migrations/2026-07-06-permission-version-triggers.sql`)

Verified: `pnpm db:bootstrap-auth` against Neon is a clean idempotent no-op (all 8 tables + 7 indexes report "already exists, skipping"); the SQL is standard `CREATE TABLE IF NOT EXISTS` so it creates from scratch on an empty DB.

## Problem (historical)

`pnpm auth:migrate` reports **"No migrations needed"** against an empty database
and creates **no auth tables**. Better Auth's baseline schema (`user`, `session`,
`account`, `verification`, `organization`, `member`, `invitation`,
`organizationRole`) is never provisioned on a fresh DB — the CLI silently does
nothing.

## Impact

- A brand-new environment (new developer, CI, fresh staging/prod) **cannot
  bootstrap auth tables**; the app 500s on any auth request.
- Currently masked because the Neon dev DB already has the baseline (provisioned
  by an earlier/unknown process). Any genuinely new DB is broken until seeded.
- Confirmed empirically: the Railway throwaway DB provided for DAC Stage 2 stayed
  empty after `auth:migrate`.

## Root cause

`better-auth_migrations/` contains only TWO **incremental** migration files:

- `2026-06-19T12-14-20.286Z.sql` — `ALTER TABLE "organization" ADD COLUMN …`
  (billing/SLA additionalFields)
- `2026-06-21T18-37-49.995Z.sql` — `CREATE TABLE "organizationRole"` + indexes

Both **assume the baseline tables already exist**. The baseline `CREATE TABLE` for
`user` / `session` / `account` / `verification` / `organization` / `member` /
`invitation` was never captured as migration SQL. `@better-auth/cli migrate`
compares the desired schema (from the config) to its migration journal; with no
baseline migration on record it concludes the DB is "up to date" and applies
nothing.

## Evidence

- `pnpm auth:migrate` on an empty Railway Postgres → `🚀 No migrations needed.`,
  0 tables created.
- `pnpm auth:generate` → `Your schema is already up to date.` (no baseline emitted).
- `\dt` on Neon: baseline present (works). `\dt` on a fresh DB: empty.

## Proposed fix (pick one)

1. **Capture the baseline.** Generate the full baseline `CREATE TABLE` statements
   for all auth tables from the current config (one-time) and add them as a
   `better-auth_migrations/0000_baseline.sql` (or equivalent) so `auth:migrate`
   provisions from scratch. Verify by migrating into a truly empty DB.
2. **Bootstrap SQL.** If the baseline genuinely cannot be regenerated via the CLI,
   capture the working auth schema from Neon (`pg_dump --schema-only` of the 8
   auth tables) into a committed `scripts/migrations/auth-tables-bootstrap.sql`
   applied before the first `auth:migrate`.

Either way, a fresh `pnpm auth:migrate` against an empty DB must produce all auth
tables with correct casing.

## Acceptance criteria

- [ ] An empty Postgres + `pnpm auth:migrate` creates all 8 auth tables
      (`user`, `session`, `account`, `verification`, `organization`, `member`,
      `invitation`, `organizationRole`) with the correct camelCase columns.
- [ ] `\d member`, `\d "organizationRole"`, `\d invitation` match the casing the
      DAC triggers + app-owned role/invitation services depend on.
- [ ] The bootstrap is reproducible from a clean clone (no "restore from Neon").

## Related

- DAC Stage 2 (ADR 0001) — triggers/functions reference `member` /
  `"organizationRole"` / `invitation`; app-owned accept flow writes `invitation`.
- `docs/auth-migrations.md` currently assumes `auth:migrate` works end-to-end;
  update it once this is fixed.
