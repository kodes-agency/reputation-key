# Review Context

## Bounded context

Stable external-review identity, provider observation/content lifecycle, and
RepKey-owned reply workflow. Provider-controlled content is a bounded cache; it
is not the identity or history authority.

## Glossary

- **Review** — Stable RepKey identity for one provider review. It survives provider deletion and source-content expiry so Replies and manager handling history keep a valid reference.
- **Review Source Content** — Separately erasable provider-controlled fields (provider identifiers, rating, text, reviewer presentation, provider timestamps) for the currently observed revision.
- **Review Source Observation** — Immutable sequence identity for each accepted provider fetch, linked to the Material Review Revision it observed. Provider-controlled values can be erased while its timing, digests, comparison result, and relationship remain.
- **Material Review Revision** — Numbered business revision for original rating and normalized original guest text. Provider metadata, translation, profile-photo, and observation-time changes stay on the current material revision.
- **Response Target Provenance** — Immutable content-free eligibility and source timing stored on each Material Review Revision. Ongoing initial revisions use Google's source-created/reviewed time; ongoing material changes use source-updated/accepting-observation time. Onboarding history and legacy-unknown revisions deliberately carry no target start.
- **Rating** — 1–5 star value on a Review. NOT the same as Guest Rating (guest context, private, via QR).
- **Feedback** — Private text comment from a portal visitor (guest context). Never appears here.
- **Reply** — A manager-owned response to a Review. `internal` is authoritative; the legacy `google_sync` source remains schema-compatible but is removed whenever governed Google observation truth is recorded, so it cannot become a second provider-truth store.
- **AI Suggestion Adoption** — Explicit manager action that verifies signed AI provenance and atomically rechecks the current Material Review Revision, reply-state revision, authorization, expiry and Portal-owned Brand Profile binding before creating or replacing an editable Review-owned draft. Review receives a boolean Brand-current answer and never queries Portal tables.
- **Reply Lifecycle** — `draft` → `pending_approval` → `approved` → provider write states → `published`. Provider acknowledgement enters `pending_observation`; only a later exact current Google observation reaches `published`. Terminal/ambiguous outcomes may enter `publish_failed`; rejected replies can be re-drafted. Only PM+ roles can manage replies; Staff cannot view or manage replies.
- **Publication Authorization** — Immutable evidence for one Reply publication cycle, including the named manager who authorized it and the exact tenant, Property, Review/material revision, provider-observation head, Reply revision, and normalized reply digest. The named manager's current authority is revalidated before dispatch.
- **Publication Attempt** — Immutable numbered evidence for one Reply publication cycle, binding tenant, property, Review, source epoch, Material Review Revision, authorized Reply state revision, expected normalized digest, provider operation/correlation IDs, outcome, and (when confirmed) one exact Google Reply Observation.
- **Google Reply Observation** — Append-only Review-owned provider-reply fact (`live` or `absent`) from a provider snapshot or targeted reconciliation. One exact history row is the current head. It records add/edit/delete/unchanged, provenance, normalized content digest, lifecycle clocks, and an optional exact Publication Attempt match.
- **Pending Observation** — A provider write was acknowledged, but no current Google read has yet proved the authorized reply is live. It is not published truth.
- **Reply Audit Fields** — `approvedBy`, `rejectedBy` (UserId), `rejectionReason` (optional text), and `aiGenerated`/signed origin fields for explicitly adopted AI-assisted drafts.
- **authorId** — Original reply author (distinct from `userId` who performed the action). Present on all reply events.
- **source** — Event attribution: `'web'` for manager-owned workflow actions and `'import'` only for legacy provider-mirror compatibility. Present on applicable reply lifecycle facts.
- **Platform** — External review source. Currently only `'google'`. The `reviewPlatformEnum` is closed.
- **External ID** — Erasable Google identifier used only while source content is active. A protected HMAC subject mapping reconnects a later observation to the stable Review ID.
- **Content Expires At** — Fetch-based provider-content deadline. It is refreshed only by a valid provider observation and is never derived from the public review date.
- **Verified Google Reputation Snapshot** — A content-minimal Property aggregate (`reviewCount`, provider `averageRating`, source epoch, run identity, and verification time) recorded only after one bounded provider run completes the main scan, a confirmation scan, and Review-owned missing-source reconciliation without aggregate drift.

