# shared/db — Context

**Audience:** Developers and agents working in `src/shared/db/`.

## Responsibility

Drizzle `pgTable` declarations are the application-schema authority. Shared DB also owns connection/pool mechanics, the migration journal, non-DSL PostgreSQL constructs, control-plane seed rows, schema drift comparison, and test isolation.
Bounded contexts retain the business meaning and lifecycle of their records.

Each process has one pool (`pool.ts`). Web keeps `POOL_MAX_CONNECTIONS` (10);
the worker sizes its pool from every queue's concurrency at boot
(`src/worker/pool-budget.ts`, ADR 0060). A unit of work that holds a lock
while it opens a second transaction reserves both clients first
(`pool-client-reservation.ts`): a lock holder never waits on the pool.

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

Recovery is also forward-only (ADR 0038, amended 2026-10-12). The deploy runner
and the readiness probe require the applied migration count to equal the image's
journal, and `migration-journal-state.ts` names the direction of a mismatch for
both. Fewer applied than the journal is an incomplete deploy: a rerun converges.
More applied than the journal means the image is older than the database: it is
refused by design, no rerun converges, and the repair is a fix deployed forward
(`docs/operations/runbooks.md` §28). `migration-journal-state.test.ts` pins both
messages.

The count reads the same for an image whose journal lost an applied migration.
So a migration file and its journal entry are never deleted once a deployed
database has applied them, and a commit that touched `drizzle/` is never plainly
reverted: revert the code and keep `drizzle/` and the schema model, or undo the
schema change with a new migration. Nothing in CI catches a shortened journal,
because CI migrates an empty database from the same checkout. On a developer
machine the same refusal from `pnpm db:migrate-deploy` only means the checkout
is behind the local database: bring the checkout up to date, or start the local
database again with `pnpm db:reset` (it drops the database; localhost only).

`migration-verification.test.ts` compares the migrated PostgreSQL catalogue with
the full model in both directions: columns, types, defaults, keys, checks, foreign
keys/actions, indexes, predicates, enums, registered constructs, and journal
continuity. `pnpm check:schema-drift` exposes the same comparator for operators.

The journal is appended by hand, so the comparator checks the file before it
looks at a database (`migration-journal-order.ts`): each entry's `idx` is its
position, its `when` is above the entry before it, a tag is journalled once, and
every entry has its SQL file and every SQL file its entry. drizzle applies an
entry only when its `when` is greater than the newest applied row, so an entry
that does not rise is applied on CI's empty database and skipped on a migrated
one. The last `when` is dated ahead of the calendar: step a new entry from the
previous one (100,000,000 ms) instead of stamping real time.
`migration-journal-order.test.ts` runs the file check with no database. It
cannot see an entry placed before ones a deployed database already applied; the
deploy runner's count check refuses that deploy.

Never run `pnpm db:push` against a shared database; it bypasses the journal.

## Seed and auth mirror

`db-seed.sql` contains control-plane rows read but not written by the application:
AI operation/routing catalogues, Metric definitions, and cell topology. Rebuild it
from an approved fully migrated database when a catalogue changes; a DDL-only
baseline leaves those paths fail-closed.

The seed also leaves every Google content capability denied and every AI
capability killed. The deploy runner lifts only the ones the environment declares
(`GOOGLE_CONTENT_CAPABILITIES_ALLOWED`, `AI_CAPABILITIES_ENABLED`) and only while
they are still that seed default — ADR 0032, amended 2026-09-29.

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
