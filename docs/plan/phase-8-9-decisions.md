# Phase 8 & 9 — Decision Log

**Date:** 2026-05-02
**Session:** Grilling session for Phase 8 (Public portal pages + scan tracking) and Phase 9 (Rating, smart routing, feedback)

---

## Architecture Decisions

### A1. Guest Context Boundary

**Decision:** `contexts/guest/` owns everything guest-facing — scans, ratings, feedback, and review-link clicks. No separate feedback context.
**Reasoning:** Feedback is a guest action, not a separate domain concept. Manager-facing inbox (Phase 11) consumes guest events, doesn't own feedback.

### A2. DB Schema Organization

**Decision:** Single `src/shared/db/schema/guest.schema.ts` for all three tables (`scan_events`, `ratings`, `feedback`).
**Reasoning:** Consistent with `portal.schema.ts` pattern — Drizzle needs a single barrel.

### A3. Denormalized ID Columns

**Decision:** All guest tables carry three ID columns: `portal_id`, `organization_id`, `property_id`.
**Reasoning:** Follows established pattern in portal schema. Query efficiency over normalization purity. Org-level and property-level analytics avoid JOINs.

### A4. No Server-Side Session Table

**Decision:** Session cookie value is the key. No server-side session storage.
**Reasoning:** Simpler, no lifecycle management. Duplicate detection done by querying `ratings` table for `session_id + portal_id`.

### A5. Event Publishing

**Decision:** Fire-and-forget after DB write. Event publishing failure does NOT roll back DB write.
**Reasoning:** Events are eventual consistency. DB write is the source of truth.

### A6. Submission Method Split

**Decision:** Server functions for rating and feedback submission. API route for review-link click tracking (redirect).
**Reasoning:** Server functions are type-safe end-to-end and integrate with TanStack Form. Click tracking needs HTTP redirect semantics, which server functions don't handle cleanly.

### A7. QR Code Endpoint

**Decision:** API route `GET /api/portals/:id/qr`, authenticated only. Uses `qrcode` npm package server-side.
**Reasoning:** File downloads are cleaner as API routes (binary response, `Content-Disposition` headers). Server functions serialize to JSON by default and fight the framework for file downloads.

### A8. Public Route Structure

**Decision:** Explicit file route `src/routes/p/$orgSlug/$portalSlug.tsx` with loader calling a public server function.
**Reasoning:** Keeps routing explicit and auth boundary clear. Public server function lives in `contexts/portal/server/` with no auth middleware.

---

## Domain Decisions

### D1. Landing Page Layout Order

**Decision:** Hero image → organization/property name → description → star rating (interactive) → link tree.
**Reasoning:** Stars are the primary CTA. Link tree is secondary content.

### D2. Star Rating Behavior

**Decision:** Stars visible and interactive on first load. Disabled after submission with confirmation message. Rated state persists on return (session-based).
**Reasoning:** Zero friction — tapping is the commit. Disabled state prevents accidental double-submissions. Persistence avoids confusing returning guests.

### D3. Post-Rating UX

**Decision:** In-place update (no navigation). Review links always shown. Feedback form always shown. Link tree remains visible below.
**Reasoning:** Smoother UX than navigation. Anti-gating compliance requires review links to always be visible. Keeping link tree maintains page context.

### D4. Smart Routing Redefined

**Decision:** Feedback form is ALWAYS shown regardless of rating value. Smart routing only changes visual emphasis — for low ratings (≤ threshold), feedback form is positioned higher or visually emphasized.
**Reasoning:** Stronger anti-gating compliance. Nothing is hidden or shown conditionally. Only emphasis changes.

### D5. Feedback Content

**Decision:** Free-text only (max 1000 chars). No categories. AI auto-categorization planned for Arc 7.
**Reasoning:** Guest-selected categories are inconsistent and redundant once AI categorization arrives. Simpler form, cleaner data.

### D6. Feedback Form Fields

**Decision:** Textarea + honeypot field (hidden, catches bots) + hidden timestamp field (velocity check). No name, email, or phone.
**Reasoning:** Fully anonymous beyond session cookie. Spam protection without PII collection.

### D7. Feedback Submission Response

**Decision:** Inline confirmation message replacing the form. No page navigation.
**Reasoning:** Keeps guest on the page, review links remain accessible.

### D8. Scan Event Timing

**Decision:** Recorded on page load, server-side in the route loader.
**Reasoning:** More reliable than client-side. Works without JS. Captures scan before any interaction.

### D9. Scan Source Detection

**Decision:** URL parameter `?source=qr|nfc|direct` appended by the medium. QR codes encode with `?source=qr`, NFC tags with `?source=nfc`. Direct visits default to `direct`.
**Reasoning:** Simple, explicit, server-readable.

