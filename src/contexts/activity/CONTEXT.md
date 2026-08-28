# Activity Context

**Audience:** AI agents and developers working in `src/contexts/activity/`.

## Bounded context

Activity owns the privacy-aware **Recent Activity** product feed used by
authorized managers to understand collaboration and workflow changes. It is a
thin subscriber context: source contexts own the durable facts, Activity projects
selected content-minimal summaries, and its server queries expose those summaries
within the caller's current access scope.

Activity also owns the separate, restricted **Operational Action History**
required by ADR 0056. It is not `recent_activity_entries`, is never exposed as the product
feed, and provides ordinary append-oriented database defenses and gap evidence —
not cryptographic integrity, immutable audit, or compliance certification.

## Canonical language

| Term                           | Meaning                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recent Activity**            | A bounded, user-facing collaboration feed. Entries may be expired, redacted, rebuilt, or tombstoned under its policy.                                 |
| **Recent Activity entry**      | One projected summary tied to a source event and tenant/resource scope. It is not proof that the source transaction exists.                           |
| **Operational Action History** | Restricted identifier-only history for an explicit vocabulary of security-sensitive, provider-effect, authorization, lifecycle, and operator actions. |
| **Durable Domain Fact**        | Source-context-owned recovery/consumer fact. Activity consumes selected facts but never becomes their authority.                                      |

Do not describe Activity as immutable, tamper-proof, tamper-evident,
cryptographically verifiable, compliance-grade, or an audit log. A database
unique constraint provides delivery idempotency; it does not provide those
integrity properties.

## Invariants

1. Recent Activity is a rebuildable projection, never an authorization,
   recovery, provider-effect, or Operational Action History authority.
2. Every entry is Organization-scoped; reads apply the caller's current Property
   access and reply-workflow permissions.
3. Projected payloads remain content-minimal and never contain Review text,
   private feedback/contact, Inbox notes, Reply bodies, credentials, tokens,
   presigned links, or raw network identifiers.
4. Re-delivery of one source event is idempotent within its Organization.
5. Missing actor display data is represented as `System` and is not treated as
   verified attribution. An explicitly anonymized actor is represented as
   `Former member`; neither label may be used as identity evidence.
6. New projections accept only the exact action/resource pairs in
   `RECENT_ACTIVITY_KINDS`. Wider historical enum values remain read-compatible
   during reconciliation but cannot be written by the constructor.
7. Projection, Activity-owned replay capture, and the shared consumer receipt
   commit together. A conflicting redelivery fails closed.
8. Replay facts contain identifiers and allowlisted transition codes only;
   actor names/avatars, Property or Organization names, archive/rejection
   reasons, and source content are reloaded or omitted rather than retained.
9. Actor-label redaction updates the projection and replay authority and creates
   a content-free, expiring tenant/subject fence. Delayed delivery and rebuilds
   must honor that fence and cannot restore the prior name or avatar. Recent
   Activity stores no resource display labels by construction.
10. Operational Action History accepts only `OPERATIONAL_ACTION_KINDS`, exact
    source provenance, tenant/resource/actor identifiers, outcomes, and reason
    codes. It has no generic payload/details column and never copies source
    content or raw network data.
11. Operational Action History reads and exports require a current AccountAdmin
    authority verdict; a session role alone is insufficient. Access attempts are
    written through the same append authority before data is returned.
12. Tenant-local sequence coverage is readiness evidence only. A gap or store
    failure is `Unavailable`; heads advance exactly one sequence at a time and
    cannot be deleted/truncated; no repair is inferred from Recent Activity.
13. Core action rows reject update/delete/truncate. The only permitted record
    update is one-way actor/resource identifier redaction outside an active
    legal hold. Legal-hold rows permit only a one-time explicit release.

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
  callers without `reply.manage`. Organization-wide feed access comes only
  from `inbox.read`'s effective data scope; `organization.update` never widens
  a PropertyManager beyond assigned Properties. Entries without a Property
  scope require Organization-wide read authority and are not returned to an
  assigned-Property reader.
- Source-context events arrive through the durable outbox/queue path. The
  in-process EventBus-to-BullMQ path remains only a low-latency acceleration;
  the durable consumer is the recovery authority and repairs a bus-first row.
- `recent_activity_replay_facts` retains the minimum mapped projection input,
  original source event identity/version, and source occurrence time. It has no
  foreign key to the 30-day outbox lifecycle, so an empty retained projection
  can be rebuilt throughout the full 90-day feed window.
- `recent_activity_actor_label_redactions` is a content-free privacy fence for
  one Organization and opaque actor subject. A bounded redaction replaces the
  projected actor with `Former member`, clears the avatar, marks replay facts,
  and prevents a delayed durable fact or rebuild from restoring those labels.
  The fence expires only after its 90-day protection window; the owning account
  lifecycle must invoke the internal use case and continue while `remaining` is
  true. No resource display labels are persisted in this context.
