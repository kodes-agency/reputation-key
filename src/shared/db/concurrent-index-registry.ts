/**
 * Declarative registry of indexes built by `concurrent-index-sidecar.ts`
 * instead of by the journaled migrator.
 *
 * `drizzle-orm`'s migrator (`scripts/migrate-deploy.ts`, `scripts/migrate-drizzle.ts`)
 * wraps every pending migration file in one transaction, and PostgreSQL
 * refuses `CREATE INDEX CONCURRENTLY` inside a transaction block. A plain
 * (non-concurrent) `CREATE INDEX` in the journal takes a SHARE lock for the
 * whole build, which blocks writes to the table for its duration — acceptable
 * for a table with no meaningful production rows yet, but not for a table
 * this deployment already writes to continuously.
 *
 * Every entry here is therefore INTENTIONALLY ABSENT from its table's Drizzle
 * `pgTable` index array (see the comment at each table's declaration) and is
 * registered instead in `src/shared/db/schema/db-only-constructs.ts` so the
 * schema-drift comparator does not flag it as an unregistered catalog object.
 */

export type ConcurrentIndexSpec = Readonly<{
  /** Exact index name — also the `db-only-constructs.ts` registration key. */
  name: string
  table: string
  /** Column order exactly as PostgreSQL reports it via `unnest(pg_index.indkey)`. */
  columns: readonly string[]
  unique: boolean
  /** Whether the index carries a `WHERE` clause. The predicate TEXT is not
   * compared — see `concurrent-index-sidecar.ts` for why. */
  hasPredicate: boolean
  /** The exact statement the sidecar runs. Never executed inside a transaction. */
  createSql: string
}>

export const CONCURRENT_INDEX_REGISTRY: readonly ConcurrentIndexSpec[] = Object.freeze([
  {
    // database-03: the property-setup facts CTE joins completed snapshot runs
    // by (organization_id, property_id, source_epoch); the table's only index
    // is the partial unique index over the *nonterminal* states, so a
    // completed-run lookup was an unbounded, cross-tenant sequential scan.
    name: 'review_provider_snapshot_runs_completed_property_idx',
    table: 'review_provider_snapshot_runs',
    columns: ['organization_id', 'property_id', 'source_epoch'],
    unique: false,
    hasPredicate: true,
    createSql: `CREATE INDEX CONCURRENTLY "review_provider_snapshot_runs_completed_property_idx"
      ON "review_provider_snapshot_runs" ("organization_id", "property_id", "source_epoch")
      WHERE "state" = 'completed'`,
  },
  // database-04: metric_readings' three single-column FKs (property_id
  // cascade, portal_id cascade, group_id set null) are each checked with a
  // bare `WHERE <column> = $1` that no existing index can serve — every index
  // on the table is organization_id-prefixed. A Portal, Portal Group, or
  // Property delete therefore forces a full scan of what is expected to be
  // the largest, fastest-growing table in the system for each FK's cascade
  // check, in addition to whatever the tenant FK already does.
  {
    name: 'metric_readings_property_idx',
    table: 'metric_readings',
    columns: ['property_id'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "metric_readings_property_idx"
      ON "metric_readings" ("property_id")`,
  },
  {
    name: 'metric_readings_portal_only_idx',
    table: 'metric_readings',
    columns: ['portal_id'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "metric_readings_portal_only_idx"
      ON "metric_readings" ("portal_id")`,
  },
  {
    name: 'metric_readings_group_only_idx',
    table: 'metric_readings',
    columns: ['group_id'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "metric_readings_group_only_idx"
      ON "metric_readings" ("group_id")`,
  },
])
