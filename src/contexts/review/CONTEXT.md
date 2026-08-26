# Review Context

## Bounded context

Stable external-review identity, provider observation/content lifecycle, and
RepKey-owned reply workflow. Provider-controlled content is a bounded cache; it
is not the identity or history authority.

## Glossary

- **Review** — Stable RepKey identity for one provider review. It survives provider deletion and source-content expiry so Replies and manager handling history keep a valid reference.
- **Review Source Content** — Separately erasable provider-controlled fields (provider identifiers, rating, text, reviewer presentation, provider timestamps) for the currently observed revision.
- **Review Source Observation** — Target versioned record of what was fetched and when. The current expand implementation stores one active source-content row; full observation history remains REV-01 work.
- **Material Review Revision** — Target versioned business revision used to fence Inbox handling, Replies, and AI. It is not yet implemented by the compatibility Review columns.
- **Rating** — 1–5 star value on a Review. NOT the same as Guest Rating (guest context, private, via QR).
- **Feedback** — Private text comment from a portal visitor (guest context). Never appears here.
- **Reply** — Response to a Review. Separate entity from Review. Has `source`: `google_sync` (mirrored from Google) or `internal` (drafted by staff). Internal replies follow a lifecycle: `draft` → `pending_approval` → `approved` → `published` (or `publish_failed`). Can be `rejected` (with optional reason) and re-drafted.
- **Reply Lifecycle** — `draft` → `pending_approval` → `approved` → `published`. `approved` may transition to `publish_failed` on Google API error. `rejected` replies can be re-drafted. Only PM+ roles can manage replies; Staff cannot view or manage replies.
- **Reply Audit Fields** — `approvedBy`, `rejectedBy` (UserId), `rejectionReason` (optional text), `aiGenerated` (boolean, always false until AI integration).
- **authorId** — Original reply author (distinct from `userId` who performed the action). Present on all reply events.
- **source** — Reply origin: `'web'` (staff-drafted) or `'import'` (Google sync mirror). Present on all reply events except `publish_failed`.
- **Platform** — External review source. Currently only `'google'`. The `reviewPlatformEnum` is closed.
- **External ID** — Erasable Google identifier used only while source content is active. A protected HMAC subject mapping reconnects a later observation to the stable Review ID.
- **Content Expires At** — Fetch-based provider-content deadline. It is refreshed only by a valid provider observation and is never derived from the public review date.

## Relationships

- **Review → Property** (N:1 via `propertyId`) — Every review belongs to exactly one property.
- **Review → Reply** (1:N via `reviewId`) — A review can have up to one `google_sync` reply and one `internal` reply (enforced by unique constraint).
- **Cross-context** — Review listens to `property.created` to enqueue a `sync-property-reviews` job via `ReviewQueuePort.addSyncJob`.

## Invariants

- Period-serving reads use half-open business-time bounds (`start <= reviewedAt < end`) so adjacent Dashboard periods are contiguous and never double-count a boundary review.
- Active source content has one `(platform, external_id, organization_id)` identity. The compatibility Review value becomes null after erasure; the HMAC mapping preserves stable re-observation identity without retaining the provider ID there.
- `google_sync` reply: at most one per review per org (unique on `(review_id, source, organization_id)`).
- `internal` reply: at most one per review per org (same unique constraint, different source value).
- Partial unique index ensures at most one `published` reply per review (regardless of source).
- Rating is always 1–5 (`StarRating` union type). DB stores as integer — adapter validates via `STAR_RATING_MAP`.
- Serving reads deny provider content at its fetch-based hard expiry. REV-01 expand storage dual-writes independently erasable `review_source_contents`; confirmed deletion/expiry removes that row and scrubs nullable compatibility fields while preserving the stable Review and manager Replies. Recurring activation remains quarantined until the shadow-parity/cutover audit and full revision model are complete.
- Provider-subject HMAC mappings, not erased Google identifiers, reconnect a re-observation to the same stable Review ID. A collision fails closed.
- Reply text limited to 4096 characters (`MAX_REPLY_LENGTH`).

## Events produced

- **`review.created`** — identifier/scope plus source epoch, source revision, analysis sequence, and occurrence time. Contains no rating, reviewer, provider ID, or review text.
- **`review.updated`** — the same content-minimal envelope for a newer observed source revision. Consumers resolve eligible content through the authorized Review read port.
- **`review.source_transitioned`** — content-minimal source-expired/provider-deleted transition that preserves the stable Review and Replies.
- **`review.expired`** — legacy registered fact with no active producer while destructive Review purge is quarantined. REV-01 must replace/freeze its lifecycle semantics before activation.
- **`review.reply.published`** — replyId, reviewId, propertyId, organizationId, userId (nullable), authorId, source, occurredAt. Emitted when a reply reaches published status (web: user-approved, import: Google sync mirror).
- **`review.reply.submitted`** — replyId, reviewId, propertyId, organizationId, userId, source, occurredAt. Emitted when a draft reply is submitted for approval.
- **`review.reply.approved`** — replyId, reviewId, propertyId, organizationId, userId, authorId, source, occurredAt. Emitted when a reply is approved.
- **`review.reply.rejected`** — replyId, reviewId, propertyId, organizationId, userId, authorId, source, reason, occurredAt. Emitted when a reply is rejected during review.
- **`review.reply.publish_failed`** — replyId, reviewId, propertyId, organizationId, authorId, occurredAt. Emitted when reply publishing fails after retry.

