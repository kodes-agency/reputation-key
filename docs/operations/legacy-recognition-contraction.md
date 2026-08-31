# Legacy Recognition contraction

Badge, Leaderboard, and the earlier governed Recognition experiment are not
beta capabilities. Production composition, startup, schedules, and demo seeding
do not construct or execute them. Their tables remain temporarily so historical
rows can be inventoried, exported, restored, and deliberately dispositioned.

## Read-only inventory

Run the report with an explicit observation time:

```text
pnpm ops:report-legacy-recognition \
  --operator <registered-operator> \
  --as-of <ISO-8601>
```

The command has no `--apply` mode. Version 3 reads exact counts for all 13
retained tables and reconstructable, schema-qualified PostgreSQL foreign-key
metadata in every schema whenever either endpoint is one of those public
tables. Counts and inbound/outbound foreign keys are collected in one
`REPEATABLE READ`, `READ ONLY` transaction, so the fingerprint describes one
coherent database snapshot. Output contains only schema/table/constraint and
ordered source/target column names, update/delete actions, match type,
deferrable/initially-deferred/validation flags, counts, fixed classifications,
status flags, and a SHA-256 fingerprint. That tuple is sufficient to recreate
composite and `NOT VALID` foreign keys. It does not select or print record
identifiers, names, criteria, scores, acknowledgements, or free text.

The report deliberately does not claim a complete non-FK dependency graph.
Before contraction, separately inventory triggers, functions, indexes, checks,
views, and grants. Known retained examples include the Recognition append-only
function and triggers installed by `0025_recognition-governance.sql`.

`sourceContext` records whether the retained declaration came from Badge or
Leaderboard; it is not lifecycle ownership. Every table is reported with the
canonical lifecycle owner `staff`, data-fate disposition `bounded_contraction`,
and authority `REC-01/CNV-01`. An executable guard proves that this 13-table set
matches the data-fate catalogue exactly.

The inventory covers:

- legacy Badge: `badge_definitions`, `organization_badge_enablements`, and
  `badge_awards`;
- legacy Leaderboard: `leaderboard_snapshots` and `leaderboard_entries`;
- governed Recognition experiment: `badge_definition_versions`,
  `recognition_activations`, `recognition_activation_groups`,
  `recognition_board_snapshots`, `recognition_board_entries`,
  `recognition_reconciliation_events`, `recognition_awards`, and
  `recognition_award_status_facts`.

Migration `0028_recognition-beta-seeds.sql` installs three definition rows and
three definition-version rows even in a fresh database. Therefore a fresh
inventory is intentionally not schema-contraction-ready: those six retained
rows still require an explicit export/restore decision and the seed migration
must be replaced prospectively before the tables can disappear.

## Completed source contraction

REC-01 removes the independently unreachable Badge/Leaderboard mechanics from
the production source tree: repositories, application ports/use cases, scoring
and award domains, mappers, seed/evaluation paths, and reconciliation logic.
No migration accompanies this step and it performs no database mutation. The
13-table schema, historical `badge.awarded` envelope, Notification persistence
vocabulary/neutral renderer, and content-free inventory/report remain. Server
operations and consumer declarations have been removed from source and from the
shared entry/event catalogues.

An executable exact-source allowlist prevents deleted mechanics from returning.
The inert builds construct no repositories, use cases, consumers, jobs, or
schedules. Rollback of this code-only step is source restoration through the
normal reviewed version-control/release path; never recreate rows or change
schema to roll it back.

## Deletion gate

`schemaContractionCandidate` is only a mechanical precondition. It becomes true
when all 13 tables are empty, no external table has an inbound dependency on a
retained table, and all discovered foreign keys are validated. Outbound
dependencies are still inventoried for export/restore disposition, but do not
mechanically prevent dropping their source table. The flag is not deletion
approval.

Before contracting the database schema or historical decoding compatibility:

1. Retain a signed inventory from the immutable candidate database.
2. Define a versioned export format for all non-empty tables, including ordering,
   checksums, tenant scoping, encryption, retention, and access controls.
3. Restore that export into an isolated database and compare exact per-table
   counts, reconstructable foreign-key metadata, and the content-free inventory
   fingerprint.
4. Decide whether historical neutral Notification rendering needs an archive
   projection before the retained renderer and persistence vocabulary can be
   removed. There is no active Badge compatibility consumer.
5. Disposition every external inbound/outbound foreign key, every non-FK schema
   dependency, and every downstream artifact.
6. Remove the old seed path prospectively, observe at least one release with no
   producers/readers, and only then review a reversible schema contraction.

Until all six steps have retained evidence, all 13 tables, migration history,
historical decoding, and inventory/report code remain. No
report result authorizes deletion by itself.