- Property archive/restore facts project state transitions but never the
  manager-authored archive reason.
- Portal publication, rollback, archive, restore, and Health facts project only
  allowlisted lifecycle/status codes. Snapshot identifiers, digests, source
  versions, and guest-facing configuration never enter the feed payload.
- Canonical Goal monthly-result close, reconciliation, and revision facts
  project only the result identifier, evaluation/outcome codes, and Property
  scope. Goal metric values and revision lineage remain in the owning context.
- Invitation entries are identifier-only; retained or resumed jobs cannot write
  invitation content into `payload.detail`.
- The shared bounded sweep expires both the replay authority and
  `recent_activity_entries` from the same source-occurrence clock after exactly 90 days,
  with ordinary `retention_runs` evidence. This product-feed retention is
  independent from source domain facts and restricted operational records.
- Recovery processes at most 100 facts per call, stops without advancing past
  a failed fact, and is idempotent after interruption. Readiness is `Ready`
  when every retained replay fact has a projection, `Updating` while the oldest
  gap is within five minutes, and `Unavailable` after that target or when the
  authority store cannot be read. It is projection readiness, not audit proof.
- Payloads must never copy review text, private feedback/contact, Inbox notes,
  reply bodies, tokens, credentials, presigned URLs, or raw network identifiers.
- `operational_action_history_records`, its tenant-local sequence head, and
  legal-hold rows are separate from `recent_activity_entries` and
  `recent_activity_replay_facts`. Appends, access records, lifecycle records,
  and sequence-head advancement commit atomically.
- Restricted pages use a bounded keyset (`occurredAt`, tenant sequence) with a
  maximum of 100 rows. Identifier-only canonical exports are capped at 500 rows
  and bind the tenant/filter scope plus observation time into their
  reproducibility fingerprint; that fingerprint is not record integrity or
  tamper evidence.
- Legal holds block identifier redaction for the covered occurrence interval.
  Redaction is one-way and bounded to 100 rows. Migration 0149 prevents direct
  core rewrites and keeps hold placement/release evidence append-oriented.
- The proposed 365-day Operational Action History horizon is currently
  assessment-only (`report_only_pending_counsel`). The repository has no
  destructive apply path; counsel approval, deployed least-privilege evidence,
  and restore/export verification are still required before one may be added.
- The legacy `audit_logs` table remains a separate recoverable archive used by
  legacy Goal code. It is not backfilled into or treated as canonical
  Operational Action History because its provenance/content cannot be inferred.

## Known incomplete contract

Production code and the public interface now use only `RecentActivityEntry` and
`createRecentActivityEntry`; the deprecated domain aliases have been removed.
Migration 0160 makes `recent_activity_entries`, `project-recent-activity`, and
`listRecentActivity` canonical across schema, repository, worker, query, server,
catalogues, and active documentation. Its automatically updatable
`activity_log` view exists only for bounded old-binary rollback compatibility;
the legacy `insert-activity-log` handler is registered only to drain work queued
before cutover and is never an enqueue authority. Broader
historical enum values remain read-compatible while new writes are bounded by
`RECENT_ACTIVITY_KINDS`. Migration 0146 captures a minimized, explicitly
labelled legacy projection baseline without inventing missing event
type/version provenance. Migration 0155 and the internal bounded privacy use
case implement actor-label redaction and a delayed-delivery/rebuild fence;
Recent Activity persists no resource labels to redact. The product-wide account
anonymization/offboarding workflow that invokes this seam remains owned by
LIF-01 and is not inferred from ordinary membership removal. The curated Portal
publication/Health and canonical Goal monthly-result lifecycle families are
wired through the durable projection and replay authority.
Operational Action History now has a separate canonical record contract,
PostgreSQL authority, restricted application/public seam, catalogued
authenticated list/export server boundaries, legal holds, identifier redaction,
content-free export, and readiness report. Production composition injects
Identity's current AccountAdmin authority, and the durable Property
archive/restore/delete, Portal publish/archive, member-role change, and Google
connection/disconnection and provider-confirmed Google reply publication facts
feed the history through Activity's registered consumer. The consumer preserves
the exact source event identity and actor only when the source fact carries one;
actorless delete/disconnect facts are recorded honestly as system actions. The
Merchant AI capability, approved-destination policy, and hero-completion upload
facts also feed their matching content-free action kinds. Authentication,
authorization, Property-access, sensitive-data access/export, privacy,
moderation, and operator-command families are not yet wired. The proposed
365-day destructive lifecycle remains blocked pending counsel. Until those gaps
close, no complete production-coverage or deletion claim may be made.

Historical action/resource reconciliation is deliberately internal and
report-first. A report groups one Organization's rows by the two codes and emits
counts plus exact target fingerprints—never row IDs, actor/resource identifiers,
or payloads. Unknown pairs are labelled `unmappable`; no destination is guessed.
Apply requires a separately injected authority verdict, an explicit reviewed
source-to-canonical mapping and evidence reference, and an unchanged fingerprint
under the Organization advisory lock. The rewrite and content-minimal receipt
commit together. Production injects no apply authority, so the seam fails closed
until a later operator workflow is approved.

