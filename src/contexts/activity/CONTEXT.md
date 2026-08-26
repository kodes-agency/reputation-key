# Activity Context

**Audience:** AI agents and developers working in `src/contexts/activity/`.

## Bounded context

Activity owns the privacy-aware **Recent Activity** product feed used by
authorized managers to understand collaboration and workflow changes. It is a
thin subscriber context: source contexts own the durable facts, Activity projects
selected content-minimal summaries, and its server queries expose those summaries
within the caller's current access scope.

Activity is not the security, compliance, or operator audit authority. The
restricted **Operational Action History** required by ADR 0056 is a separate model
and is not implemented by `activity_log`.

## Canonical language

| Term                           | Meaning                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Recent Activity**            | A bounded, user-facing collaboration feed. Entries may be expired, redacted, rebuilt, or tombstoned under its policy.       |
| **Activity entry**             | One projected summary tied to a source event and tenant/resource scope. It is not proof that the source transaction exists. |
| **Operational Action History** | Future restricted history for security-sensitive, provider-effect, authorization, lifecycle, and operator actions.          |
| **Durable Domain Fact**        | Source-context-owned recovery/consumer fact. Activity consumes selected facts but never becomes their authority.            |

Do not describe Activity as immutable, tamper-proof, tamper-evident,
cryptographically verifiable, compliance-grade, or an audit log. A database
unique constraint provides delivery idempotency; it does not provide those
integrity properties.

## Invariants

1. Activity is a rebuildable Recent Activity projection, never an authorization,
   recovery, provider-effect, or Operational Action History authority.
2. Every entry is Organization-scoped; reads apply the caller's current Property
   access and reply-workflow permissions.
3. Projected payloads remain content-minimal and never contain Review text,
   private feedback/contact, Inbox notes, Reply bodies, credentials, tokens,
   presigned links, or raw network identifiers.
4. Re-delivery of one source event is idempotent within its Organization.
5. Missing actor display data is represented as `System` and is not treated as
   verified attribution.

## Events produced

Activity currently produces no cross-context domain events. It consumes selected
source-context facts and projects rebuildable Recent Activity rows.

## Current relationships and behavior

- Every row is Organization-scoped and may carry a Property scope.
- `eventId + organizationId` is unique so at-least-once delivery does not create
  duplicate rows.
- Actor display information is copied at projection time. Failed actor lookup is
  represented as `System`; it must not be treated as verified attribution.
- Queries filter by current Property access and omit reply-workflow rows from
  callers without `reply.manage`.
- Source-context events arrive through the durable event/queue path and are
  projected by `insertActivityLog`.
- Invitation entries are identifier-only; retained or resumed jobs cannot write
  invitation content into `payload.detail`.
- Payloads must never copy review text, private feedback/contact, Inbox notes,
  reply bodies, tokens, credentials, presigned URLs, or raw network identifiers.

## Known incomplete contract

The current implementation still uses legacy names (`ActivityLog`,
`activity_log`, `getOrgActivity`) and a broad historical action/resource
vocabulary. ACT-01 owns the bounded vocabulary, retention and rebuild states,
durable projection receipts, explicit redaction semantics, and the separate
Operational Action History. Until those land, this context must make only the
limited product-feed claims above.

## Architecture

```text
activity/
  domain/          Activity entry types and constructors
  application/     projection use case and public interface
  infrastructure/  repository, durable event handlers, queue job, lookup adapters
  queries/         scoped Recent Activity reads
  server/          authenticated read functions
  build.ts         context-local composition
```

## Public API

| Interface             | Purpose                                                       | Authorization                 |
| --------------------- | ------------------------------------------------------------- | ----------------------------- |
| `insertActivityLog`   | Idempotently project one content-minimal source-event summary | System worker only            |
| `getActivityTimeline` | Read a bounded resource timeline                              | `inbox.read`; scoped at query |
| `getOrgActivity`      | Read a bounded Organization/Property feed                     | `inbox.read`; scoped at query |

The public API exports the legacy `ActivityLog` types and these two reads for
compatibility. New consumers must use Activity only as Recent Activity and must
not use its rows to authorize actions, prove external effects, or recover source
state.

## Verification authority

- Domain construction: `domain/constructors.test.ts`
- Projection and content safety: `application/use-cases/insert-activity-log.test.ts`
  and `infrastructure/event-handlers/activity-content-safety.test.ts`
- Scoped reads: `queries/get-activity-timeline.test.ts` and
  `queries/get-org-activity.test.ts`
- Writer boundary: `src/shared/architecture/context-acceptance-matrix.test.ts`
- Integrity-claim authority: `docs/adr/0056-operational-action-history-integrity-claims.md`