## Relationships

- **Review → Property** (N:1 via `propertyId`) — Every review belongs to exactly one property.
- **Review → Reply** (1:N via `reviewId`) — A review can have up to one `google_sync` reply and one `internal` reply (enforced by unique constraint).
- **Reply → Publication Attempt** (1:N per publication cycle) — every attempt is tenant/property/Review/Reply/revision fenced; confirmation points to the exact observation revision.
- **Review → Google Reply Observation** (1:N history, 1:1 head) — duplicated head fields are relationally bound to one exact observation row, and a claimed RepKey match binds to one exact Publication Attempt.
- **Cross-context** — Review listens to `property.created` to enqueue a `sync-property-reviews` job via `ReviewQueuePort.addSyncJob`. A terminal Verified Google Reputation Snapshot is published as a Review-owned durable fact; Metric may project it, but cannot infer or manufacture provider truth. Inbox may snapshot current Response Target provenance only through Review's content-free exact-current callback authority while Review retains its source fence.

## Invariants

- Period-serving reads use half-open business-time bounds (`start <= reviewedAt < end`) so adjacent Dashboard periods are contiguous and never double-count a boundary review.
- Active source content has one `(platform, external_id, organization_id)` identity. The compatibility Review value becomes null after erasure; the HMAC mapping preserves stable re-observation identity without retaining the provider ID there.
- Each accepted provider fetch has a monotonically increasing observation sequence and a replay-safe observation key. A replay creates neither another observation nor another event; an older provider version is retained as `out_of_order_ignored` and cannot replace the current Review.
- Material comparison uses `review-material-v1`: NFC-normalize the original guest text, collapse Unicode whitespace to one ASCII space, trim, and represent an empty result as null. Case and punctuation remain significant. Only rating or this normalized text can advance `sourceRevision`/Material Review Revision.
- A normalization-version transition first compares the old content under the new version. It adopts a matching baseline without manufacturing an edit; an erased, incomparable legacy baseline preserves its last revision.
- Every Material Review Revision stores its immutable Response Target eligibility and optional start instant. `measured` requires a valid start; `historical_onboarding` and `legacy_unknown` require null. Operational manual/deletion reopens do not rewrite this Review-owned source fact: Inbox records its own live reopen instant on the new Handling Cycle target.
- `google_sync` reply: at most one per review per org (unique on `(review_id, source, organization_id)`).
- `internal` reply: at most one per review per org (same unique constraint, different source value).
- Rating is always 1–5 (`StarRating` union type). DB stores as integer — adapter validates via `STAR_RATING_MAP`.
- Serving reads deny provider content at its fetch-based hard expiry. REV-01 expand storage writes `review_source_contents`, `review_source_observations`, and `material_review_revisions` with the stable Review in one transaction. Confirmed deletion/expiry removes the current cache and redacts provider-controlled values from retained observations/revisions while preserving their controls, the stable Review, and manager-owned Replies/history. Recurring activation remains quarantined until the external shadow-parity/cutover audit is complete.
- Provider-subject HMAC mappings, not erased Google identifiers, reconnect a re-observation to the same stable Review ID. A collision fails closed.
- Reply text limited to 4096 characters (`MAX_REPLY_LENGTH`).
- AI provider output is not a Reply. Only explicit adoption may create a draft,
  and its transaction preserves all existing source/material/reply-state fences.
  A changed grounded Brand Profile invalidates the pending AI operation and
  creates no draft; legacy provenance verification remains compatible.
