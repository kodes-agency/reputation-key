# shared/db — Context

**Audience:** AI agents and developers working in `src/shared/db/`.

## Schema authority (BQC-5.4)

**The migration SQL track is the schema authority.** Three owned tracks make
up the deployed schema:

1. **Drizzle journal track** — `drizzle/0000_init.sql` …
   `0140_single_us_beta_data_cell.sql` with
   `drizzle/meta/_journal.json` (141 entries). The migratable barrel currently
   owns 195 application tables. Managed by `pnpm db:generate` /
   `pnpm db:migrate`; the count is derived from that barrel, never maintained
   as a second allowlist.
2. **Better Auth schema track** — `pnpm auth:migrate`
   (`scripts/better-auth-schema.ts` using the exact pinned `better-auth`
   runtime and `src/shared/auth/auth-cli.ts` config). Owns the 8 auth tables
   (`user`, `session`, `account`, `verification`, `organization`, `member`,
   `invitation`, `organizationRole`). Drizzle never manages these;
   `schema/auth.ts` is a read-only query mirror of them.
3. **Registered deploy sidecars** — constructs Drizzle cannot safely own:
   `scripts/google-property-binding-index.ts` owns the duplicate-audited,
   advisory-locked `CREATE UNIQUE INDEX CONCURRENTLY` lifecycle for
   `properties_org_gbp_location_id_unique`; and
   `scripts/migrations/2026-07-06-permission-version-triggers.sql` owns the
   idempotent DAC functions/triggers plus the `organizationRole` expression
   index. `scripts/migrations/0000-auth-tables-bootstrap.sql` is a
   parity-tested recovery-only compatibility path; every other file in
   `scripts/migrations/` is a historical one-off — do not apply it.

The Drizzle model (`schema/*.ts`) is the application-side model of track 1 (+2
as a mirror). It is **verified semantically** against the actually-migrated
PostgreSQL metadata — tables/columns/types/nullability/defaults, PK/unique/
check/FK constraints incl. actions, indexes incl. column order/direction/
expressions/partial predicates, enum labels, and journal continuity — by
`migration-verification.test.ts` (integration project, runs in CI against the
migrated DB). The comparator lives in `schema-drift.ts` and is also runnable
standalone: `pnpm check:schema-drift` (see `scripts/check-schema-drift.ts`).

**Deploy apply order:** `pnpm auth:migrate` → `pnpm db:migrate` →
`pnpm db:google-property-binding-index` → the registered SQL sidecar. The
`db:migrate` wrapper applies the journal through immutable migration 0033 and
commits, autocommits the `cleanup_required` enum label, then applies 0034 onward.
PostgreSQL otherwise rejects 0034 for using a new enum label in the transaction
that added it. The stages are idempotent on fresh, partial, and already-current
databases. CI applies the same order, so the tested DB matches deploy state.
BQC-7.1: the first single-US rollout runs the sequence from the signed web
image in Railway's one-shot `schema-migrator`; later web deployments rerun it
via `preDeployCommand` (`node dist-worker/migrate-deploy.js`, source
`scripts/migrate-deploy.ts`). Railway runs prove their exact `cell-us`
project/environment/service identity before opening the database, and migration
0140's control row is bound to the platform-provided opaque IDs. A deployment
advisory lock serializes the full sequence; the Property index sidecar takes
its own session lock and runs its concurrent DDL outside the Drizzle
transactions. Recovery is
fix-forward-and-rerun (never hand-roll partial schema). CI's “Predeploy migration
parity” step proves the manual and production runners converge to the same end
state on every PR.

## How to change the schema

1. Edit the model in `schema/*.ts` (or hand-write SQL when Drizzle cannot
   express the change).
2. `pnpm db:generate` for model-expressible changes (the snapshot chain was
   repaired in BQC-5.4 — see `drizzle/REPAIR.md` — so generate works
   again), or hand-write `drizzle/NNNN_name.sql` + a `_journal.json` entry
   (the 0011–0016 pattern; keep idx contiguous and add a snapshot via a
   scratch generate, never a copy).
3. Commit `drizzle/`. Deploy runs `pnpm db:migrate`.
4. The semantic test is the gate either way: it compares the model against
   the migrated catalog, not symbol presence.
5. **Never `pnpm db:push`** against any shared database — it bypasses the
   journal and was the root cause of the pre-2026 drift.

## DB-only constructs

Constructs the model deliberately does not own are registered in
`schema/db-only-constructs.ts` with `name / kind / owner / source / reason`.
The drift test verifies every registered construct EXISTS in pg_catalog and
fails on any UNREGISTERED trigger/function/index/check/enum/view it finds
(both directions closed).

To add one: land it via a journaled migration or the registered sidecar,
append a register entry with an explicit owner and reason, and keep the entry
in sync when the object is dropped. `kind: 'other'` entries are
documentation-only; all other kinds are existence-verified.

What belongs in the register vs the model: if drizzle-orm 0.45 can express it
(plain/partial/unique/expression-free indexes incl. `col.desc()` direction,
`check()`, `pgEnum`, composite `foreignKey`), it MUST be declared in the
model — the register is only for what the model cannot own (functions,
triggers, DDL on Better Auth–owned tables).

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
- `schema/index.ts` — barrel of all 203 modeled tables (195 app + 8 auth mirror).
- `schema/migratable.ts` — barrel of the 195 Drizzle-managed tables;
  `drizzle.config.ts` points here. No `tablesFilter` whitelist.
- `schema/db-only-constructs.ts` — the DB-only register (see above).
- `retention/` — retention sweep subjects.
- `disable-guard-triggers.ts` — fixture-teardown escape hatch that disables
  only the `member_last_owner_*` guard triggers inside a transaction (FK
  cascades keep working), so integration-test cleanup can delete last-owner
  member rows despite the deployed `guard_last_owner` backstop; test files
  only.
