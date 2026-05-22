# ADR 0003 — Review as a Separate Bounded Context

**Status:** Implemented
**Date:** 2026-05-16
**Context:** Reviews, Google Integration Architecture

## Decision

Introduce a new `review` bounded context for external platform reviews, separate from the existing `integration` context. Integration retains only connection management, OAuth, tokens, and GBP API infrastructure. Property import moves from `integration` to the `property` context. Cross-context communication uses BullMQ job dispatch and domain events.

## Context

Phase 10 introduces Google Business Profile review syncing. The existing `integration` context handles Google OAuth connections, token management, and GBP API calls. Reviews are a rich domain with their own lifecycle (sync, dedup, replies, expiry, future sentiment analysis and reply workflows) that doesn't fit the thin infrastructure role of `integration`.

The `integration` context currently owns property import (creating `Property` entities from GBP locations), which is property domain logic — not integration infrastructure.

## Alternatives Considered

### A. Extend `integration` context with reviews

Add review syncing, replies, and all review domain logic to `integration`. One context owns everything Google.

- **Pros:** Simpler at first. Fewer context boundaries to wire. No new `build()` function.
- **Cons:** `integration` becomes a god context — connections, OAuth, property import, review sync, reply workflow, sentiment analysis. Violates single responsibility. Each new Google feature (sentiment, reply drafts, review inbox UI) bloats it further. The property import already doesn't belong here.

### B. Review as a separate bounded context (chosen)

New `review` context owns: reviews, replies, sync jobs, dedup, events, future reply workflow and sentiment analysis. Integration becomes pure infrastructure: connections, OAuth, tokens, GBP API adapters, Pub/Sub subscription management. Property import moves to `property` context.

- **Pros:** Each context has a clear, singular responsibility. Integration stays thin and infrastructure-focused. Review domain grows independently (Phase 11: inbox UI, Phase 12: reply workflow, Arc 7: AI sentiment). Cross-context boundaries enforce clean dependency direction via facade ports.
- **Cons:** More wiring in `composition.ts`. Cross-context communication requires explicit job dispatch (no direct function calls). More files and folders.

### C. Review + Reply as two separate contexts

Split review syncing and reply management into two contexts.

- **Pros:** Maximum separation of concerns.
- **Cons:** Premature optimization. Reply is a child entity of review with no independent lifecycle. Two contexts for one aggregate is over-engineering. Phase 12's reply workflow (draft → approve → publish) is tightly coupled to the review it replies to.

## Key Architectural Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Facade port `GoogleReviewApiPort` | Review context passes `connectionId`, gets typed reviews back. Never sees tokens or HTTP details. Adapter lives in `integration/infrastructure/`. |
| 2 | Per-property sync scope | One BullMQ job per property. Webhook and manual "Sync Now" both enqueue the same job type. Expandable to per-connection fan-out later. |
| 3 | Pub/Sub push + manual sync only | No periodic polling. Preserves GBP API quota. Pub/Sub subscription on first property import per account. |
| 4 | Derived subscription state | No tracking table. Query properties table to determine if an account should be subscribed. |
| 5 | `expiresAt` on reviews (30-day retention) | Google policy compliance. Daily `refresh-expiring-reviews` job re-syncs before expiry. `purge-expired-reviews` deletes after 3-day grace. |
| 6 | Separate `replies` table | Reply is a first-class entity, not fields on review row. Phase 10: `google_sync` source only. Phase 12 extends with `internal` source and draft/approve/reject workflow. |
| 7 | Full reply enums upfront | `reply_status` and `reply_source` enums include all future values. Avoids `ALTER TYPE` migrations in Phase 12. |
| 8 | Events: `review.created`, `review.updated` | Emitted by sync job. No listeners in Phase 10. Future phases (sentiment, inbox) subscribe. |
| 9 | Integration owns webhook route | JWT validation, notification parsing, property routing are Google infrastructure concerns. |
| 10 | `gbp_cache` for locations only | Reviews are normalized in the `reviews` table. No raw review blobs in cache. `data_type` enum narrowed to `['location']`. |

## Consequences

### Positive

- Each context has a single, clear reason to change
- Review domain can grow through Phase 11 (inbox), Phase 12 (reply workflow), Arc 7 (sentiment) without touching integration code
- Integration context stays thin — connection CRUD, OAuth, token refresh, GBP HTTP calls, Pub/Sub subscription management
- Property import moves to its natural home (property context)
- Facade port enforces clean dependency direction: review → interface ← integration implements
- Google data retention policy (30-day) enforced at the schema level with `expiresAt`

### Negative

- More wiring in `composition.ts` (three contexts instead of one for all Google-related features)
- Cross-context review data access requires explicit ports — no direct DB queries from other contexts
- Property import refactor from `integration` to `property` is a non-trivial move with existing tests

### Risks

- If a future platform (TripAdvisor, Yelp) has fundamentally different sync mechanics, the review context may need platform-specific strategy patterns — but the `review_platform` enum is extensible
- The facade port creates a runtime dependency: review context fails if integration's adapter throws. This is acceptable — without Google connectivity, reviews can't sync regardless