- Every publish authorization advances an explicit, monotonically increasing `publicationCycle`. The reply state and that cycle's identifier-only `review.reply.publication_requested` intent are committed in one PostgreSQL transaction. Queue jobs carry the same cycle, and both the recovery consumer and publish worker reject an older cycle so a delayed fact can never admit or acknowledge newer work.
- The authorizing manager and authorization tuple are immutable on the cycle. PostgreSQL ALWAYS triggers reject authorization UPDATE, DELETE, and TRUNCATE, independently of application code. Authorization and provider-attempt claim each re-resolve that named user through Identity's current membership, effective `reply.manage` permission, and Property scope/grant in the same transaction as the Review write. The authority reads the permission generation optimistically, locks the concrete membership/grant rows, then locks and rechecks the generation; a change denies the command. Membership/role/grant revocation therefore linearizes before or after the protected command without an inverse trigger lock order; it cannot race a Google send. A dispatch-time denial atomically returns the Reply to `draft`/`cancelled` and records `review.reply.publication_cancelled(cause='policy')`, so the consumed job cannot strand an authorized cycle.
- Provider write acknowledgement persists the exact attempt/correlation outcome as `pending_observation`; it never marks the Reply published and never closes Inbox work.
- `google-reply-v1` comparison NFC-normalizes, normalizes CRLF/CR to LF, and trims only the outer boundary. Case, punctuation, internal spaces, and internal line breaks remain significant. The version and expected digest are frozen into every attempt; only an exact current live digest match may confirm it.
- A persisted `sending` attempt is an uncertain provider outcome. Before any repeat write, the worker performs a targeted read and records it. Exact live or divergent truth stops the write; a missing Review or failed read stops the write; only a newer, current, targeted absence observation with all source/material/reply/cycle fences intact permits the database to claim another attempt.
- Google reply observations are append-only with one monotonically increasing Review-scoped revision and a content-free canonical input digest. A same-key/same-evidence replay returns the committed result—even after the Review later advances—while key reuse with different scope/content/provider time fails closed.
- Observation history/head, Publication Attempts, Reply state confirmation, and identifier-only outbox facts commit together. Database constraints bind tenant Review identity, material revision, Reply/cycle/attempt, observation head, matched attempt, and confirmation links; application agreement alone is not closure authority.
- Add/edit/delete observations are fenced by current source epoch and Material Review Revision. A stale observation or event cannot confirm a newer Reply cycle. Provider-controlled normalized observation text shares the Review source-content lifecycle and is redacted on governed source erasure.
- Every provider-snapshot page carries the provider's total count and average rating. Count or average drift within the main scan or between the main and confirmation scans terminally fails the run. Zero reviews is represented only as count `0` plus average `null`; a positive count requires a finite provider average from `0` through `5`.
- Review records `review.google_reputation_snapshot.verified`, its append-only aggregate fact, and the run's `completed` transition in one PostgreSQL transaction after the bounded deletion-reconciliation suffix is empty. The fact contains no Review ID, provider identifier, reviewer, rating distribution, or text. Its source epoch prevents an old Google binding from becoming current truth.

## Events produced

