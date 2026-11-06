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

Job dispatch supplies an abort signal and deadline through
`execution-deadline.server.ts`. Databases built by `createDatabase` (including
`getDb` and AI admission) set a transaction-local PostgreSQL statement timeout
from the remaining deadline and refuse commit after abort. Transactions outside
job dispatch keep their existing behaviour.

Every pooled session is set to UTC beside its lock timeouts (`pool.ts`). Six
CHECK constraints compare a deadline with `timestamptz + interval 'N days'`, a
sum PostgreSQL makes in the session's zone, and the application counts those
deadlines in fixed milliseconds, so the two agree only where a day is always 24
hours. Do not rely on the server default: `pool-session-time-zone.integration.test.ts`
connects with a daylight-saving default and writes across a change. A session
opened outside the pool (a script's own `pg.Client`) keeps the server default.

## Schema history

`drizzle/meta/_journal.json` and its SQL files are the application schema history.
Applied entries retain their position, timestamps and SQL. Better Auth still
provisions its tables through the pinned runtime before the journal runs;
`schema/auth.ts` mirrors those tables. Registered concurrent indexes still run
through `concurrent-index-sidecar.ts` after the journal.

`migrate-journal.server.ts` serializes the journal with a session advisory lock.
Ordinary files and their journal rows commit together, one file at a time, with
a five-second lock-wait bound. Failed files roll back; completed files survive.
`migrate-journal.integration.test.ts` exercises actual PostgreSQL lock waits,
journal INSERT failures, cancellation, lock release and reruns.

Schema, journal, barrel, auth-mirror, DB-only construct, and deploy-runner parity are enforced by `src/shared/db/migration-verification.test.ts`, `src/shared/db/schema/schema-migration-parity.test.ts`, `src/shared/db/schema/migratable.test.ts`, and `src/shared/db/deploy-migration-runtime.test.ts`.

## Change loop

```bash
$EDITOR src/shared/db/schema/<context>.schema.ts   # the model
$EDITOR drizzle/NNNN_<name>.sql                    # the migration, written by hand
$EDITOR drizzle/meta/_journal.json                 # its entry, appended last
DEPLOY_MIGRATE=1 pnpm db:migrate-deploy            # apply it to the local database
pnpm check:schema-drift
pnpm check:migration-journal
```

A schema change is a migration appended to the journal. The journal is history:
the beta database started empty on 2026-09-05, has applied every entry since and
keeps its data between deploys, so the journal is never regenerated and an
applied entry keeps its position, `idx` and `when`. Write the SQL by hand beside
the model change and append the journal entry under the rules of "Deploy and
recovery" below (the next `idx`, a `when` stepped from the entry before it, last
in the file). `pnpm check:schema-drift` then compares the migrated catalogue
with the model, and `pnpm db:reset` proves the whole journal still applies from
empty, as CI applies it.

Two commands that look like this loop are not it. `pnpm db:baseline` deletes
`drizzle/` and writes the three generated entries again. It was the loop while
every environment started from an empty database; it now refuses while
`drizzle/` holds an appended migration (`scripts/local/db-baseline.test.ts`).
`pnpm db:generate` diffs the model against drizzle-kit's newest snapshot, and
the snapshots in `drizzle/meta/` stop at `0013`, so it would restate every
change the hand-written migrations have made since.

Edit `db-constructs.sql` directly for functions, triggers, EXCLUDE constraints,
and DDL on Better Auth tables; its parser derives the register, and the
migration that changes one restates it (below). Put every construct expressible
by Drizzle in the model instead. The exception is a trigger on a table a later
migration creates: `0001` copies `db-constructs.sql` byte for byte and runs
before that table exists, so the trigger is stated only in its migration and
registered in `MIGRATION_CREATED_CONSTRUCTS` and `UNPARSED_CONSTRUCTS`
(`construct-definitions.ts`), as `0069` does for the Response Target exclusions.

An index on a continuously written table uses `CREATE INDEX CONCURRENTLY`.
The existing registry remains authoritative until its journal-adoption release.
The journal runner also supports files headed `-- migrate:nontransactional`
containing one concurrent build: it repairs interrupted invalid indexes and
records a row only after a valid build. If recording fails, a rerun reuses the
completed index.

The retention sweep orders every batch by its rule's timestamp, so each rule
needs an index that leads with that column. For a delete a plain one is enough:
matched rows leave the range. A redaction keeps its rows, so everything it has
already cleared stays below the cutoff and a plain index makes each batch pass
all of it; a redaction rule needs a partial index whose predicate is the rule's
own `extraWhere`, which holds only the rows not yet cleared. A partial index
with any other predicate serves no rule: PostgreSQL uses one only when the
statement states its predicate. `retention/retention-rule-indexes.test.ts` fails
on a rule with no index its batch can use.

## Deploy and recovery

`pnpm db:migrate-deploy` runs Better Auth, the committed journal and registered
concurrent indexes under the deploy identity guard and advisory lock, initializes
provider-subject keys, then applies the declared capability posture.
`pnpm db:migrate` applies the journal; `pnpm auth:migrate` runs pinned Better Auth.

New existing-table CHECK additions require `NOT VALID`; put `VALIDATE CONSTRAINT`
in a separate file so the validation scan cannot extend the DDL transaction.
The original tags, timestamps and SQL hashes of pre-existing history are retained
as compatibility exceptions in `legacy-migration-hashes.json`; edited SQL or a
different journal identity gets no exception. The runner also refuses a file
whose hash differs from its applied journal row.

