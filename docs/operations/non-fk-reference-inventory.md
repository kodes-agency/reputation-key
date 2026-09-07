# Non-foreign-key reference inventory

This inventory closes the gap between PostgreSQL-enforced foreign keys and
application-level identifiers before any contraction slice removes a row.

A foreign key is the only reference PostgreSQL defends. Everything else — a
uuid column declared without `.references()`, a `(resource_type, resource_id)`
pair, a textual aggregate identifier, an identifier embedded in a jsonb
document — survives the row it names. The row disappears in a contraction
slice and the reference silently becomes a lie.

## Declared surfaces

`src/shared/governance/non-fk-reference-surfaces.ts` declares every surface
found by schema inspection, with the schema fact that makes it a surface:

| Surface                                            | Columns                                               | Why                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `team_memberships.team_id`                         | `team_id`                                             | `uuid(...).notNull()` with no `.references()` to `teams.id` (people-access.schema.ts:227) |
| `team_portal_group_scopes.team_id`                 | `team_id`                                             | same shape (people-access.schema.ts:331)                                                  |
| `recent_activity_entries.resource`                 | `resource_type`, `resource_id`                        | unconstrained varchar pair                                                                |
| `recent_activity_entries.payload`                  | `payload`                                             | unconstrained jsonb                                                                       |
| `recent_activity_replay_facts.resource`            | `resource_type`, `resource_id`                        | unconstrained varchar pair                                                                |
| `recent_activity_replay_facts.source_aggregate_id` | `source_aggregate_id`                                 | free text copied from the source event                                                    |
| `recent_activity_replay_facts.transition_payload`  | `transition_payload`                                  | unconstrained jsonb                                                                       |
| `outbox_events.source_aggregate_id`                | `source_context`, `source_aggregate_id`, `event_type` | free text; published rows expire on their own schedule                                    |
| `outbox_events.payload`                            | `payload`                                             | unconstrained jsonb                                                                       |
| `notifications.payload`                            | `payload`                                             | nullable jsonb rendered snapshot                                                          |

Recent Activity resource tokens map to contraction candidates explicitly in
`ACTIVITY_RESOURCE_REFERENTS`. A candidate is never inferred from a vocabulary
token; adding such a mapping is a reviewed contraction decision.

## Coverage rule

Every table classified `bounded_contraction` or `compatibility_read` must be
either reachable by a declared probe or recorded in
`NON_FK_UNREFERENCEABLE_CANDIDATES` with a schema-based reason. Both the
surrogate-identified list and any exemptions are explicit rather than derived,
so a new contraction candidate must join one of them by decision. A candidate
in neither list fails the coverage test.

## Running the scan

```sh
pnpm ops:report-non-fk-references \
  --operator <approved-operator-id> \
  --as-of 2026-08-28T00:00:00.000Z \
  --table teams
```

`--table` may be repeated and must name a contraction candidate. With no
`--table` the scan covers every candidate, which is the slowest form: the
jsonb probes are substring searches over whole documents.

The whole scan runs in one `REPEATABLE READ`, `READ ONLY` transaction and emits
a deterministic SHA-256 fingerprint over the observation time and the counts.

## What the report says, and what it does not

The report carries, per candidate table and per surface: the surface id, its
table, its columns, the probe kind, and a count. It never carries a referenced
identifier value. "42 outbox rows still embed the id of a `teams` row" is the
evidence a deletion slice needs; which ids they are is not.

`non_fk_references_require_disposition` is raised whenever any count is
non-zero. Disposition means one of: rewrite or expire the referencing rows,
accept the dangling reference with a written reason, or stop the slice. A
non-zero count is never resolved by re-running the scan.

The json_document probes over-match by design: they substring-search the
document text. A false positive costs an operator one manual check; a false
negative costs a dangling reference in production.
