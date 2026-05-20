# Review Context

External platform reviews — sync, storage, reply mirroring, and 30-day retention compliance.

## Glossary

| Term                   | Definition                                                                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Review**             | Public review from an external platform (currently Google only). Has `platform`, `externalId`, `rating`, `text`, `reviewerName`.                                                                                                                                                                                     |
| **Rating**             | 1–5 star value on a Review. NOT the same as Guest Rating (guest context, private, via QR).                                                                                                                                                                                                                           |
| **Feedback**           | Private text comment from a portal visitor (guest context). Never appears here.                                                                                                                                                                                                                                      |
| **Reply**              | Response to a Review. Separate entity from Review. Has `source`: `google_sync` (mirrored from Google) or `internal` (drafted by staff). Internal replies follow a lifecycle: `draft` → `pending_approval` → `approved` → `published` (or `publish_failed`). Can be `rejected` (with optional reason) and re-drafted. |
| **Reply Lifecycle**    | `draft` → `pending_approval` → `approved` → `published`. `approved` may transition to `publish_failed` on Google API error. `rejected` replies can be re-drafted. Only PM+ roles can manage replies; Staff cannot view or manage replies.                                                                            |
| **Reply Audit Fields** | `approvedBy`, `rejectedBy` (UserId), `rejectionReason` (optional text), `aiGenerated` (boolean, always false until AI integration).                                                                                                                                                                                  |
| **Platform**           | External review source. Currently only `'google'`. The `reviewPlatformEnum` is closed.                                                                                                                                                                                                                               |
| **External ID**        | Google's review ID (extracted from `review.name`). Unique per platform per organization.                                                                                                                                                                                                                             |
| **Expires At**         | Deadline for 30-day Google data retention. Calculated per-review from `reviewedAt + 30 days`.                                                                                                                                                                                                                        |

## Invariants

- Unique constraint: `(platform, external_id, organization_id)` — same Google review can exist for multiple orgs.
- `google_sync` reply: at most one per review per org (unique on `(review_id, source, organization_id)`).
- `internal` reply: at most one per review per org (same unique constraint, different source value).
- Partial unique index ensures at most one `published` reply per review (regardless of source).
- Rating is always 1–5 (`StarRating` union type). DB stores as integer — adapter validates via `STAR_RATING_MAP`.
- Reviews without a fresh sync for 30+ days are purged (3-day grace period for failed syncs).
- Reply text limited to 4096 characters (`MAX_REPLY_LENGTH`).