| Tag                                          | Payload                                                                                                                           | When emitted                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `review.created`                             | identifier/scope, source epoch/revision, analysis sequence, occurredAt                                                            | The first accepted provider observation creates a stable Review; no rating, reviewer, provider ID, or text enters the fact              |
| `review.updated`                             | the same content-minimal identifiers and revision/sequence fences                                                                 | A newer accepted current observation is recorded; material revision advances only for rating or normalized original-text change         |
| `review.expired`                             | stable Review/scope identifiers, occurredAt                                                                                       | Legacy registered compatibility only; destructive Review purge has no active producer                                                   |
| `review.source_transitioned`                 | stable Review/scope identifiers, source/material revisions, transition, occurredAt                                                | Provider deletion or governed source expiry preserves stable Review, Replies, and workflow history                                      |
| `review.google_reputation_snapshot.verified` | Organization/Property/source epoch/run IDs, provider count/average, evaluatedAt/source version                                    | Both scans and bounded Review reconciliation complete with one unchanged provider aggregate; the fact and completed run co-commit       |
| `review.reply.published`                     | reply/review/scope identifiers, author, source, occurredAt                                                                        | An exact current Google observation confirms the active attempt; this is lifecycle compatibility, not Inbox provider evidence           |
| `review.reply.submitted`                     | replyId, reviewId, propertyId, organizationId, userId, source, occurredAt                                                         | A draft Reply is submitted for approval                                                                                                 |
| `review.reply.approved`                      | replyId, reviewId, propertyId, organizationId, userId, authorId, source, occurredAt                                               | A manager approves the Reply                                                                                                            |
| `review.reply.publication_requested`         | reply/review/scope/user IDs, publicationCycle, sourceAggregateVersion, occurredAt                                                 | Approval, edit-and-republish, or non-healing retry commits a durable exact-cycle publication intent                                     |
| `review.reply.rejected`                      | replyId, reviewId, propertyId, organizationId, userId, authorId, source, reason, occurredAt                                       | A manager rejects the Reply during review                                                                                               |
| `review.reply.publish_failed`                | replyId, reviewId, propertyId, organizationId, authorId, occurredAt                                                               | Durable publication processing reaches its governed failed state                                                                        |
| `review.reply.updated`                       | replyId, reviewId, propertyId, organizationId, userId, authorId, source, occurredAt                                               | Manager-owned Reply text/state metadata changes without asserting provider publication                                                  |
| `review.reply.publication_cancelled`         | reply/review/scope IDs, publicationCycle, cause, sourceAggregateVersion, occurredAt                                               | Current manager policy or newer provider truth cancels an active cycle; replay converges for the exact cycle/cause                      |
| `review.reply.observed`                      | Review/scope IDs, observation/source/material revisions, change, resolution, provenance, optional matched Reply/cycle, occurredAt | One exact Google Reply Observation becomes the current head; Inbox acts only through Review's exact-current permit under the same fence |

## Events consumed

- **`property.created`** — Enqueues sync job for new property reviews (via `on-property-created` handler).
- **`review.reply.publication_requested`** — The worker reloads the reply, checks scope, state, and exact cycle, then admits that cycle under the deterministic `reply-<replyId>-v<cycle>` queue identity. Missing, completed, cancelled, failed, or superseded intents settle as obsolete.

## Architecture layers

```
review/
  domain/              types.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             review.repository.ts, review-observation.repository.ts,
                       reply.repository.ts, review-queue.port.ts,
                       reply-queue.port.ts, google-review-api.port.ts,
                       review-provider-snapshot.repository.ts,
                       google-reply-observation-store.port.ts,
                       serving-stats.port.ts (BQC-5.5 ReviewServingStats)
    use-cases/         sync-reviews.ts, run-review-provider-snapshot.ts,
                       reply-operations.ts, reconcile-reply-publication.ts
    ports/             review-command-store.port.ts, reply-command-store.port.ts (BQC-3.3), ...
    public-api.ts      re-exports DTO types, port types, event types/constructors
  infrastructure/
    repositories/      review.repository.ts, review-observation.repository.ts,
                       review-provider-snapshot.repository.ts,
                       reply.repository.ts (Drizzle)
    google-reply-observation-store.ts  sole Google reply history/head and confirmation authority
    reply-command-store.ts             atomic Reply state, attempt, and intent store
    serving-stats.ts   governed aggregate serving reads (BQC-5.5; eligibility in SQL)
    mappers/           review.mapper.ts, reply.mapper.ts
    event-handlers/    on-property-created.ts, index.ts
    outbox-consumers.ts durable cycle-fenced reply-publication admission
    worker-runtime.ts   sole Review-owned worker-handler registration contribution
    jobs/              sync-property-reviews.job.ts, refresh-expiring-reviews.job.ts,
                       purge-expired-reviews.job.ts, publish-reply.job.ts
  server/              reply.ts, reply-draft.ts, reply-read.ts, staff-recent-activity.ts
  build.ts             composition root
```

## Use cases

