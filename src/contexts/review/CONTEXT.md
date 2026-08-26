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
- **Rating** — 1–5 star value on a Review. NOT the same as Guest Rating (guest context, private, via QR).
- **Feedback** — Private text comment from a portal visitor (guest context). Never appears here.
- **Reply** — A manager-owned response to a Review. `internal` is authoritative; the legacy `google_sync` source remains schema-compatible but is removed whenever governed Google observation truth is recorded, so it cannot become a second provider-truth store.
- **Reply Lifecycle** — `draft` → `pending_approval` → `approved` → provider write states → `published`. Provider acknowledgement enters `pending_observation`; only a later exact current Google observation reaches `published`. Terminal/ambiguous outcomes may enter `publish_failed`; rejected replies can be re-drafted. Only PM+ roles can manage replies; Staff cannot view or manage replies.
- **Publication Authorization** — Immutable evidence for one Reply publication cycle, including the named manager who authorized it and the exact tenant, Property, Review/material revision, provider-observation head, Reply revision, and normalized reply digest. The named manager's current authority is revalidated before dispatch.
- **Publication Attempt** — Immutable numbered evidence for one Reply publication cycle, binding tenant, property, Review, source epoch, Material Review Revision, authorized Reply state revision, expected normalized digest, provider operation/correlation IDs, outcome, and (when confirmed) one exact Google Reply Observation.
- **Google Reply Observation** — Append-only Review-owned provider-reply fact (`live` or `absent`) from a provider snapshot or targeted reconciliation. One exact history row is the current head. It records add/edit/delete/unchanged, provenance, normalized content digest, lifecycle clocks, and an optional exact Publication Attempt match.
- **Pending Observation** — A provider write was acknowledged, but no current Google read has yet proved the authorized reply is live. It is not published truth.
- **Reply Audit Fields** — `approvedBy`, `rejectedBy` (UserId), `rejectionReason` (optional text), `aiGenerated` (boolean, always false until AI integration).
- **authorId** — Original reply author (distinct from `userId` who performed the action). Present on all reply events.
- **source** — Event attribution: `'web'` for manager-owned workflow actions and `'import'` only for legacy provider-mirror compatibility. Present on applicable reply lifecycle facts.
- **Platform** — External review source. Currently only `'google'`. The `reviewPlatformEnum` is closed.
- **External ID** — Erasable Google identifier used only while source content is active. A protected HMAC subject mapping reconnects a later observation to the stable Review ID.
- **Content Expires At** — Fetch-based provider-content deadline. It is refreshed only by a valid provider observation and is never derived from the public review date.

## Relationships

- **Review → Property** (N:1 via `propertyId`) — Every review belongs to exactly one property.
- **Review → Reply** (1:N via `reviewId`) — A review can have up to one `google_sync` reply and one `internal` reply (enforced by unique constraint).
- **Reply → Publication Attempt** (1:N per publication cycle) — every attempt is tenant/property/Review/Reply/revision fenced; confirmation points to the exact observation revision.
- **Review → Google Reply Observation** (1:N history, 1:1 head) — duplicated head fields are relationally bound to one exact observation row, and a claimed RepKey match binds to one exact Publication Attempt.
- **Cross-context** — Review listens to `property.created` to enqueue a `sync-property-reviews` job via `ReviewQueuePort.addSyncJob`.

## Invariants

