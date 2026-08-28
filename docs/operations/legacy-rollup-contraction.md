# Legacy Metric rollup contraction

`rollup_daily_metrics`, `rollup_weekly_metrics`, `rollup_daily_inbox_metrics`
and `_rollup_watermarks` belong to the pre-beta incremental rollup path. The
beta runtime reads the governed metric model instead, but these four tables
remain bounded contraction sources until their data has been deliberately
inventoried, exported, restored, and dispositioned. Their canonical data-fate
classification is Metric-owned `bounded_contraction` under `MET-01/CNV-01`.

The watermark table is physically named `_rollup_watermarks`, with a leading
underscore. The Drizzle export is `rollupWatermarks`; a hand-typed name loses
the underscore and silently inventories nothing.

## Read-only inventory

`buildLegacyRollupInventoryReport` and `readLegacyRollupInventory` provide the
versioned inventory contract. Run the governed operator command with an explicit
observation time and retain its canonical JSON output:

```sh
pnpm ops:report-legacy-rollups \
  --operator <approved-operator-id> \
  --as-of 2026-08-28T00:00:00.000Z
```

The command passes through the standard operator policy/audit harness and is
read-only with respect to product state. Neither the command nor either
inventory function has an apply or removal mode.

Version 1 reads exact row counts for all four retained tables and
schema-qualified PostgreSQL foreign-key metadata from every schema whenever
either endpoint is one of them. Counts and dependencies are read in one
`REPEATABLE READ`, `READ ONLY` transaction. Each dependency records the
constraint and endpoint identifiers, ordered source and target columns,
update/delete actions, any delete-action column subset, match type,
deferrability, initial-defer state, and validation state.

The report is content-free. It emits only fixed data-fate classifications,
schema metadata, counts, blockers, status fields, the explicit observation time,
and a SHA-256 fingerprint. It never selects or emits organization, property or
portal identifiers, metric keys, bucket dates, counts per metric, sums,
averages, or watermark names.

The fingerprint is deterministic for the same observation time and database
snapshot: table classifications have a fixed order and foreign keys are sorted
by their schema-qualified endpoints and constraint name. Preserve both the
canonical JSON report and its fingerprint as release evidence.

The rollup projections are denormalised copies keyed by
`(organization_id, property_id, portal_id, metric_key, bucket)` with no
surrogate row identifier, so nothing textual elsewhere can name an individual
rollup row. That absence is recorded as an explicit exemption in
`src/shared/governance/non-fk-reference-surfaces.ts` — see
`docs/operations/non-fk-reference-inventory.md` — rather than left unstated.

## Report interpretation

`schemaContractionCandidate` is only a mechanical precondition. It is true when
all four retained tables are empty, no external table has an inbound foreign key
to any of them, and every discovered foreign key is validated.

The stable blocker values match the Goal contract:

- `retained_rows_require_export_restore` — at least one retained row exists;
- `external_foreign_key_dependencies_require_disposition` — a table outside the
  retained set references one of the retained tables;
- `unvalidated_foreign_keys_require_repair` — at least one discovered foreign
  key is not validated.

## Contraction gate

Before removing any of the four tables or the historical refresh path:

1. Retain a signed, immutable inventory from the exact candidate database.
2. Define a versioned, tenant-scoped export format with deterministic ordering,
   checksums, encryption, retention, and access controls for every non-empty
   table.
3. Restore the export into an isolated database and compare exact per-table
   counts, reconstructable foreign-key metadata, and the content-free inventory
   fingerprint.
4. Prove the governed metric model can reproduce every reporting answer these
   rollups currently serve, including the inbox aggregates.
5. Disposition every inbound and outbound foreign key, every non-FK schema
   dependency, and every downstream analytical artifact.
6. Observe at least one verified release with no rollup producer, reader, job,
   schedule, fixture, or reachable UI/server path.
7. Review and rehearse a reversible contraction migration, including rollback
   from the retained export, before applying it to an immutable release.

Until all seven steps have retained evidence, the four tables and the historical
source needed to interpret them remain in place. No inventory result authorizes
removal by itself.
