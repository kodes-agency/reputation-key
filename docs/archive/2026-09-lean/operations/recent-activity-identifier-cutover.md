# Recent Activity identifier cutover

Migration 0160 changes naming without copying projection rows. The canonical
table is `recent_activity_entries`, the enqueue authority is
`project-recent-activity`, and the Organization feed is `listRecentActivity`.
This runbook is a verification contract, not permission to deploy or mutate a
live database.

## Expand and rolling compatibility

- PostgreSQL renames the existing table and indexes in place.
- `activity_log` becomes a simple automatically updatable view over the
  canonical table. It permits an old binary to select, insert, update, or delete
  during a bounded rollback window without a second copy of the data.
- Current event handlers enqueue only `project-recent-activity`.
- The worker registers both job identifiers against the same idempotent handler.
  `insert-activity-log` is drain-only: it has no producer or schedule.
- Invitation privacy scrubbing recognizes both names so retained legacy work
  cannot reintroduce private invitation content.

## Evidence before promotion

1. Apply all migrations to a disposable fresh PostgreSQL database and run the
   schema-drift gate.
2. Prove pre-0160 rows are visible through both the canonical table and the
   compatibility view, and prove writes through the view land in the canonical
   table.
3. Run the canonical-identifier guard and both job-name handler tests.
4. Confirm every active producer enqueues `project-recent-activity` and the
   catalogues contain exactly one canonical row plus one documented drain row.
5. Exercise a rollback in a disposable database. Rolling back the transaction
   must restore the original physical table with all pre-migration rows.

## Contract the compatibility seams

Do not remove the view or legacy job registration merely because the new
release is healthy. A later journaled contraction needs all of these facts:

- zero waiting, active, delayed, prioritized, failed, and quarantined jobs named
  `insert-activity-log` for the full configured retention window;
- no deployed release or supported rollback artifact references the old table,
  job, repository, use-case, query, or server identifiers;
- backup restore and recovery tooling succeeds using canonical names;
- invitation privacy inspection finds no retained old-name target; and
- the contraction has its own row-preservation and rollback evidence.

Until then, the view and drain handler are compatibility infrastructure. They
must never become current write/enqueue authorities.

## Historical vocabulary report and apply

The internal report is tenant-forced and content-minimal. It returns only each
action/resource pair, classification, row count, exact target fingerprint, and
report fingerprint. `unmappable` means no destination is inferred.

`ops:reconcile-recent-activity-vocabulary` is the production operator boundary
and remains report-only by default. It is Organization-scoped and emits the
content-free report before considering a write. Apply requires the shared named
operator decision, an exact reviewed source pair and canonical destination,
the report count and fingerprint, an operation UUID, a support ticket, reason,
and typed command confirmation. Its command-local authority binds the tenant,
approved operator, and evidence reference from that already-authorized
invocation; it cannot be enabled by ordinary web or worker composition.

PostgreSQL rechecks the fingerprint under the Organization lock; stale targets
do not change. The update and receipt are one transaction, so interruption
leaves neither a partial rewrite nor false evidence. Reusing an operation UUID
with different facts is a conflict. `unmappable` pairs must be reviewed and
given an explicit supported mapping; the command never guesses a destination.