- **`syncReviews`** — Fetches Reviews from Google for one location, persists the governed Review/source observation, and records the observed Google reply through the sole reply-observation authority. It does not maintain a second `google_sync` truth mirror. Returns created/updated/failed counts.
- **`runReviewProviderSnapshot`** — Runs the resumable main/confirmation provider scan and bounded Review reconciliation for one exact Organization, Property, source epoch, and run ID. It rejects malformed or drifting provider aggregates and is the only producer of the verified Google reputation snapshot fact.
- **`draftReply`** — Create or update an internal reply in `draft` status. Requires PM+ role.
- **`submitReply`** — Move draft reply to `pending_approval`. Validates state transition.
- **`approveReply`** — Under a transaction-bound current Identity authority check, atomically move the reply to `approved`, advance its publication cycle, persist the named authorizing manager, and record the durable publication intent; then attempt the direct low-latency queue admission. Requires current `reply.manage` plus current Property scope.
- **`rejectReply`** — Move reply to `rejected` with optional reason. Requires PM+ role.
- **`deleteReply`** — Hard-delete an internal reply. Only drafts/rejected can be deleted.
- **`getReply`** — Retrieve a single reply by ID.
- **`retryPublish`** — First preserve ambiguous-provider reconciliation; when no provider reply can heal the state, atomically return the reply to `approved`, advance its cycle, and record a new durable publication intent before attempting direct queue admission.
- **`editPublishedReply`** — Atomically replace published text, return the reply to `approved`, advance its cycle, and record the updated lifecycle fact plus a new durable publication intent before attempting direct queue admission.
- **`reconcileReplyPublication`** — Targeted read-only reconciliation for `sending`, `pending_observation`, ambiguous, or terminal publication states. It records live/absent provider truth through the observation authority; only an exact current match confirms publication. It never calls the publish endpoint.

## Public API

Exported from `application/public-api.ts`:

- Core types: `GoogleReview`, `StarRating`, `StaffRecentReview`
- The built `publicApi` groups the Review-owned manager Reply workflow under `reply`, exposes the Property-scoped recent-activity query, and owns `syncAdmission` for Integration import/push workflows.
- Governed serving read: `ReviewServingStats`
- Provider reads: `GoogleReviewApiPort`, `GoogleReviewApiErrorCode`, `GoogleReviewApiError`, `GoogleReviewPageRequest`, `GoogleReviewGetRequest`, `TargetedGoogleReviewReferenceResolver`
- Source-content lifecycle: `collectReviewSourceContentLifecycleReport`, `REVIEW_SOURCE_CONTENT_LIFECYCLE_MAX_BATCH_SIZE`, `SourceContentPurge`
- Exact-current authorities: `ReviewReplyObservationAuthority`, `ReviewResponseTargetAuthority`, `ReviewResponseTargetAuthorityResult`, `ReviewResponseTargetExpectation`, `ReviewInboxProjectionExpectation`, `ReviewInboxProjectionRevisionPermit`, `ReviewSourceTransitionAuthority`
- Publication reconciliation: `ReconcileReplyPublication`, `ReconcileReplyPublicationInput`, `FindAmbiguousPublicationReconciliationCandidates`, `AmbiguousPublicationReconciliationCandidate`
- Content-free AI source contracts: `AiReviewSourcePort`, `AiReviewCurrentSource`
- Fixed values: `MAX_REPLY_LENGTH`, `GBP_PUSH_SYNC_INITIATOR_ID`
- Queue contract Integration enqueues through: `ReviewQueuePort`, `TargetedGoogleReviewQueuePort`
- Event types: `ReviewCreated`, `ReviewUpdated`, `ReviewGoogleReputationSnapshotVerified`, `ReviewSourceTransitioned`, `ReviewReplyPublished`, `ReviewReplyObserved`, `ReviewReplySubmitted`, `ReviewReplyApproved`, `ReviewReplyUpdated`, `ReviewReplyPublicationRequested`, `ReviewReplyPublicationCancelled`, `ReviewReplyRejected`, `ReviewReplyPublishFailed`, `ReviewExpired`, `ReviewEvent`
- Event constructors: `reviewCreated`, `reviewUpdated`, `reviewExpired`, `reviewReplyPublished`, `reviewReplyPublicationRequested`

## Server functions

- **`reply.ts`** — Server functions for reply CRUD operations (draft, submit, approve, reject, delete, retry). All require PM+ role.

## Organization Export (LIF-01-T6)

`build.ts` exposes `organizationExport.contributor`, Review's implementation of
Identity's `organization-export-contributor.port`. It sits outside `publicApi`
on purpose — no request path may call it — and the composition root hands it to
Identity's `organizationExport.contributors`.