Deploy readiness compatibility with the existing journal before appending any
migrations: an outgoing image that requires exact counts becomes unready as soon
as an expand is recorded. `readiness-migration-journal.test.ts` executes the pinned
previous revision's probe and journal; `readiness-rollout.integration.test.ts`
checks that transition against PostgreSQL, including the old journal table shape.
Only after both services run the compatibility release may auth/index adoption
append migrations and replace their existing provisioning paths.

Only explicitly supported expand forms bypass contraction preflight: new tables,
nullable column additions or additions with constant defaults, nonunique concurrent
indexes, named `NOT VALID` constraints and separate constraint validation. Every
other form requires reader-removal evidence, including unrecognised statements
and `ALTER COLUMN ... DROP DEFAULT`, which can break inserts from older images.

Thereafter expands preserve readiness for the previous image. An incomplete
journal keeps the new image unready. A contract file declares
`-- migrate:contract <reader-removal commit>`; deployment preflight reads the
target revision's SQL and checks the database journal for pending contractions.
Only pending contractions require verification of both healthy running web and
worker digests against their release's CI images and removal-commit ancestry
before any deploy mutation. A later applied contract makes an older journal
unready. The migration command itself still refuses an authority older than the
database.

Never delete an applied migration to revert application code. Recover forward,
rerun the journal and leave completed files intact. Keep long backfills outside
schema transactions. Each file holds acquired locks until its commit; the wait
bound limits waiting, not transaction duration.

`migration-verification.test.ts` compares the migrated PostgreSQL catalogue with
the full model in both directions: columns, types, defaults, keys, checks, foreign
keys/actions, indexes, predicates, enums, registered constructs, and journal
continuity. `pnpm check:schema-drift` exposes the same comparator for operators.

The journal is appended by hand. `migration-journal-order.ts` checks that each
entry's `idx` is its position, `when` rises, tags are unique, and every SQL file
has exactly one entry. Applied rows are matched by timestamp and verified by
file hash, including after a prerequisite commits before historical files.
The last `when` is dated ahead of the calendar: step a new entry from the
previous one (100,000,000 ms) instead of stamping real time.
`migration-journal-order.test.ts` runs the file check with no database.

The journal is append-only: an entry already on `main` keeps its position, `idx`
and `when`, and a new entry goes after them, last. The file alone cannot show a
breach, because it cannot tell a new entry from one a deployed database has
applied. `pnpm check:migration-journal` (`scripts/check-migration-journal.ts`,
run by `lint:ci`) reads the journal at the merge base with `main` and fails when
one of its entries moved, changed or is gone. The case it exists for is a rebase
that keeps the branch's entry before the one `main` gained and raises that
entry's `when` so the file still rises: the deployed database would run `main`'s
migration a second time and skip the new one, and its row count would equal the
journal's, so the deploy runner's count check passes. After a journal conflict,
take `main`'s entries as they are and re-step only your own.

Functions and triggers are compared by definition, not by name
(`construct-definitions.ts`): signature, attributes and body of every function,
and every trigger's statement, as `db-constructs.sql` states them. Both sides
are PostgreSQL's own rendering, so state a new function or trigger the way
`pg_get_functiondef` / `pg_get_triggerdef` print it. A migration that changes
one restates it in three places with the same text: `db-constructs.sql`, its
byte copy `drizzle/0001_db_constructs.sql`, and the new migration.
`construct-definitions.test.ts` holds the copy and, with no database, that each
construct's last migration creates what the comparator expects.

A change to an attribute alone (volatility, strictness, parallel safety) can be
made with `ALTER FUNCTION` instead of restating the body, as `0075` did for the
two Property local-date functions; the file and its copy then carry the new
attribute and the comparator checks the migrated catalogue against them. A
function may be labelled `PARALLEL SAFE` or `PARALLEL RESTRICTED` only if its
body starts no subtransaction (a PL/pgSQL `EXCEPTION` clause does), writes
nothing and touches no sequence or setting; `db-constructs-parallel-safety.test.ts`
reads the file for that, and `local-date-functions-parallel.integration.test.ts`
runs the real functions in a forced parallel plan. PostgreSQL prints no clause for
`PARALLEL UNSAFE`, so a function stated with none is unsafe.

ADR 0074 names a forward-only exception to the baseline byte-copy rule:
`apply_merchant_ai_transition_v1` (migration 0084's definition) and
`merchant_ai_notice_material_changes_v1` (restated by 0088 with the 2026-11-01 notice) are
stated in `db-constructs.sql`, while 0001
and 0016 remain immutable historical SQL. The transition has only its live
27-argument signature, including the ceremony id; never recreate the retired
26-argument overload. Construct parity checks cover the exception explicitly.

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

`schema/auth.ts` must match the committed auth SQL and pinned Better Auth configuration,
including names, types, nullability, and defaults. The pinned Better Auth runtime
provisions these tables. DB-only DDL on those tables lives in `db-constructs.sql`
and is parity-tested.

## Boundaries

Contexts import schema tables only inside their own infrastructure. Routes,
components, domain, application, and server adapters never access the DB runtime
directly. Tests use `db/testing/` leases and cleanup helpers; production modules
must not import them.

Database and test-support import boundaries are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Verification

Run the change loop for schema work. Use real PostgreSQL tests for migrations, constraints, transactions, locks, tenant isolation, and drift. Unit tests are appropriate only for pure parsing/comparison helpers.