- Period-serving reads use half-open business-time bounds (`start <= reviewedAt < end`) so adjacent Dashboard periods are contiguous and never double-count a boundary review.
- Active source content has one `(platform, external_id, organization_id)` identity. The compatibility Review value becomes null after erasure; the HMAC mapping preserves stable re-observation identity without retaining the provider ID there.
- Each accepted provider fetch has a monotonically increasing observation sequence and a replay-safe observation key. A replay creates neither another observation nor another event; an older provider version is retained as `out_of_order_ignored` and cannot replace the current Review.
- Material comparison uses `review-material-v1`: NFC-normalize the original guest text, collapse Unicode whitespace to one ASCII space, trim, and represent an empty result as null. Case and punctuation remain significant. Only rating or this normalized text can advance `sourceRevision`/Material Review Revision.
- A normalization-version transition first compares the old content under the new version. It adopts a matching baseline without manufacturing an edit; an erased, incomparable legacy baseline preserves its last revision.
- `google_sync` reply: at most one per review per org (unique on `(review_id, source, organization_id)`).
- `internal` reply: at most one per review per org (same unique constraint, different source value).
- Rating is always 1–5 (`StarRating` union type). DB stores as integer — adapter validates via `STAR_RATING_MAP`.
- Serving reads deny provider content at its fetch-based hard expiry. REV-01 expand storage writes `review_source_contents`, `review_source_observations`, and `material_review_revisions` with the stable Review in one transaction. Confirmed deletion/expiry removes the current cache and redacts provider-controlled values from retained observations/revisions while preserving their controls, the stable Review, and manager-owned Replies/history. Recurring activation remains quarantined until the external shadow-parity/cutover audit is complete.
- Provider-subject HMAC mappings, not erased Google identifiers, reconnect a re-observation to the same stable Review ID. A collision fails closed.
- Reply text limited to 4096 characters (`MAX_REPLY_LENGTH`).
- Every publish authorization advances an explicit, monotonically increasing `publicationCycle`. The reply state and that cycle's identifier-only `review.reply.publication_requested` intent are committed in one PostgreSQL transaction. Queue jobs carry the same cycle, and both the recovery consumer and publish worker reject an older cycle so a delayed fact can never admit or acknowledge newer work.
- The authorizing manager and authorization tuple are immutable on the cycle. PostgreSQL ALWAYS triggers reject authorization UPDATE, DELETE, and TRUNCATE, independently of application code. Authorization and provider-attempt claim each re-resolve that named user through Identity's current membership, effective `reply.manage` permission, and Property scope/grant in the same transaction as the Review write. The authority reads the permission generation optimistically, locks the concrete membership/grant rows, then locks and rechecks the generation; a change denies the command. Membership/role/grant revocation therefore linearizes before or after the protected command without an inverse trigger lock order; it cannot race a Google send. A dispatch-time denial atomically returns the Reply to `draft`/`cancelled` and records `review.reply.publication_cancelled(cause='policy')`, so the consumed job cannot strand an authorized cycle.
- Provider write acknowledgement persists the exact attempt/correlation outcome as `pending_observation`; it never marks the Reply published and never closes Inbox work.
- `google-reply-v1` comparison NFC-normalizes, normalizes CRLF/CR to LF, and trims only the outer boundary. Case, punctuation, internal spaces, and internal line breaks remain significant. The version and expected digest are frozen into every attempt; only an exact current live digest match may confirm it.
- A persisted `sending` attempt is an uncertain provider outcome. Before any repeat write, the worker performs a targeted read and records it. Exact live or divergent truth stops the write; a missing Review or failed read stops the write; only a newer, current, targeted absence observation with all source/material/reply/cycle fences intact permits the database to claim another attempt.
- Google reply observations are append-only with one monotonically increasing Review-scoped revision and a content-free canonical input digest. A same-key/same-evidence replay returns the committed result—even after the Review later advances—while key reuse with different scope/content/provider time fails closed.
- Observation history/head, Publication Attempts, Reply state confirmation, and identifier-only outbox facts commit together. Database constraints bind tenant Review identity, material revision, Reply/cycle/attempt, observation head, matched attempt, and confirmation links; application agreement alone is not closure authority.
- Add/edit/delete observations are fenced by current source epoch and Material Review Revision. A stale observation or event cannot confirm a newer Reply cycle. Provider-controlled normalized observation text shares the Review source-content lifecycle and is redacted on governed source erasure.

## Events produced

