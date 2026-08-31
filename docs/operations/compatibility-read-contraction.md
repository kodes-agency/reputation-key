# Compatibility-read mirror inventory

Seven tables are classified `compatibility_read`: they stay readable during
replacement parity and may not be removed until the canonical readers, restore
tooling, and historical reconciliation no longer depend on them.

| Physical table              | Drizzle export           | Authority              |
| --------------------------- | ------------------------ | ---------------------- |
| `feedback`                  | `feedback`               | `GST-01/MET-01/CNV-01` |
| `ratings`                   | `ratings`                | `GST-01/MET-01/CNV-01` |
| `scan_events`               | `scanEvents`             | `GST-01/MET-01/CNV-01` |
| `gbp_import_legacy_history` | `gbpImportLegacyHistory` | `GGL-01/CNV-01`        |
| `gbp_cache`                 | `legacyGbpCache`         | `GGL-01/CNV-01`        |
| `gbp_import_jobs`           | `legacyGbpImportJobs`    | `GGL-01/CNV-01`        |
| `portal_group_members`      | `portalGroupMembers`     | `POR-01/PPL-01/CNV-01` |

Three of the Drizzle exports do not match their physical table names. A report,
a migration, or a grep keyed on `legacyGbpCache` touches nothing named
`legacyGbpCache` in PostgreSQL and reads as "already empty". The mapping is
pinned in code and asserted by test.

## Read-only inventory

```sh
pnpm ops:report-compatibility-read-surfaces \
  --operator <approved-operator-id> \
  --as-of 2026-08-28T00:00:00.000Z
```

The command passes through the standard operator policy/audit harness and is
read-only with respect to product state. It has no apply or removal mode.

The report emits, per mirror: the physical and Drizzle names, the fixed
data-fate classification, the owning authority, the exact row count, and the
`activeReaderCount` sourced from a static reader registry of the production
modules that still query that mirror. Foreign keys touching any mirror are read
in the same `REPEATABLE READ`, `READ ONLY` transaction. The artifact also
carries the Integration-owned `gbpCompatibility` section, which restates the
physical/export mapping and the replacement schema for the three Google import
mirrors.

The report is content-free. It never selects a rating value, feedback text, a
scan session identifier, a cached provider payload, a place id, or an import
initiator. The only free-form identifiers it carries are table, constraint, and
foreign-key column names reported by PostgreSQL itself.

## Removal stays blocked

`schemaContractionCandidate` is **always false** for these tables, even when
every table is empty and every foreign key is validated. The blocker
`compatibility_read_removal_requires_verified_release_and_restore_proof` is
unconditional: it encodes the rule, not an observation. One verified release
plus a restore proof is not something a database snapshot can see.

The remaining blockers are observations that add to it:

- `retained_rows_require_export_restore` — at least one mirror holds rows;
- `active_readers_require_replacement_parity` — at least one production module
  still reads a mirror;
- `external_foreign_key_dependencies_require_disposition` — a non-mirror table
  references a mirror;
- `unvalidated_foreign_keys_require_repair` — a discovered foreign key is not
  validated.

At the time of writing, the three Google import mirrors have zero registered
readers while the guest and portal mirrors still have readers. Zero readers is
evidence, not permission: the block is the verified-release and restore-proof
rule.

## Lifting the block

For each mirror, in order:

1. Retain a signed, immutable inventory from the exact candidate database.
2. Prove replacement parity: every question the mirror answers is answered by
   the canonical model, with reviewable evidence rather than an assertion.
3. Remove the last registered reader and re-run the inventory so
   `activeReaderCount` is zero in a retained artifact.
4. Observe at least one verified release in which no reader, writer, job,
   schedule, fixture, or reachable route touches the mirror.
5. Produce a restore proof: export, restore into an isolated database, and
   compare counts, foreign-key metadata, and the inventory fingerprint.
6. Disposition every non-FK reference — see
   `docs/operations/non-fk-reference-inventory.md`.
7. Only then review a reversible contraction migration.

No inventory result authorizes removal by itself.
