# shared/db — Context

**Audience:** AI agents and developers working in `src/shared/db/`.

## Schema authority

**The pgTable declarations are the authority.** The journal is regenerated from
them, not appended to. Three owned tracks make up the deployed schema:

1. **Drizzle journal track** — exactly three migrations, all generated:
   `drizzle/0000_baseline.sql` (every application table, derived from the
   migratable barrel — 225 tables today), `drizzle/0001_db_constructs.sql`
   (a copy of `db-constructs.sql`: 114 functions, 140 triggers and 7 btree_gist
   exclusion constraints drizzle-orm has no DSL for) and
   `drizzle/0002_db_seed.sql` (a copy of `db-seed.sql`: 63 control-plane rows —
   the AI operation/routing catalogues, the metric definition registry and the
   single-cell topology row — which the 182-migration journal seeded by hand
   and a DDL-only baseline would silently omit). Applied by `drizzle-orm`'s
   own `migrate()`; `pnpm db:migrate` is the local wrapper.
2. **Better Auth schema track** — `pnpm auth:migrate`
   (`scripts/better-auth-schema.ts` using the exact pinned `better-auth`
   runtime and `src/shared/auth/auth-cli.ts` config). Owns the 8 auth tables
   (`user`, `session`, `account`, `verification`, `organization`, `member`,
   `invitation`, `organizationRole`). Drizzle never manages these;
   `schema/auth.ts` is a read-only query mirror of them.
3. **Registered deploy sidecar** —
   `scripts/migrations/2026-07-06-permission-version-triggers.sql` owns the
   idempotent DAC functions/triggers plus the `organizationRole` expression
   index, because they sit on Better Auth-owned tables where two migrators must
   not share DDL ownership. `scripts/migrations/0000-auth-tables-bootstrap.sql`
   is a parity-tested recovery-only compatibility path; every other file in
   `scripts/migrations/` is a historical one-off — do not apply it.

## The schema-change loop

```bash
$EDITOR src/shared/db/schema/<context>.schema.ts   # 1. edit the declarations
pnpm db:baseline                                   # 2. regenerate both migrations
pnpm db:reset                                      # 3. drop, recreate, migrate
pnpm check:schema-drift                            # 4. prove model == catalog
```

`db:baseline` refuses to finish unless `drizzle/` holds exactly
`0000_baseline.sql`, `0001_db_constructs.sql`, `meta/0000_snapshot.json`,
`meta/0001_snapshot.json` and `meta/_journal.json`. It also hoists every
`CREATE UNIQUE INDEX` above the foreign keys: a composite FK referencing an
indexed column pair fails if that index does not exist yet, and drizzle-kit
emits tables, then keys, then indexes.

To change a function, trigger or exclusion constraint, edit
`db-constructs.sql` directly — it is the source, and
`schema/db-only-constructs.ts` parses the object names back out of it, so the
drift check needs no hand-maintained register. Two ordering facts are
load-bearing there and documented in the file's own header: extension-owned
functions are excluded, and SQL-language functions come after plpgsql ones.

**This only works because every environment starts from an empty database.**
A regenerated journal cannot be applied over a database that already recorded
the old entries. If a database ever needs preserving, append a migration
instead of re-baselining.

The Drizzle model is **verified semantically** against the actually-migrated
PostgreSQL metadata — tables/columns/types/nullability/defaults, PK/unique/
check/FK constraints incl. actions, indexes incl. column order/direction/
expressions/partial predicates, enum labels, and journal continuity — by
`migration-verification.test.ts` (integration project, runs in CI against the
migrated DB). The comparator lives in `schema-drift.ts` and is also runnable
standalone: `pnpm check:schema-drift` (see `scripts/check-schema-drift.ts`).

**Deploy apply order:** `pnpm auth:migrate` → `pnpm db:migrate` → the
registered SQL sidecar. The stages are idempotent on fresh, partial, and
already-current databases; CI applies the same order, so the tested DB matches
deploy state. Railway runs the sequence from the signed web image via
`preDeployCommand` (`node dist-worker/migrate-deploy.js`, source
`scripts/migrate-deploy.ts`), proving its exact `cell-us`
project/environment/service identity before opening the database. A deployment
advisory lock serializes the whole sequence. Recovery is
fix-forward-and-rerun — never hand-roll partial schema state. CI's "Predeploy
migration parity" step proves the manual and production runners converge on the
same end state on every PR.

## DB-only constructs

Constructs the model deliberately does not own live in `db-constructs.sql`,
which is the second migration. `schema/db-only-constructs.ts` PARSES their
names out of that file — functions from `CREATE OR REPLACE FUNCTION`, triggers
from `CREATE TRIGGER` — so there is no hand-maintained copy to drift. Only a
dozen entries stay explicit there: the btree_gist exclusion constraints and
CHECK constraints authored in migration SQL, plus DDL on Better Auth-owned
tables.

The drift test verifies every registered construct EXISTS in pg_catalog and
fails on any UNREGISTERED trigger/function/index/check/enum/view it finds
(both directions closed).

To add one: append it to `db-constructs.sql`, then `pnpm db:baseline &&
pnpm db:reset && pnpm check:schema-drift`. The parser picks the name up; there
is nothing else to register.

What belongs in `db-constructs.sql` vs the model: if drizzle-orm 0.45 can
express it (plain/partial/unique/expression indexes incl. `col.desc()`
direction, `check()`, `pgEnum`, composite `foreignKey`), it MUST be declared in
the model. The constructs file is only for what the model cannot own —
functions, triggers, EXCLUDE constraints, and DDL on Better Auth-owned tables.

**Never `pnpm db:push`** against any shared database — it bypasses the journal
and was the root cause of the pre-2026 drift.

## Control-plane seed rows

`db-seed.sql` is the third migration: 63 rows the application reads but never
writes at runtime — AI operation/routing/capability catalogues, the metric
definition registry, and the single-cell topology row. They were seeded by
`INSERT` inside 20 of the old 182 migrations, so a DDL-only baseline booted an
empty control plane and every AI and metric path failed closed. Extracted once
from the fully-migrated database; regenerate the same way (`pg_dump
--data-only --column-inserts` of the seeded tables) if a catalogue changes.

## Auth table mirror (`schema/auth.ts`)

Read-only Drizzle definitions for querying Better Auth's tables. Column
names/types/nullability/defaults must match what `pnpm auth:migrate` actually
creates (timestamptz; CLI-set defaults only) — the drift test compares the
mirror column-by-column against the live auth tables (this is what caught the
phantom `invitation.teamId` and missing `organization.metadata`).

## Files

- `index.ts` — DB client factory + schema re-export for queries.
- `pool.ts` — pg pool singleton.
- `columns.ts` — standard `created_at` / `updated_at` / `deleted_at` columns.
- `schema-drift.ts` — model ↔ pg_catalog comparator (test + script consume).
- `migration-verification.test.ts` — integration gate (presence + semantic parity).
- `schema/index.ts` — barrel of all 233 modeled tables (225 app + 8 auth mirror).
- `schema/migratable.ts` — barrel of the 225 Drizzle-managed tables;
  `drizzle.config.ts` points here. No `tablesFilter` whitelist.
- `schema/db-only-constructs.ts` — the DB-only register (see above).
- `retention/` — retention sweep subjects.
- `disable-guard-triggers.ts` — fixture-teardown escape hatch that disables
  only the `member_last_owner_*` guard triggers inside a transaction (FK
  cascades keep working), so integration-test cleanup can delete last-owner
  member rows despite the deployed `guard_last_owner` backstop; test files
  only.