- **`review.created`** — identifier/scope plus source epoch, source revision, analysis sequence, and occurrence time. Contains no rating, reviewer, provider ID, or review text.
- **`review.updated`** — the same content-minimal envelope for a new current observation. Its material revision advances only for a rating/normalized-original-text change. Re-observation emits this fact, not a second `review.created` identity fact.
- **`review.source_transitioned`** — content-minimal source-expired/provider-deleted transition that preserves the stable Review and Replies.
- **`review.expired`** — legacy registered fact with no active producer while destructive Review purge is quarantined. REV-01 must replace/freeze its lifecycle semantics before activation.
- **`review.reply.published`** — identifier-only internal lifecycle fact emitted only after an exact current Google observation confirms the active attempt. It remains useful for activity/notification compatibility but is not provider evidence for Inbox.
- **`review.reply.observed`** — identifier-only current-head fact containing Review/property/organization, observation/source/material revisions, change, resolution, provenance, and optional matched Reply/cycle. Inbox requests a Review-owned exact-current permit before applying close/reopen effects. The permit depends only on the retained head/fence identifiers and remains valid after governed provider text/digest erasure. Review holds the same observation-write fence through the consumer callback, while Inbox commits its own mutation/fact/receipt transaction; this closes the cross-context validation race without exposing Review tables or transaction types. Process-wide admission limits these nested two-client applies to four, using at most eight of the ten pooled connections and leaving operational headroom.
- **`review.reply.submitted`** — replyId, reviewId, propertyId, organizationId, userId, source, occurredAt. Emitted when a draft reply is submitted for approval.
- **`review.reply.approved`** — replyId, reviewId, propertyId, organizationId, userId, authorId, source, occurredAt. Emitted when a reply is approved.
- **`review.reply.publication_requested`** — identifier-only durable intent containing reply/review/property/organization/user IDs plus the exact publication cycle. The user ID also becomes the immutable `authorizedByUserId` for that cycle. Approval, edit-and-republish, and a non-healing retry record it atomically with the authorized reply state. It is consumed by the worker recovery path and is not emitted on the in-process lifecycle bus.
- **`review.reply.publication_cancelled`** — identifier-only durable lifecycle fact for an active cycle cancelled by current manager policy or newer provider truth. Cause distinguishes `policy` from `provider_truth`; replay is exact-once for that cycle/cause transition.
- **`review.reply.rejected`** — replyId, reviewId, propertyId, organizationId, userId, authorId, source, reason, occurredAt. Emitted when a reply is rejected during review.
- **`review.reply.publish_failed`** — replyId, reviewId, propertyId, organizationId, authorId, occurredAt. Emitted when reply publishing fails after retry.

## Events consumed

- **`property.created`** — Enqueues sync job for new property reviews (via `on-property-created` handler).
- **`review.reply.publication_requested`** — The worker reloads the reply, checks scope, state, and exact cycle, then admits that cycle under the deterministic `reply-<replyId>-v<cycle>` queue identity. Missing, completed, cancelled, failed, or superseded intents settle as obsolete.

## Architecture layers

```
review/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             review.repository.ts, review-observation.repository.ts,
                       reply.repository.ts, review-queue.port.ts,
                       reply-queue.port.ts, google-review-api.port.ts,
                       google-reply-observation-store.port.ts,
                       serving-stats.port.ts (BQC-5.5 ReviewServingStats)
    use-cases/         sync-reviews.ts, reply-operations.ts, reconcile-reply-publication.ts
    ports/             review-command-store.port.ts, reply-command-store.port.ts (BQC-3.3), ...
    public-api.ts      re-exports DTO types, port types, event types/constructors
  infrastructure/
    repositories/      review.repository.ts, review-observation.repository.ts,
                       reply.repository.ts (Drizzle)
    google-reply-observation-store.ts  sole Google reply history/head and confirmation authority
    reply-command-store.ts             atomic Reply state, attempt, and intent store
    serving-stats.ts   governed aggregate serving reads (BQC-5.5; eligibility in SQL)
    mappers/           review.mapper.ts, reply.mapper.ts
    event-handlers/    on-property-created.ts, index.ts
    outbox-consumers.ts durable cycle-fenced reply-publication admission
    jobs/              sync-property-reviews.job.ts, refresh-expiring-reviews.job.ts,
                       purge-expired-reviews.job.ts, publish-reply.job.ts
  server/              reply.ts, reply-draft.ts, reply-read.ts, staff-recent-activity.ts
  build.ts             composition root
```

