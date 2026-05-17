# Review Context

External platform reviews — sync, storage, reply mirroring, and 30-day retention compliance.

## Glossary

| Term | Definition |
|------|------------|
| **Review** | Public review from an external platform (currently Google only). Has `platform`, `externalId`, `rating`, `text`, `reviewerName`. |
| **Rating** | 1–5 star value on a Review. NOT the same as Guest Rating (guest context, private, via QR). |
| **Feedback** | Private text comment from a portal visitor (guest context). Never appears here. |
| **Reply** | Response to a Review. Has `source`: `google_sync` (mirrored from Google) or `internal` (Phase 12, authored by staff). |
| **Platform** | External review source. Currently only `'google'`. The `reviewPlatformEnum` is closed. |
| **External ID** | Google's review ID (extracted from `review.name`). Unique per platform per organization. |
| **Expires At** | Deadline for 30-day Google data retention. Calculated per-review from `reviewedAt + 30 days`. |

## Invariants

- Unique constraint: `(platform, external_id, organization_id)` — same Google review can exist for multiple orgs.
- `google_sync` reply: at most one per review per org (unique on `(review_id, source, organization_id)`).
- Rating is always 1–5 (`StarRating` union type). DB stores as integer — adapter validates via `STAR_RATING_MAP`.
- Reviews without a fresh sync for 30+ days are purged (3-day grace period for failed syncs).
