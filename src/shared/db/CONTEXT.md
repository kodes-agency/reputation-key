# shared/db — Context

**Audience:** Developers and agents working in `src/shared/db/`.

## Responsibility

Drizzle `pgTable` declarations are the application-schema authority. Shared DB also owns connection/pool mechanics, the migration journal, non-DSL PostgreSQL constructs, control-plane seed rows, schema drift comparison, and test isolation.
Bounded contexts retain the business meaning and lifecycle of their records.

## Schema tracks

1. **Drizzle journal** — `0000_baseline.sql` contains every application table,
   `0001_db_constructs.sql` copies `db-constructs.sql`, and `0002_db_seed.sql`
   copies `db-seed.sql`. `pnpm db:migrate` applies this generated three-entry
   journal, including functions, triggers, and DDL on Better Auth tables.
2. **Better Auth** — `pnpm auth:migrate` owns `user`, `session`, `account`,
   `verification`, `organization`, `member`, `invitation`, and
   `organizationRole`. `schema/auth.ts` is a read-only Drizzle query mirror.
   This track runs first so the DB-only constructs can reference its tables.

Schema, journal, barrel, auth-mirror, DB-only construct, and deploy-runner parity are enforced by `src/shared/db/migration-verification.test.ts`, `src/shared/db/schema/schema-migration-parity.test.ts`, `src/shared/db/schema/migratable.test.ts`, and `src/shared/db/deploy-migration-runtime.test.ts`.

## Change loop

```bash
$EDITOR src/shared/db/schema/<context>.schema.ts
pnpm db:baseline
pnpm db:reset
pnpm check:schema-drift
```

`db:baseline` regenerates the journal and hoists unique indexes required by
composite foreign keys. Edit `db-constructs.sql` directly for functions, triggers,
EXCLUDE constraints, and DDL on Better Auth tables; its parser derives the
register. Put every construct expressible by Drizzle in the model instead.

Every environment currently starts from an empty database. A regenerated journal
cannot be applied over a database that recorded the old entries; if preservation
becomes necessary, append a migration instead of re-baselining.

## Deploy and recovery

Deploy order is `pnpm auth:migrate` → `pnpm db:migrate`.
The signed web image runs that sequence under a deployment advisory lock only
after proving its exact cell/project/environment/service identity. Recovery is
fix-forward-and-rerun—never hand-roll partial schema state.

`migration-verification.test.ts` compares the migrated PostgreSQL catalogue with
the full model in both directions: columns, types, defaults, keys, checks, foreign
keys/actions, indexes, predicates, enums, registered constructs, and journal
continuity. `pnpm check:schema-drift` exposes the same comparator for operators.

Never run `pnpm db:push` against a shared database; it bypasses the journal.

## Seed and auth mirror

`db-seed.sql` contains control-plane rows read but not written by the application:
AI operation/routing catalogues, Metric definitions, and cell topology. Rebuild it
from an approved fully migrated database when a catalogue changes; a DDL-only
baseline leaves those paths fail-closed.

`schema/auth.ts` must match the tables produced by the pinned Better Auth migrator,
including names, types, nullability, and defaults. Drizzle never migrates this
mirror. DB-only DDL on those tables lives in `db-constructs.sql` and is parity-tested.

## Boundaries

Contexts import schema tables only inside their own infrastructure. Routes,
components, domain, application, and server adapters never access the DB runtime
directly. Tests use `db/testing/` leases and cleanup helpers; production modules
must not import them.

Database and test-support import boundaries are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Verification

Run the change loop for schema work. Use real PostgreSQL tests for migrations, constraints, transactions, locks, tenant isolation, and drift. Unit tests are appropriate only for pure parsing/comparison helpers.