## Use cases

- **`syncReviews`** — Fetches Reviews from Google for one location, persists the governed Review/source observation, and records the observed Google reply through the sole reply-observation authority. It does not maintain a second `google_sync` truth mirror. Returns created/updated/failed counts.
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

- Types: `GoogleReview`, `StarRating`, `ReviewQueuePort`, `SyncPropertyReviewsJobData`, `AddSyncJobOptions`, `GoogleReviewApiPort`, `StaffRecentReview`, and the content-free `ReviewReplyObservationAuthority` permit contract. Observation/material-history reads remain Review-internal; cross-context consumers receive only an exact-current permit while Review retains its write fence.
- BQC-5.5: `ReviewServingStats` — governed aggregate serving reads over review/reply content (ADR 0031 eligibility enforced at this owner, clock-injected). Composition wires the infrastructure implementation (`infrastructure/serving-stats.ts`) into the dashboard build; exposed on the build's `internal.servingStats`.
- Event types: `ReviewCreated`, `ReviewUpdated`, `ReviewReplyPublished`, `ReviewReplyObserved`, `ReviewReplySubmitted`, `ReviewReplyApproved`, `ReviewReplyPublicationRequested`, `ReviewReplyRejected`, `ReviewReplyPublishFailed`, `ReviewExpired`, `ReviewEvent`
- Event constructors: `reviewCreated`, `reviewUpdated`, `reviewReplyPublished`, `reviewReplyObserved`, `reviewReplySubmitted`, `reviewReplyApproved`, `reviewReplyPublicationRequested`, `reviewReplyRejected`, `reviewReplyPublishFailed`, `reviewExpired`

## Server functions

- **`reply.ts`** — Server functions for reply CRUD operations (draft, submit, approve, reject, delete, retry). All require PM+ role.

## Permissions

- `review.read` — View reviews and review details.
- `reply.manage` — Draft, submit, approve, reject, and delete replies.

## Background jobs

- **sync-property-reviews** — Fetches reviews from Google for a specific property/location. Triggered by `property.created` event or `refresh-expiring-reviews` job.
- **refresh-expiring-reviews** — Finds reviews expiring within 5 days, enqueues sync jobs to refresh them. Runs daily.
- **purge-expired-reviews** — quarantine handler only: drains leftover legacy jobs. The repository-owned erasure/re-observation transaction has real-PostgreSQL coverage, but recurring activation still requires the REV-01 external shadow-parity seal and checkpointed lifecycle cutover.
- **review.on-reply-publication-requested** — Durable worker consumer that independently recovers queue admission after a request-process interruption. It reloads the authoritative reply and only admits the intent's exact active cycle. Queue-add/receipt ambiguity is fenced by the deterministic reply+cycle BullMQ job ID.
- **publish-reply** — Executes one guarded provider write for an approved current cycle. Claim revalidates the cycle's named manager against current membership, effective `reply.manage`, and Property scope in the claim transaction; denial cancels the cycle without provider egress. A fresh authorized attempt may write once; a persisted uncertain `sending` attempt must complete targeted readback first and may resend only after a current absence observation. Acknowledged writes remain `pending_observation`; terminal/retryable/ambiguous failures follow the durable attempt state machine and reconciliation schedule.
- **reconcile-ambiguous-publications** — Globally single-flight across replicas through a PostgreSQL session advisory lease. It keyset-walks due provider-pending/ambiguous rows and performs provider reads only. A 240-second monotonic start deadline leaves 60 seconds inside the worker's 300-second timeout for an already-started bounded provider read, its checkpoint, reporting, and lease release; an unstarted suffix remains due for the next run.
