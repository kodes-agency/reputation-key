# Auth-Table Schema Migrations — Runtime Authority

**Status:** Accepted
**Scope:** Auth tables managed by better-auth

Auth tables and their custom columns are managed in normal development and
deployment by the **schema API in the exact repository-pinned `better-auth`
runtime**, not by hand-written SQL. The
`scripts/better-auth-schema.ts` runner applies pending auth-table changes as
`pnpm auth:migrate`. Manual `ALTER TABLE` / `CREATE TABLE` against auth tables is
a **STRICT NO** — it silently drifts the live DB. (This exact drift once left
`invitation.propertyIds` and Organization custom columns missing, so every
invite returned a 500.)

**Auth-managed tables (Better Auth schema API):** `user`, `session`, `account`,
`verification`, `organization`, `member`, `invitation`, and ALL
`additionalFields` on them.

**Business tables (Drizzle):** the migratable barrel currently exports all 195 app-owned tables. `drizzle.config.ts` points at `src/shared/db/schema/migratable.ts` and derives its `tablesFilter` from that same barrel, so there is no second hand-maintained allowlist. Migrate-based: `pnpm db:generate` then **commit `drizzle/`** (it is version-controlled); `pnpm db:migrate` is the deploy path. Do NOT use `db:push` on business tables — it desyncs the journal (root cause of the prior schema drift). The barrel deliberately excludes auth tables — neither `db:push` nor `db:migrate` will touch them. **Schema authority + current deploy order: `src/shared/db/CONTEXT.md` (BQC-5.4).**

## Fresh-database provisioning

The pinned Better Auth schema API creates all eight auth tables on an empty
database. This is exercised by CI and by `pnpm db:migrate-deploy`; no manual
auth bootstrap belongs in the normal deployment path.

Use the production authority, `pnpm db:migrate-deploy`, to run the Better Auth
runtime track, the three-entry Drizzle journal, and provider-subject
initialization. For schema-only local or CI setup, run `pnpm auth:migrate`
followed by `pnpm db:migrate`.

The deploy runner invokes Better Auth's runtime track before the Drizzle
constructs that reference auth-owned tables. `pnpm check:schema-drift` verifies
the resulting auth tables against the query mirror, so no bootstrap SQL or
compatibility test is needed.

**Single source of truth for auth additionalFields:** `src/shared/auth/org-schema.ts` — imported by BOTH `src/shared/auth/auth.ts` (runtime) and `src/shared/auth/auth-cli.ts` (migration CLI). Edit it ONCE; both configs see the change. Never re-declare additionalFields inline in either file.

## Workflow — adding/changing an auth additionalField (e.g. a new column on `organization` / `invitation`)

1. Edit `src/shared/auth/org-schema.ts` (the only place).
2. `pnpm auth:migrate` to apply. The runner prints the table and column counts
   it applied; there is no separate generate-and-review step.

## Do NOT

- Add hand-written SQL migrations for auth tables. The pinned Better Auth
  schema API is their sole migration authority.
- Re-declare `additionalFields` inline in `auth.ts` or `auth-cli.ts` — use `org-schema.ts`.
- Hand-patch an auth column with raw SQL when the tooling "didn't add it."

If `auth:migrate` reports "schema is up to date" but you expect a missing
column, the schema config (`auth-cli.ts`) has drifted from `auth.ts` — fix the
shared `org-schema.ts`, then re-run. Never bypass with manual SQL. The
standalone `@better-auth/cli` is deliberately not installed or fetched: its
release line may lag the runtime and therefore describe a different schema.