Review is the sharpest exclusion boundary in the export. LIF-01 bullet 6 asks
for "manager-authored replies with AI provenance"; bullet 7 forbids raw
Google-controlled review content and identifiers copied merely for export. The
disclosure map permits Review exactly one class, `manager_authored`, and every
emitted entry carries it.

Reads exactly three tables:

- `replies`, filtered to `source = 'internal'` — the manager's own reply text,
  its workflow state, and its AI provenance (authorship, adopted operation id,
  drafting epoch, profile version, template pin, language group).
- `reply_publication_authorizations` — who authorized which publication cycle.
- `reply_publication_attempts` — attempt outcomes and confirmation.

Deliberately never read, not even to resolve a property name:

- `reviews`, `review_source_contents`, `review_source_observations` and
  `material_review_revisions` — Google-controlled review text and identity.
- `google_reply_observations` — carries the provider's own reply text.
- `review_provider_subjects`, `review_provider_snapshot_members` and the
  reputation snapshot facts — provider identifier and live performance material.
- `replies` rows with `source = 'google_sync'` — a mirror of a reply RepKey did
  not author. Exporting it would ship provider text under a manager-authored
  label.
- `provider_operation_key`, `provider_correlation_id` and reply digests —
  idempotency/fencing control plane.

An Organization with no manager-authored reply work answers `no_data`; an empty
replies CSV is never fabricated.

## Permissions

- `review.read` — View reviews and review details.
- `reply.manage` — Draft, submit, approve, reject, and delete replies.

## Background jobs

`buildReviewContext` captures Review repositories, queues, use cases, and foreign public ports in one `registerWorkerJobs` runtime contribution. Composition supplies the canonical registry/background queue and Bootstrap invokes this one method with the parsed discovery interval; neither layer reconstructs Review job dependencies.

- **sync-property-reviews** — Fetches reviews from Google for a specific property/location. Triggered by `property.created` event or `refresh-expiring-reviews` job.
- **refresh-expiring-reviews** — Finds reviews expiring within 5 days, enqueues sync jobs to refresh them. Runs daily.
- **purge-expired-reviews** — compatibility entry point for the single Review source-content lifecycle authority. It keyset-checkpoints a frozen window and its recurring job accepts content-free eligibility `report` and expand/cache/observation/revision/legacy-reply `shadow` evidence only. Checkpoints bind mode, scope, window, and `(createdAt, ReviewId)` cursor. The connection/Property/Organization compatibility adapter and legacy raw-expiry repository seam also delegate here and are report-only in ordinary composition. The local authority has a bounded whole-page atomic `apply` path, but every page fails closed without both the exact apply confirmation and an injected approval seal that is revalidated on continuation; ordinary production composition supplies neither. The shared erasure/reconciliation/re-observation transaction has real-PostgreSQL concurrency, rollback, replay, and stable-identity coverage. Recurring activation still requires the REV-01 external shadow-parity seal, restore/erasure proof, and explicit cutover approval.
- **review.on-reply-publication-requested** — Durable worker consumer that independently recovers queue admission after a request-process interruption. It reloads the authoritative reply and only admits the intent's exact active cycle. Queue-add/receipt ambiguity is fenced by the deterministic reply+cycle BullMQ job ID.
- **publish-reply** — Executes one guarded provider write for an approved current cycle. Claim revalidates the cycle's named manager against current membership, effective `reply.manage`, and Property scope in the claim transaction; denial cancels the cycle without provider egress. A fresh authorized attempt may write once; a persisted uncertain `sending` attempt must complete targeted readback first and may resend only after a current absence observation. Acknowledged writes remain `pending_observation`; terminal/retryable/ambiguous failures follow the durable attempt state machine and reconciliation schedule.
- **reconcile-ambiguous-publications** — Globally single-flight across replicas through a PostgreSQL session advisory lease. It keyset-walks due provider-pending/ambiguous rows and performs provider reads only. A 240-second monotonic start deadline leaves 60 seconds inside the worker's 300-second timeout for an already-started bounded provider read, its checkpoint, reporting, and lease release; an unstarted suffix remains due for the next run.