### D10. Rating Anonymity

**Decision:** Session-tied via `guest_session` cookie. No PII collected.
**Reasoning:** Enables duplicate prevention and conversion tracking without collecting personal data.

---

## Security & Compliance Decisions

### S1. Session Cookie Configuration

**Decision:**

- Name: `guest_session`
- Value: UUID
- `HttpOnly: true`
- `SameSite: Lax`
- `Secure: true`
- `Max-Age: 86400` (24 hours)
- `Path: /p/`

**Reasoning:** Prevents XSS theft, allows top-level navigation, HTTPS-only, scoped to public portal routes.

### S2. IP Hashing Strategy

**Decision:** SHA-256 with daily-rotating salt derived from `date + env.SALT`. Store only the hash, never raw IP.
**Reasoning:** Same-day deduplication possible. Cross-day unlinkability. GDPR compliant (no persistent PII). Separate purpose from session cookie — catches abuse when cookies are cleared.

### S3. Rate Limits (Tiered)

**Decision:**

- `POST /api/public/scan` — 10 req/min per IP
- `POST /api/public/rating` — 5 req/min per session
- `POST /api/public/click` — 30 req/min per session
- `GET /p/{orgSlug}/{portalSlug}` — no rate limit

**Reasoning:** Different endpoints have different abuse profiles. Page views shouldn't be rate-limited.

### S4. Anti-Gating Compliance

**Decision:** Review links are NEVER hidden, reordered, or visually deprioritized based on rating value. Feedback form is always shown. Smart routing only changes emphasis.
**Reasoning:** Google policy prohibits review gating. This approach is maximally compliant.

### S5. Cookie Consent Banner

**Decision:** Custom banner using shadcn primitives. Transparency notice, not a functional gate. Session cookie is strictly necessary and set regardless of consent.
**Reasoning:** Session cookie is needed for the rating flow to work. Banner serves as transparency/compliance notice.

### S6. Click Tracking Pattern

**Decision:** API redirect endpoint. Links point to `/api/public/click/:linkId`, endpoint records click, then redirects to actual review URL.
**Reasoning:** Works without JS, no race condition, tamper-resistant (URL resolved server-side).

---

## Implementation Decisions

### I1. Branded IDs

**Decision:** `ScanEventId`, `RatingId`, `FeedbackId` added to `src/shared/domain/ids.ts` with constructors.
**Reasoning:** Consistent with existing pattern. Prevents accidental ID substitution.

### I2. Guest Context Events

**Decision:** Four events: `scan.recorded`, `rating.submitted`, `feedback.submitted`, `review-link.clicked`.
**Reasoning:** Covers all guest interactions. Other contexts can subscribe.

### I3. Guest Context Use Cases

**Decision:** Four: `recordScan`, `submitRating`, `submitFeedback`, `trackReviewLinkClick`.
**Reasoning:** One use case per guest action.

### I4. Guest Context Repository

**Decision:** Single `GuestInteractionRepository` port and implementation.
**Reasoning:** All guest interactions are write operations. Simpler than separate repos per entity.

### I5. Domain Errors

**Decision:** Six errors: `InvalidRatingError`, `DuplicateRatingError`, `FeedbackTooLongError`, `FeedbackEmptyError`, `PortalNotFoundError`, `RateLimitExceededError`.
**Reasoning:** Covers all failure modes in the guest flow.

### I6. Validation Rules

**Decision:** Four validators: `validateRating`, `validateFeedback`, `validateSource`, `validateSessionCookie`.
**Reasoning:** Pure functions, aggressively testable.

### I7. Star Rating Component

**Decision:** Custom radio-based component. Visually hidden radios styled as stars. Keyboard navigation, screen reader support, 44x44px touch targets.
**Reasoning:** Native accessibility. No library dependency. Consistent with shadcn patterns.

### I8. Data Loading

**Decision:** TanStack Start loader in route file calls public server function `getPublicPortal(orgSlug, portalSlug)`. Server function lives in `contexts/portal/server/public.ts`. No auth required.
**Reasoning:** SSR-friendly, type-safe, clean auth boundary.

### I9. Theming

**Decision:** Portal theme applied to public page via CSS custom properties on wrapper element. Default theme fallback if portal theme not set.
**Reasoning:** Branded experience per portal. Graceful degradation.

### I10. Error Handling

**Decision:**

- Portal not found → clean 404 page
- Rating fails → inline error, stars re-enabled for retry
- Feedback fails → inline error, form data preserved
- Scan fails → silent failure
- Rate limit → generic "Too many requests" message

