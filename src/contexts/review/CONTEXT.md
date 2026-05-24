# Review Context

External platform reviews — sync, storage, reply mirroring, and 30-day retention compliance.

## Glossary

- **Review** — Public review from an external platform (currently Google only). Has `platform`, `externalId`, `rating`, `text`, `reviewerName`.
- **Rating** — 1–5 star value on a Review. NOT the same as Guest Rating (guest context, private, via QR).
- **Feedback** — Private text comment from a portal visitor (guest context). Never appears here.
- **Reply** — Response to a Review. Separate entity from Review. Has `source`: `google_sync` (mirrored from Google) or `internal` (drafted by staff). Internal replies follow a lifecycle: `draft` → `pending_approval` → `approved` → `published` (or `publish_failed`). Can be `rejected` (with optional reason) and re-drafted.
- **Reply Lifecycle** — `draft` → `pending_approval` → `approved` → `published`. `approved` may transition to `publish_failed` on Google API error. `rejected` replies can be re-drafted. Only PM+ roles can manage replies; Staff cannot view or manage replies.
- **Reply Audit Fields** — `approvedBy`, `rejectedBy` (UserId), `rejectionReason` (optional text), `aiGenerated` (boolean, always false until AI integration).
- **Platform** — External review source. Currently only `'google'`. The `reviewPlatformEnum` is closed.
- **External ID** — Google's review ID (extracted from `review.name`). Unique per platform per organization.
- **Expires At** — Deadline for 30-day Google data retention. Calculated per-review from `reviewedAt + 30 days`.

## Invariants

- Unique constraint: `(platform, external_id, organization_id)` — same Google review can exist for multiple orgs.
- `google_sync` reply: at most one per review per org (unique on `(review_id, source, organization_id)`).
- `internal` reply: at most one per review per org (same unique constraint, different source value).
- Partial unique index ensures at most one `published` reply per review (regardless of source).
- Rating is always 1–5 (`StarRating` union type). DB stores as integer — adapter validates via `STAR_RATING_MAP`.
- Reviews without a fresh sync for 30+ days are purged (3-day grace period for failed syncs).
- Reply text limited to 4096 characters (`MAX_REPLY_LENGTH`).

## Events produced

- **`review.created`** — reviewId, propertyId, organizationId, platform, externalId, rating, reviewText, staffId, occurredAt. Emitted when a new review is synced from Google.
- **`review.updated`** — reviewId, propertyId, organizationId, platform, externalId, rating, reviewText, occurredAt. Emitted when an existing review is re-synced with new data.
- **`review.expired`** — reviewId, propertyId, organizationId, occurredAt. Emitted when the purge job hard-deletes expired reviews.
- **`reply.published`** — replyId, reviewId, propertyId, organizationId, occurredAt. Emitted when a reply reaches published status.

## Events consumed

- **`property.created`** — Enqueues sync job for new property reviews (via `on-property-created` handler).

## Architecture layers

```
review/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             review.repository.ts, reply.repository.ts, review-queue.port.ts,
                       reply-queue.port.ts, google-review-api.port.ts
    dto/               sync-reviews.dto.ts
    use-cases/         sync-reviews.ts, reply-operations.ts
    public-api.ts      re-exports DTO types, port types, event types/constructors
  infrastructure/
    repositories/      review.repository.ts, reply.repository.ts (Drizzle)
    mappers/           review.mapper.ts, reply.mapper.ts
    event-handlers/    on-property-created.ts, index.ts
    jobs/              sync-property-reviews.job.ts, refresh-expiring-reviews.job.ts,
                       purge-expired-reviews.job.ts, publish-reply.job.ts
  server/              reply.ts
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

## Public API

Exported from `application/public-api.ts`:

- Types: `GoogleReview`, `StarRating`, `ReviewQueuePort`, `SyncPropertyReviewsJobData`, `AddSyncJobOptions`, `GoogleReviewApiPort`
- Event types: `ReviewCreated`, `ReviewUpdated`, `ReplyPublished`, `ReviewEvent`, `ReplyEvent`
- Event constructors: `reviewCreated`, `reviewUpdated`, `replyPublished`

## Server functions

- **`reply.ts`** — Server functions for reply CRUD operations (draft, submit, approve, reject, delete, retry). All require PM+ role.

## Permissions

- `review.read` — View reviews and review details.
- `reply.manage` — Draft, submit, approve, reject, and delete replies.

## Background jobs

- **sync-property-reviews** — Fetches reviews from Google for a specific property/location. Triggered by `property.created` event or `refresh-expiring-reviews` job.
- **refresh-expiring-reviews** — Finds reviews expiring within 5 days, enqueues sync jobs to refresh them. Runs daily.
- **purge-expired-reviews** — Hard-deletes reviews expired for more than 3 days. Emits `review.expired` events. Runs daily.
- **publish-reply** — Publishes an approved reply to Google via API. Retries up to 3 times with exponential backoff.
