# Team Context — Quarantined

## Bounded context

Team retains historical Team and TeamMembership data solely for bounded
reconciliation and rollback. It has no beta product responsibility. ADR 0052
supersedes ADR 0013's statement that Teams remain administrative and supersedes
TeamMembership as part of ADR 0039's canonical beta people model.

PortalGroup is not a replacement name for Team. Portal Groups collect Portals for
reporting and Goals; quarantined Team rows must never be mapped to Portal Groups.

## Invariants

- There is no Team route, navigation item, UI bundle, network/server function,
  production composition wiring, job, schedule, or event consumer.
- `build.ts` is an inert inventory boundary. It constructs no repository or use
  case and production composition does not call it.
- The unconditionally blocked `team.use` capability remains as a tombstone for
  stale persisted policy/configuration and cannot make retained code reachable.
- Rows remain Organization- and Property-scoped.
- Historical membership intervals remain half-open and are not erased during
  migration.
- Authorization never derives from Team membership or lead status.
- Ambiguous or unsafe mappings are reported for review, not guessed.
- Team data is preserved through the quarantine/restore window and contracted only
  in a later migration after row-count, foreign-key, retention/export, release, and
  restore proof.

## Events produced

These historical schemas and constructors remain registered so retained events can
still be interpreted during restore/reconciliation. There is no current production
producer, outbox recording promise, or consumer.

| `_tag`         | Payload fields                                                                             | Runtime posture                       |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| `team.created` | `eventId`, `teamId`, `organizationId`, `propertyId`, `name`, `occurredAt`, `correlationId` | Historical schema; no active producer |
| `team.updated` | `eventId`, `teamId`, `organizationId`, `propertyId`, `name`, `occurredAt`, `correlationId` | Historical schema; no active producer |
| `team.deleted` | `eventId`, `teamId`, `organizationId`, `propertyId`, `occurredAt`, `correlationId`         | Historical schema; no active producer |

The creation and update payloads contain the historical Team name and therefore
are not identifier-only. They must not be presented as current Operational Action
History coverage.

## Public API

Team exposes no active cross-context beta API. `build.ts` returns an empty
`publicApi` and empty internal groups without constructing retained code.
`application/public-api.ts` is a historical type/event barrel that must not gain a
new consumer during quarantine.

## Why code and data remain

The package retains domain types, tables, repositories, legacy application source,
and event schemas for a bounded migration window. They provide:

- deterministic inspection of historical Team and membership rows;
- `exact`, `mappable`, `conflict`, `orphan`, and `unsafe` reconciliation evidence;
- a controlled rollback reference until canonical Staff Participation and
  responsibility parity has survived one verified release.

Retention does not authorize new product behavior. No production module may import
Team behavior; the architecture acceptance test permits only the master event union
type import plus explicitly catalogued operator/release reconciliation commands.

## Retained architecture

```
team/
  domain/              historical Team/membership types, rules, events, errors
  application/         retained legacy source and public types; never composed
  infrastructure/      repositories plus people/Team reconciliation
  build.ts             inert empty inventory boundary; not called in production
```

The former `server/` network surface has been removed. Reconciliation remains
reachable only through the separately catalogued operator/release commands, which
use the retained repository directly and do not expose tenant-facing Team actions.

## Contraction gate

Delete this context only after the ADR 0052 replacement model has full read/write
parity, the reconciliation report has zero unexplained rows, no static or runtime
entry point imports Team, data retention/export decisions are recorded, and one
verified release plus restore proof confirms the old schema is unnecessary.

The read-only `ops:report-legacy-people-team` command owns exact counts and
reconstructable metadata for every schema-qualified inbound/outbound foreign key
for the five mixed Identity/Staff `PPL-01/CNV-01` bounded-contraction tables. It
shares one repeatable-read, read-only snapshot and emits content-free evidence
only. The older plural
`property_access_grants` lifecycle is Identity-owned; the singular
`property_access_grant` remains active Identity authority. The report's mechanical
candidate flag never authorizes deletion; the complete export/restore and
reversible-deletion gate is documented in
`docs/operations/legacy-people-team-contraction.md`.

## Verification authority

- Runtime and build darkness:
  `src/shared/architecture/legacy-recognition-active-surfaces.test.ts`
- Capability, consumer, job, and schedule darkness:
  `src/shared/auth/dark-capability-enforcement.test.ts`,
  `src/shared/auth/dark-context-matrix.test.ts`, and
  `src/shared/architecture/dark-consumer-gating.test.ts`
- Content-free table/FK inventory:
  `application/legacy-people-team-inventory.test.ts` and
  `infrastructure/legacy-people-team-inventory.repository.integration.test.ts`
- Reconciliation and contraction procedure:
  `docs/operations/people-authority-reconciliation.md` and
  `docs/operations/legacy-people-team-contraction.md`
