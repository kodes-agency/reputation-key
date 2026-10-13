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
  // Retention sweep (`src/shared/jobs/retention-sweep.job.ts`). Every batch of
  // a rule, the last empty one included, is
  // `WHERE <timestamp> < $1 [AND extra] ORDER BY <timestamp> LIMIT n`
  // (`retention/execute-retention-rule.ts`). These tables had no index leading
  // with their rule's timestamp, so each batch read and sorted the whole
  // table: the daily cost grew with history while the work did not. All eight
  // tables are written continuously, hence the sidecar and not the journal.
  // `retention/retention-rule-indexes.test.ts` holds every rule to an index
  // its batch can use.
  {
    name: 'guest_responses_retention_deadline_idx',
    table: 'guest_responses',
    columns: ['retention_deadline'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "guest_responses_retention_deadline_idx"
      ON "guest_responses" ("retention_deadline")`,
  },
  {
    // The 24-month delete reads it. The two pseudonym redactions cannot: see
    // the next two entries.
    name: 'scan_events_created_at_idx',
    table: 'scan_events',
    columns: ['created_at'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "scan_events_created_at_idx"
      ON "scan_events" ("created_at")`,
  },
  // A redaction keeps its row, so every scan it has already cleared stays
  // below the cutoff for the 24 months the row lives. Through the plain index
  // each batch would pass all of them to find the few that still hold a
  // value. Each redaction therefore reads a partial index whose predicate is
  // the rule's own `extraWhere`: it holds only the rows not yet cleared, and a
  // row leaves it when it is redacted. `ip_hash` is no longer written
  // (`guest.mapper.ts`), so the first one is empty and its rule ends at once.
  {
    name: 'scan_events_ip_hash_redaction_idx',
    table: 'scan_events',
    columns: ['created_at'],
    unique: false,
    hasPredicate: true,
    createSql: `CREATE INDEX CONCURRENTLY "scan_events_ip_hash_redaction_idx"
      ON "scan_events" ("created_at")
      WHERE "ip_hash" IS NOT NULL`,
  },
  {
    name: 'scan_events_session_id_redaction_idx',
    table: 'scan_events',
    columns: ['created_at'],
    unique: false,
    hasPredicate: true,
    createSql: `CREATE INDEX CONCURRENTLY "scan_events_session_id_redaction_idx"
      ON "scan_events" ("created_at")
      WHERE "session_id" IS NOT NULL`,
  },
  {
    name: 'guest_qualified_scans_occurred_at_idx',
    table: 'guest_qualified_scans',
    columns: ['occurred_at'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "guest_qualified_scans_occurred_at_idx"
      ON "guest_qualified_scans" ("occurred_at")`,
  },
  {
    name: 'outbox_events_published_at_idx',
    table: 'outbox_events',
    columns: ['published_at'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "outbox_events_published_at_idx"
      ON "outbox_events" ("published_at")`,
  },
  {
    // Partial: most notifications are never raised again, and the rule reads
    // only the ones that were (`coalesced_latest_at IS NOT NULL`).
    name: 'notifications_coalesced_latest_at_idx',
    table: 'notifications',
    columns: ['coalesced_latest_at'],
    unique: false,
    hasPredicate: true,
    createSql: `CREATE INDEX CONCURRENTLY "notifications_coalesced_latest_at_idx"
      ON "notifications" ("coalesced_latest_at")
      WHERE "coalesced_latest_at" IS NOT NULL`,
  },
  {
    // The table's other index on created_at is partial
    // (`notification_email_queue_immediate_acceptance_health_idx`: immediate
    // rows with no `not_before`), which the 90-day rule does not ask for.
    name: 'notification_email_queue_created_at_idx',
    table: 'notification_email_queue',
    columns: ['created_at'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "notification_email_queue_created_at_idx"
      ON "notification_email_queue" ("created_at")`,
  },
  {
    name: 'recent_activity_entries_created_at_idx',
    table: 'recent_activity_entries',
    columns: ['created_at'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "recent_activity_entries_created_at_idx"
      ON "recent_activity_entries" ("created_at")`,
  },
  {
    name: 'audit_logs_created_at_idx',
    table: 'audit_logs',
    columns: ['created_at'],
    unique: false,
    hasPredicate: false,
    createSql: `CREATE INDEX CONCURRENTLY "audit_logs_created_at_idx"
      ON "audit_logs" ("created_at")`,
  },
])