**Reasoning:** Don't disrupt guest experience for analytics failures. Clear recovery paths for user-facing errors.

### I11. File Structure

```
src/contexts/guest/
  domain/
    types.ts
    events.ts
    errors.ts
    rules.ts
    constructors.ts
  application/
    ports/
      guest-interaction.repository.ts
    dto/
      rating.dto.ts
      feedback.dto.ts
    use-cases/
      record-scan.ts
      submit-rating.ts
      submit-feedback.ts
      track-review-link-click.ts
  infrastructure/
    repositories/
      guest-interaction.repository.ts
    mappers/
      guest.mapper.ts
  server/
    public.ts
```

### I12. Testing Strategy

**Decision:**

- Unit tests for domain rules and validators
- Integration tests for use cases (in-memory fakes)
- Repository tests (real test DB)
- Single E2E smoke test: visit → rate → see links → submit feedback → verify recorded
- Skip exhaustive anti-gating compliance tests for now

**Reasoning:** Covers core logic without over-engineering. Anti-gating tests deferred.

---

## Schema Definitions

### `scan_events`

| Column          | Type         | Notes                     |
| --------------- | ------------ | ------------------------- |
| id              | uuid         | PK, defaultRandom         |
| organization_id | varchar(255) | Denormalized              |
| portal_id       | uuid         | FK → portals.id           |
| property_id     | varchar(255) | Denormalized              |
| source          | varchar(10)  | 'qr', 'nfc', 'direct'     |
| session_id      | varchar(255) | From guest_session cookie |
| ip_hash         | text         | SHA-256 + daily salt      |
| created_at      | timestamptz  |                           |

### `ratings`

| Column          | Type         | Notes                           |
| --------------- | ------------ | ------------------------------- |
| id              | uuid         | PK, defaultRandom               |
| organization_id | varchar(255) | Denormalized                    |
| portal_id       | uuid         | FK → portals.id                 |
| property_id     | varchar(255) | Denormalized                    |
| session_id      | varchar(255) | From guest_session cookie       |
| value           | integer      | 1-5                             |
| source          | varchar(10)  | 'qr', 'nfc', 'direct'           |
| ip_hash         | text         | SHA-256 + daily salt            |
| created_at      | timestamptz  |                                 |
|                 |              | Unique: (session_id, portal_id) |

### `feedback`

| Column          | Type         | Notes                     |
| --------------- | ------------ | ------------------------- |
| id              | uuid         | PK, defaultRandom         |
| organization_id | varchar(255) | Denormalized              |
| portal_id       | uuid         | FK → portals.id           |
| property_id     | varchar(255) | Denormalized              |
| session_id      | varchar(255) | From guest_session cookie |
| rating_id       | uuid         | FK → ratings.id, nullable |
| comment         | text         | Max 1000 chars            |
| source          | varchar(10)  | 'qr', 'nfc', 'direct'     |
| ip_hash         | text         | SHA-256 + daily salt      |
| created_at      | timestamptz  |                           |

---

## Phase Deliverables

### Phase 8 — Public Portal Pages & Scan Tracking

1. `src/routes/p/$orgSlug/$portalSlug.tsx` — public route with loader
2. Public server function `getPublicPortal` in `contexts/portal/server/public.ts`
3. Portal page: hero → name → description → stars → link tree
4. `recordScan` use case, called from loader
5. `scan_events` table (Drizzle schema + migration)
6. `guest_session` cookie middleware
7. Cookie consent banner component (shadcn-based)
8. QR code API route `GET /api/portals/$id/qr` (authenticated)
9. Rate limiting on public endpoints
10. SEO/OG tags on public pages
11. Anti-gating compliance rules (pure functions)
12. Error handling (404 page, inline errors)

### Phase 9 — Rating, Smart Routing & Feedback

1. Star rating component (custom, radio-based, accessible)
2. `submitRating` server function + use case
3. `ratings` table (Drizzle schema + migration)
4. `submitFeedback` server function + use case
5. `feedback` table (Drizzle schema + migration)
6. Feedback form component (textarea + honeypot + timestamp)
7. Smart routing: feedback emphasis based on rating value
8. `trackReviewLinkClick` API redirect route
9. Spam protection (honeypot, velocity check, session rate limiting)
10. Events: `rating.submitted`, `feedback.submitted`, `review-link.clicked`
11. Rated state persistence (session-based check on page load)
12. E2E smoke test for guest portal flow

---

## Domain Docs Created

- `CONTEXT-MAP.md` — context map with all 12 contexts and relationships
- `src/contexts/guest/CONTEXT.md` — guest context glossary, relationships, example dialogue
