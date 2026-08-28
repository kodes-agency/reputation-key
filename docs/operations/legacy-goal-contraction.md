# Legacy Goal contraction

The `goals` and `goal_progress` tables belong to the pre-beta Goal model. The
beta runtime uses Goal Programs instead, but these two tables remain as bounded
contraction sources until their data has been deliberately inventoried,
exported, restored, and dispositioned. Their canonical data-fate classification
is Goal-owned `bounded_contraction` under `GOA-01/CNV-01`.

## Read-only inventory

`buildLegacyGoalInventoryReport` and `readLegacyGoalInventory` provide the
versioned inventory contract. Run the governed operator command with an explicit
observation time and retain its canonical JSON output:

```sh
pnpm ops:report-legacy-goals \
  --operator <approved-operator-id> \
  --as-of 2026-08-28T00:00:00.000Z
```

The command passes through the standard operator policy/audit harness and is
read-only with respect to product state. Neither the command nor either
inventory function has an apply or delete mode.

Version 1 reads exact row counts for both retained tables and schema-qualified
PostgreSQL foreign-key metadata from every schema whenever either endpoint is
`public.goals` or `public.goal_progress`. Counts and dependencies are read in
one `REPEATABLE READ`, `READ ONLY` transaction. Each dependency records the
constraint and endpoint identifiers, ordered source and target columns,
update/delete actions, any delete-action column subset, match type,
deferrability, initial-defer state, and validation state. This is enough to
disposition and recreate the ordinary, composite, deferred, and `NOT VALID`
foreign keys found by the inventory.

The report is content-free. It emits only fixed data-fate classifications,
schema metadata, counts, blockers, status fields, the explicit observation
time, and a SHA-256 fingerprint. It never selects or emits Goal IDs, tenant or
subject IDs, names, descriptions, target values, progress values, creator
identities, or timestamps from retained records.

The fingerprint is deterministic for the same observation time and database
snapshot: table classifications have a fixed order and foreign keys are sorted
by their schema-qualified endpoints and constraint name. Preserve both the
canonical JSON report and its fingerprint as release evidence.

The inventory deliberately does not claim a complete non-foreign-key dependency
graph. Before contraction, separately inventory triggers, functions, indexes,
checks, views, grants, scheduled work, fixtures, application readers/writers,
exports, and downstream analytical artifacts.

## Report interpretation

`schemaContractionCandidate` is only a mechanical precondition. It is true when
both retained tables are empty, no external table has an inbound foreign key to
either retained table, and every discovered foreign key is validated.

External outbound dependencies are reported but do not mechanically block
dropping their source table. They still require an explicit export/restore and
schema-disposition decision. A candidate result never authorizes deletion.

The stable blocker values are:

- `retained_rows_require_export_restore` — at least one retained row exists;
- `external_foreign_key_dependencies_require_disposition` — a table outside the
  retained pair references one of the retained tables;
- `unvalidated_foreign_keys_require_repair` — at least one discovered foreign
  key is not validated.

## Contraction gate

Before removing either table or its historical application model:

1. Retain a signed, immutable inventory from the exact candidate database.
2. Define a versioned, tenant-scoped export format with deterministic ordering,
   checksums, encryption, retention, and access controls for every non-empty
   table.
3. Restore the export into an isolated database and compare exact per-table
   counts, reconstructable foreign-key metadata, and the content-free inventory
   fingerprint.
4. Classify every legacy Goal and Goal Progress row. Do not infer that a legacy
   row became a Goal Program without explicit, reviewable conversion evidence.
5. Disposition every inbound and outbound foreign key, every non-FK schema
   dependency, and every downstream application or analytical artifact.
6. Observe at least one verified release with no legacy producer, reader, job,
   schedule, fixture, or reachable UI/server path.
7. Review and rehearse a reversible contraction migration, including rollback
   from the retained export, before applying it to an immutable release.

Until all seven steps have retained evidence, `goals`, `goal_progress`, and the
historical source needed to interpret them remain in place. No inventory result
authorizes deletion by itself.
