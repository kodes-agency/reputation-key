# Legacy People/Team contraction

The historical combined Staff Assignment and Team models are not beta product
authorities. Canonical people access is Staff Participation plus explicit Portal
Responsibility. Team is not another name for Portal Group, and no retained Team
row may be translated into a Portal Group or used for authorization.

The five retained tables remain temporarily so their rows and constraints can
be inventoried, exported, restored, and deliberately dispositioned:

- `staff_assignments` — the earlier combined Staff/access record;
- `property_access_grants` — the retired plural access-grant model;
- `teams` — the retired Team aggregate;
- `team_memberships` — retired membership intervals;
- `team_portal_group_scopes` — retired Team-to-Portal-Group scopes.

All five have data-fate disposition `bounded_contraction` and authority
`PPL-01/CNV-01`. Staff owns the retired assignment and Team rows; Identity owns
the retired plural access-grant rows. The executable inventory guard proves
that this list matches the governed contraction authority exactly. Identity's
singular `property_access_grant` is the active Property-access authority and is
intentionally not part of this contraction set.

Production composition does not construct or expose the retained
`StaffAssignmentRepository` or its legacy membership adapter. Those source files
remain available only for reconciliation, isolated tests, and controlled
rollback analysis; their continued presence is not runtime reachability.

## Read-only inventory

Run the report with an explicit observation time:

```text
pnpm ops:report-legacy-people-team \
  --operator <registered-operator> \
  --as-of <ISO-8601>
```

The command has no `--apply` mode. Inventory version 2 reads exact counts for
the five retained tables and reconstructable, schema-qualified PostgreSQL
foreign-key metadata in every schema whenever either endpoint is a retained
table. Counts and foreign keys are read in one `REPEATABLE READ`, `READ ONLY`
transaction, so the SHA-256 fingerprint describes one coherent snapshot.

Output contains only fixed classifications; schema, table, constraint, and
ordered source/target column names; delete/update actions; match type;
deferrable/initially-deferred/validation flags; counts; blockers; and the
fingerprint. That tuple is sufficient to reconstruct each discovered foreign
key, including composite and `NOT VALID` constraints. It does not select or
print row identifiers, Organization, Property, user, membership, Team-name, or
free-text values.

This report complements `ops:report-people-authority`: the people-authority
report proves record-level replacement parity and classifies exact, mappable,
conflict, orphan, and unsafe legacy rows. The contraction report proves the
bounded table set, exact row counts, and every inbound/outbound foreign key.
Neither report authorizes deletion.

The report deliberately does not claim a complete non-FK dependency graph.
Before contraction, separately inventory triggers, functions, indexes, check /
exclusion constraints, views, and grants. Known retained examples include the
`staff_assignments` permission-version trigger and Team exclusion constraints
from `0020_people-team-expansion.sql`.

A fresh migration bootstrap currently reports six deliberately `NOT VALID`
tenant-scope constraints installed by migration `0020_people-team-expansion`:
`pag_property_tenant_fk`, `teams_property_tenant_fk`, `tm_team_tenant_fk`,
`tm_participation_tenant_fk`, `tpgs_team_tenant_fk`, and
`tpgs_portal_group_tenant_fk`. That is a real contraction blocker, not an
inventory failure. Existing environment rows must be reconciled before a
separately reviewed migration validates those constraints.

## Deletion gate

`schemaContractionCandidate` is only a mechanical precondition. It becomes true
when every retained table is empty, no external table has an inbound foreign key
to a retained table, and every discovered foreign key is validated. Outbound
dependencies are still reported for deliberate disposition, but do not
mechanically prevent dropping their source table.

Before any code or schema contraction:

1. Retain a signed inventory from the immutable candidate database.
2. Reach zero unexplained rows in the people-authority reconciliation. Never
   guess an ambiguous Staff, Team, membership, or scope mapping.
3. Define a versioned, tenant-scoped, encrypted export with deterministic
   ordering and checksums for every non-empty retained table.
4. Restore that export into an isolated database and compare per-table counts,
   reconstructable foreign-key metadata, and the content-free inventory
   fingerprint.
5. Disposition every inbound and outbound foreign key, every non-FK schema
   dependency, and every downstream archive, report, test fixture, and rollback
   dependency.
6. Observe at least one verified release with no Team route, server function,
   build, consumer, producer, job, schedule, seed, or authorization dependency.
7. Review a separate reversible schema migration; do not combine the migration
   with the evidence-gathering command.

Until all seven steps have retained evidence, the tables and historical source
stay quarantined. A future product feature must use its own approved model; it
must not reactivate Team or map Team membership into Portal Groups.
