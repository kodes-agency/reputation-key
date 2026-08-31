# Auth-Table Schema Migrations — Runtime Authority

**Status:** Accepted
**Scope:** Auth tables managed by better-auth

Auth tables and their custom columns are managed in normal development and
deployment by the **schema API in the exact repository-pinned `better-auth`
runtime**, not by hand-written SQL. The
`scripts/better-auth-schema.ts` runner exposes this as `pnpm auth:generate` and
`pnpm auth:migrate`. Manual `ALTER TABLE` / `CREATE TABLE` against auth tables is
a **STRICT NO** — it silently drifts the live DB. (This exact drift once left
`invitation.propertyIds` and 7 `organization` billing/SLA columns missing → every
invite 500'd.)

**Auth-managed tables (Better Auth schema API):** `user`, `session`, `account`,
`verification`, `organization`, `member`, `invitation`, and ALL
`additionalFields` on them.

**Business tables (Drizzle):** the migratable barrel currently exports all 195 app-owned tables. `drizzle.config.ts` points at `src/shared/db/schema/migratable.ts` and derives its `tablesFilter` from that same barrel, so there is no second hand-maintained allowlist. Migrate-based: `pnpm db:generate` then **commit `drizzle/`** (it is version-controlled); `pnpm db:migrate` is the deploy path. Do NOT use `db:push` on business tables — it desyncs the journal (root cause of the prior schema drift). The barrel deliberately excludes auth tables — neither `db:push` nor `db:migrate` will touch them. **Schema authority + current deploy order: `src/shared/db/CONTEXT.md` (BQC-5.4).**

## Fresh-database provisioning

The pinned Better Auth schema API creates all eight auth tables on an empty
database. This is exercised by CI and by `pnpm db:migrate-deploy`; no manual
auth bootstrap belongs in the normal deployment path.

Use one of these equivalent authorities:

- production/pre-deploy: `pnpm db:migrate-deploy` (Better Auth → staged
  Drizzle journal → registered sidecars → provider-subject initialization);
- explicit local/CI sequence: `pnpm auth:migrate` → `pnpm db:migrate` →
  `pnpm db:google-property-binding-index` → the registered DAC SQL sidecar.

`pnpm db:bootstrap-auth` is the one explicit exception: a compatibility-only
empty-database fallback for constrained recovery environments that cannot
execute the application runner. Its SQL must remain semantically identical to
the pinned runtime. The `auth-bootstrap-compatibility.integration.test.ts`
gate compares its columns, constraints, and indexes against runtime-created
tables. The fallback must be followed by `pnpm auth:migrate` plus
`pnpm check:schema-drift`. Never
run it as a substitute for a missing incremental auth migration, and never use
it to patch an existing auth table.

**Single source of truth for auth additionalFields:** `src/shared/auth/org-schema.ts` — imported by BOTH `src/shared/auth/auth.ts` (runtime) and `src/shared/auth/auth-cli.ts` (migration CLI). Edit it ONCE; both configs see the change. Never re-declare additionalFields inline in either file.

## Workflow — adding/changing an auth additionalField (e.g. a new column on `organization` / `invitation`)

1. Edit `src/shared/auth/org-schema.ts` (the only place).
2. `pnpm auth:generate` → review the generated SQL under `better-auth_migrations/`.
3. `pnpm auth:migrate` to apply.

## Do NOT

- Add or change `scripts/migrations/*.sql` for auth tables. The named recovery
  bootstrap is frozen compatibility infrastructure, not a second migration
  track.
- Re-declare `additionalFields` inline in `auth.ts` or `auth-cli.ts` — use `org-schema.ts`.
- Hand-patch an auth column with raw SQL when the tooling "didn't add it."

If `auth:generate` reports "schema is up to date" but you expect a missing
column, the schema config (`auth-cli.ts`) has drifted from `auth.ts` — fix the
shared `org-schema.ts`, then re-generate. Never bypass with manual SQL. The
standalone `@better-auth/cli` is deliberately not installed or fetched: its
release line may lag the runtime and therefore describe a different schema.
