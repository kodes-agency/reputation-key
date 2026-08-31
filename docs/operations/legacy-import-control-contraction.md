# Legacy Google import control contraction

`legacy_import_control` is the per-environment switch that closed the v1 Google
import path, and `legacy_import_effect_leases` fenced the workers that still ran
under it. Both remain bounded contraction sources until their data has been
deliberately inventoried, exported, restored, and dispositioned. Their canonical
data-fate classification is Integration-owned `bounded_contraction` under
`GGL-01/CNV-01`.

The three compatibility mirrors in the same schema file — `gbp_cache`,
`gbp_import_jobs` and `gbp_import_legacy_history` — are **not** part of this
inventory. They are `compatibility_read`, reviewed separately, and reported by
`pnpm ops:report-compatibility-read-surfaces`. Folding them in here would imply
the import-control contraction decision already covers them.

## Read-only inventory

`buildLegacyImportControlInventoryReport` and `readLegacyImportControlInventory`
provide the versioned inventory contract. Run the governed operator command with
an explicit observation time and retain its canonical JSON output:

```sh
pnpm ops:report-legacy-import-control \
  --operator <approved-operator-id> \
  --as-of 2026-08-28T00:00:00.000Z
```

The command passes through the standard operator policy/audit harness and is
read-only with respect to product state. Neither the command nor either
inventory function has an apply or removal mode.

Version 1 reads exact row counts for both retained tables and schema-qualified
PostgreSQL foreign-key metadata from every schema whenever either endpoint is
`public.legacy_import_control` or `public.legacy_import_effect_leases`. Counts
and dependencies are read in one `REPEATABLE READ`, `READ ONLY` transaction.
Each dependency records the constraint and endpoint identifiers, ordered source
and target columns, update/delete actions, any delete-action column subset,
match type, deferrability, initial-defer state, and validation state. The
`legacy_import_effect_leases_control_fk` restrict-on-delete constraint between
the two tables is the dependency that forces lease disposition first.

The report is content-free. It emits only fixed data-fate classifications,
schema metadata, counts, blockers, status fields, the explicit observation time,
and a SHA-256 fingerprint. It never selects or emits an environment name, an
operator id, a closure reason, a worker id, a job id, a generation, or a drain
timestamp.

## Report interpretation

`schemaContractionCandidate` is only a mechanical precondition. It is true when
both retained tables are empty, no external table has an inbound foreign key to
either, and every discovered foreign key is validated.

The stable blocker values match the Goal contract:

- `retained_rows_require_export_restore` — at least one retained row exists;
- `external_foreign_key_dependencies_require_disposition` — a table outside the
  retained pair references one of them;
- `unvalidated_foreign_keys_require_repair` — at least one discovered foreign
  key is not validated.

## Contraction gate

Before removing either table:

1. Retain a signed, immutable inventory from the exact candidate database.
2. Prove the v1 import path is closed in every environment: `state = 'closed'`,
   `oauth_state_issuance = 'opaque-v2'`, v1 events drained, and no active lease.
3. Define a versioned export format with deterministic ordering, checksums,
   encryption, retention, and access controls for every non-empty table.
4. Restore the export into an isolated database and compare exact per-table
   counts, foreign-key metadata, and the content-free inventory fingerprint.
5. Disposition the lease-to-control foreign key and every non-FK reference to
   the control environment key — see `docs/operations/non-fk-reference-inventory.md`.
6. Observe at least one verified release with no reader, writer, job, schedule,
   fixture, or reachable server path for either table.
7. Review and rehearse a reversible contraction migration, including rollback
   from the retained export, before applying it to an immutable release.

Until all seven steps have retained evidence, both tables remain in place. No
inventory result authorizes removal by itself.
