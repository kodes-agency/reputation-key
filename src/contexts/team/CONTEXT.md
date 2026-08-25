# Team Context — Quarantined

## Beta posture

Team is not a beta product concept. ADR 0052 supersedes ADR 0013's statement that
Teams remain administrative and supersedes TeamMembership as part of ADR 0039's
canonical beta people model.

There is no Team route, navigation item, UI bundle, built-in role permission, job,
or active event consumer. `team.use` is unconditionally blocked, so retained server
functions fail closed even if a historical/custom permission statement names a Team
action.

PortalGroup is not a replacement name for Team. Portal Groups collect Portals for
reporting and Goals; quarantined Team rows must never be mapped to Portal Groups.

## Why code and data remain

The package retains domain types, tables, repositories, use cases, identifier-only
event schemas, and hard-denied server functions for a bounded migration window.
They provide:

- deterministic inspection of historical Team and membership rows;
- `exact`, `mappable`, `conflict`, `orphan`, and `unsafe` reconciliation evidence;
- a controlled rollback reference until canonical Staff Participation and
  responsibility parity has survived one verified release.

Retention does not authorize new product behavior. No new context may consume the
Team public API or events.

## Retained invariants

- Rows remain Organization- and Property-scoped.
- Historical membership intervals remain half-open and are not erased during
  migration.
- Authorization never derives from Team membership or lead status.
- Ambiguous or unsafe mappings are reported for review, not guessed.
- Team data is preserved through the quarantine/restore window and contracted only
  in a later migration after row-count, foreign-key, retention/export, release, and
  restore proof.

## Retained architecture

```
team/
  domain/              historical Team/membership types, rules, events, errors
  application/         retained use cases and public types; no new consumers
  infrastructure/      repositories plus people/Team reconciliation
  server/              catalogued direct entry points; hard-denied by team.use
  build.ts             retained composition for migration compatibility
```

`team.created`, `team.updated`, and `team.deleted` remain registered historical
event families but have no runtime consumer. They must not be presented as current
Operational Action History coverage.

## Contraction gate

Delete this context only after the ADR 0052 replacement model has full read/write
parity, the reconciliation report has zero unexplained rows, no static or runtime
entry point imports Team, data retention/export decisions are recorded, and one
verified release plus restore proof confirms the old schema is unnecessary.
