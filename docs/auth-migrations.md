# Auth-Table Schema Migrations — Runtime Authority

**Status:** Accepted
**Scope:** Auth tables managed by better-auth

Auth tables and their custom columns are part of the committed journal in
`drizzle/`. Migration `0133` creates the tables exactly as the
repository-pinned `better-auth` runtime does, on a database that has none yet;
a database the runtime already provisioned keeps its tables untouched.
`pnpm db:migrate-deploy` runs that one journal and then refuses to finish if the
pinned runtime expects a table or column the journal does not create. Manual
`ALTER TABLE` / `CREATE TABLE` against a live auth table is a **STRICT NO** —
it silently drifts the live DB. (This exact drift once left
`invitation.propertyIds` and Organization custom columns missing, so every
invite returned a 500.)

**Auth-managed tables (Better Auth schema API):** `user`, `session`, `account`,
`verification`, `organization`, `member`, `invitation`, and ALL
`additionalFields` on them.

**Business tables (Drizzle):** the migratable barrel currently exports all 195 app-owned tables. `drizzle.config.ts` points at `src/shared/db/schema/migratable.ts` and derives its `tablesFilter` from that same barrel, so there is no second hand-maintained allowlist. Migrate-based: a schema change is a migration written by hand and appended to the journal in `drizzle/`, which is version-controlled (the change loop is in `src/shared/db/CONTEXT.md`; `pnpm db:generate` is not it, because drizzle-kit's snapshots stop at `0013`); `pnpm db:migrate` is the deploy path. Do NOT use `db:push` on business tables — it desyncs the journal (root cause of the prior schema drift). The barrel deliberately excludes auth tables — neither `db:push` nor `db:migrate` will touch them. **Schema authority + current deploy order: `src/shared/db/CONTEXT.md` (BQC-5.4).**

## Fresh-database provisioning

`pnpm db:migrate-deploy` (and `pnpm db:migrate`) builds the auth tables from the
journal on an empty database. CI still runs `pnpm auth:migrate` first, so every
run also proves that the journal adopts tables the runtime created, as it did
on the beta. `pnpm check:schema-drift` compares both with `structure.sql`.

**Single source of truth for auth additionalFields:** `src/shared/auth/org-schema.ts` — imported by BOTH `src/shared/auth/auth.ts` (runtime) and `src/shared/auth/auth-cli.ts` (schema runner). Edit it ONCE; both configs see the change. Never re-declare additionalFields inline in either file.

## Workflow — adding/changing an auth additionalField (e.g. a new column on `organization` / `invitation`)

1. Edit `src/shared/auth/org-schema.ts` (the only place).
2. `pnpm auth:migrate` against a disposable database shows what the runtime
   adds; write the same column as a journal migration
   (`ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS ...`, nullable or with a
   constant default) and mirror it in `src/shared/db/schema/auth.ts`.
3. Regenerate `structure.sql` (the change loop in `src/shared/db/CONTEXT.md`).

## Do NOT

- Hand-patch a live auth column with raw SQL outside the journal.
- Re-declare `additionalFields` inline in `auth.ts` or `auth-cli.ts` — use `org-schema.ts`.

The standalone `@better-auth/cli` is deliberately not installed or fetched: its
release line may lag the runtime and therefore describe a different schema.