## Events consumed

- **`property.created`** — Enqueues sync job for new property reviews (via `on-property-created` handler).

## Architecture layers

```
review/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             review.repository.ts, reply.repository.ts, review-queue.port.ts,
                       reply-queue.port.ts, google-review-api.port.ts,
                       serving-stats.port.ts (BQC-5.5 ReviewServingStats)
    use-cases/         sync-reviews.ts, reply-operations.ts, reconcile-reply-publication.ts
    ports/             review-command-store.port.ts, reply-command-store.port.ts (BQC-3.3), ...
    public-api.ts      re-exports DTO types, port types, event types/constructors
  infrastructure/
    repositories/      review.repository.ts, reply.repository.ts (Drizzle)
    serving-stats.ts   governed aggregate serving reads (BQC-5.5; eligibility in SQL)
    mappers/           review.mapper.ts, reply.mapper.ts
    event-handlers/    on-property-created.ts, index.ts
    jobs/              sync-property-reviews.job.ts, refresh-expiring-reviews.job.ts,
                       purge-expired-reviews.job.ts, publish-reply.job.ts
  server/              reply.ts, reply-draft.ts, reply-read.ts, staff-recent-activity.ts
  build.ts             composition root
```

## Use cases

- **`syncReviews`** — Fetches reviews from Google for a single location, upserts them, mirrors reply state. Bypasses domain constructors (trusted external data). Returns created/updated/failed counts.
- **`draftReply`** — Create or update an internal reply in `draft` status. Requires PM+ role.
- **`submitReply`** — Move draft reply to `pending_approval`. Validates state transition.
- **`approveReply`** — Move reply to `approved`, enqueue publish job. Requires PM+ role.
- **`rejectReply`** — Move reply to `rejected` with optional reason. Requires PM+ role.
- **`deleteReply`** — Hard-delete an internal reply. Only drafts/rejected can be deleted.
- **`getReply`** — Retrieve a single reply by ID.
- **`retryPublish`** — Retry publishing a `publish_failed` reply.
- **`reconcileReplyPublication`** — BQC-3.3 operator recovery for an ambiguous publish outcome: re-reads provider state via the GBP sync read path; heals to `published` (atomic, durable fact) when Google shows the reply, else stays `publish_failed` (`still_failed`). Never calls the publish endpoint.

## Public API

Exported from `application/public-api.ts`:

- Types: `GoogleReview`, `StarRating`, `ReviewQueuePort`, `SyncPropertyReviewsJobData`, `AddSyncJobOptions`, `GoogleReviewApiPort`, `StaffRecentReview`
- BQC-5.5: `ReviewServingStats` — governed aggregate serving reads over review/reply content (ADR 0031 eligibility enforced at this owner, clock-injected). Composition wires the infrastructure implementation (`infrastructure/serving-stats.ts`) into the dashboard build; exposed on the build's `internal.servingStats`.
- Event types: `ReviewCreated`, `ReviewUpdated`, `ReviewReplyPublished`, `ReviewReplySubmitted`, `ReviewReplyApproved`, `ReviewReplyRejected`, `ReviewReplyPublishFailed`, `ReviewExpired`, `ReviewEvent`
- Event constructors: `reviewCreated`, `reviewUpdated`, `reviewReplyPublished`, `reviewReplySubmitted`, `reviewReplyApproved`, `reviewReplyRejected`, `reviewReplyPublishFailed`, `reviewExpired`

## Server functions

- **`reply.ts`** — Server functions for reply CRUD operations (draft, submit, approve, reject, delete, retry). All require PM+ role.

## Permissions

- `review.read` — View reviews and review details.
- `reply.manage` — Draft, submit, approve, reject, and delete replies.

## Background jobs

- **sync-property-reviews** — Fetches reviews from Google for a specific property/location. Triggered by `property.created` event or `refresh-expiring-reviews` job.
- **refresh-expiring-reviews** — Finds reviews expiring within 5 days, enqueues sync jobs to refresh them. Runs daily.
- **purge-expired-reviews** — SAFE-03 quarantine handler only: drains leftover legacy jobs. The replacement repository lifecycle erasure has real-PostgreSQL expiry/provider-delete/re-observation evidence, but recurring activation still requires the REV-01 shadow-parity seal and checkpointed lifecycle cutover.
- **publish-reply** — Publishes an approved reply to Google via API. Retries up to 3 times with exponential backoff; provider outcomes classified via the publication saga (terminal 4xx → `publish_failed` without retry burn; ambiguous final → `publish_failed` + reconcile).