## Architecture

```text
activity/
  domain/          Recent Activity entry types and constructors
  application/     projection, restricted history use cases, and public interface
  ports/           Operational Action History persistence boundary
  infrastructure/  projection/recovery stores, history authority, handlers, jobs, adapters
  queries/         scoped Recent Activity reads
  server/          authenticated read functions
  build.ts         context-local composition
```

## Public API

| Interface                                         | Purpose                                                                               | Authorization                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------- |
| `projectRecentActivity`                           | Idempotently project one content-minimal source-event summary                         | System worker only            |
| `getActivityTimeline`                             | Read a bounded resource timeline                                                      | `inbox.read`; scoped at query |
| `listRecentActivity`                              | Read a bounded Organization/Property feed                                             | `inbox.read`; scoped at query |
| `recoverRecentActivity`                           | Rebuild at most 100 missing retained entries from Activity-owned replay facts         | System/operator only          |
| `getRecentActivityReadiness`                      | Return content-free Ready/Updating/Unavailable projection state                       | System/operator only          |
| `redactRecentActivityActorLabels`                 | Boundedly replace one anonymized actor's labels and install a delayed-delivery fence  | Restricted lifecycle only     |
| `listOperationalActionHistory`                    | Read one tenant-forced, keyset-bounded restricted page                                | Current AccountAdmin only     |
| `exportOperationalActionHistory`                  | Export at most 500 identifier-only rows with a reproducibility fingerprint            | Current AccountAdmin only     |
| `appendOperationalAction`                         | Append one explicit action/provenance fact and advance its tenant sequence atomically | Trusted context/worker only   |
| Operational history lifecycle/readiness use cases | Assess the proposed horizon, manage holds/redaction, and report gaps                  | Restricted operator only      |
| Recent Activity vocabulary report/apply           | Report historical code groups; apply one exact reviewed mapping                       | Internal; apply defaults deny |

`application/public-api.ts` exports the `ActivityPublicApi` facade carrying the
two manager Recent Activity reads and the restricted history list/export seam,
plus the read vocabulary it returns: `RecentActivityEntry`, `ActivityAction`,
`ActivityPayload`, and `ResourceType`. Recovery, append, lifecycle, and
readiness remain worker/operator-internal and are deliberately absent from the
facade. Consumers must never use Recent Activity rows to authorize actions,
prove external effects, or reconstruct Operational Action History.

## Verification authority

- Domain construction: `domain/constructors.test.ts`
- Projection and content safety: `application/use-cases/project-recent-activity.test.ts`
  and `infrastructure/event-handlers/activity-content-safety.test.ts`
- Durable capture/fault/rebuild: `infrastructure/activity-delivery-store.integration.test.ts`,
  `infrastructure/activity-recovery-store.integration.test.ts`, and
  `application/use-cases/recover-recent-activity.test.ts`
- Actor-label privacy and late-delivery/rebuild fencing:
  `application/use-cases/redact-recent-activity-actor-labels.test.ts`,
  `infrastructure/recent-activity-privacy-store.integration.test.ts`, and
  `src/shared/db/recent-activity-actor-redaction-migration.test.ts`
- Scoped reads: `queries/get-activity-timeline.test.ts` and
  `queries/list-recent-activity.test.ts`
- Writer boundary: `src/shared/architecture/context-acceptance-matrix.test.ts`
- Integrity-claim authority: `docs/adr/0056-operational-action-history-integrity-claims.md`
- No-hash/no-false-history regression: `domain/integrity-claims.test.ts`
- Operational record/access/lifecycle contracts:
  `domain/operational-action-history.test.ts`,
  `application/use-cases/operational-action-history-access.test.ts`, and
  `application/use-cases/operational-action-history-lifecycle.test.ts`
- Fresh PostgreSQL append/fault/pagination/hold/redaction/assessment/readiness:
  `infrastructure/operational-action-history-store.integration.test.ts`
- Migration guard: `src/shared/db/operational-action-history-migration.test.ts`
- Identifier/rolling compatibility:
  `recent-activity-identifiers.test.ts`,
  `src/shared/db/recent-activity-identifiers-migration.test.ts`, and its matching
  real-PostgreSQL migration test
- Vocabulary report, authorization, tenant isolation, stale-target,
  concurrency, and interruption:
  `application/recent-activity-vocabulary-invocation.test.ts`,
  `application/use-cases/reconcile-recent-activity-vocabulary.test.ts` and
  `infrastructure/recent-activity-vocabulary-reconciliation.store.integration.test.ts`.
  Production apply is reachable only through the report-first, ticketed,
  typed-confirmation `ops:reconcile-recent-activity-vocabulary` command; normal
  composition retains the default-deny authority.
