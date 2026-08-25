# Team Context — Quarantined

## Bounded context

Team retains historical Team and TeamMembership data solely for bounded
reconciliation and rollback. It has no beta product responsibility. ADR 0052
supersedes ADR 0013's statement that Teams remain administrative and supersedes
TeamMembership as part of ADR 0039's canonical beta people model.

PortalGroup is not a replacement name for Team. Portal Groups collect Portals for
reporting and Goals; quarantined Team rows must never be mapped to Portal Groups.

## Invariants

- There is no Team route, navigation item, UI bundle, built-in role permission,
  job, or active event consumer.
- Every catalogued direct server entry point fails closed behind the
  unconditionally blocked `team.use` capability before retained data can be read or
  changed.
- Rows remain Organization- and Property-scoped.
- Historical membership intervals remain half-open and are not erased during
  migration.
- Authorization never derives from Team membership or lead status.
- Ambiguous or unsafe mappings are reported for review, not guessed.
- Team data is preserved through the quarantine/restore window and contracted only
  in a later migration after row-count, foreign-key, retention/export, release, and
  restore proof.

## Events produced

These historical schemas remain registered, but the Team capability is hard-denied
and there is no active runtime consumer.

| `_tag`         | Payload fields                                                                             | When emitted by retained code |
| -------------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| `team.created` | `eventId`, `teamId`, `organizationId`, `propertyId`, `name`, `occurredAt`, `correlationId` | Team creation                 |
| `team.updated` | `eventId`, `teamId`, `organizationId`, `propertyId`, `name`, `occurredAt`, `correlationId` | Team name/update              |
| `team.deleted` | `eventId`, `teamId`, `organizationId`, `propertyId`, `occurredAt`, `correlationId`         | Team soft-delete              |

The creation and update payloads contain the historical Team name and therefore
are not identifier-only. They must not be presented as current Operational Action
History coverage.

## Public API

Team exposes no active cross-context beta API. `build.ts` returns an empty
`publicApi`; retained use cases/repositories are composition-internal migration
code, and `application/public-api.ts` is a historical type/event barrel that must
not gain a new consumer during quarantine.

## Why code and data remain

The package retains domain types, tables, repositories, use cases, event schemas,
and hard-denied server functions for a bounded migration window. They provide:

- deterministic inspection of historical Team and membership rows;
- `exact`, `mappable`, `conflict`, `orphan`, and `unsafe` reconciliation evidence;
- a controlled rollback reference until canonical Staff Participation and
  responsibility parity has survived one verified release.

Retention does not authorize new product behavior. No new context may consume the
Team public API or events.

## Retained architecture

```
team/
  domain/              historical Team/membership types, rules, events, errors
  application/         retained use cases and public types; no new consumers
  infrastructure/      repositories plus people/Team reconciliation
  server/              catalogued direct entry points; hard-denied by team.use
  build.ts             retained composition for migration compatibility
```

## Contraction gate

Delete this context only after the ADR 0052 replacement model has full read/write
parity, the reconciliation report has zero unexplained rows, no static or runtime
entry point imports Team, data retention/export decisions are recorded, and one
verified release plus restore proof confirms the old schema is unnecessary.
