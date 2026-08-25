# Guest Context

## Bounded context

Guest-facing interactions on public portal pages. Covers scan tracking, star ratings, feedback submission, and review-link click tracking.

## Glossary

- **Guest** — A person visiting a public portal page to rate their experience. Unauthenticated — no login required.
- **ScanEvent** — A recorded visit to a public portal page, captured on page load with `source` attribution (`qr`, `nfc`, `direct`). Tracks `portalId`, `propertyId`, timestamp.
- **Rating** — A 1–5 star rating submitted by a guest for a specific portal visit. NOT the same as Review Rating (review context, public/platform rating).
- **Feedback** — Optional free-text note (max 2,000 characters) submitted only after an eligible private rating. It is private and routed to the managers responsible for the Portal.
- **Google Review Selection** — The post-rating choice to open the Property-owned Google review destination. It is offered with identical order and prominence for all five ratings and is recorded as core analytics.
- **Qualified Link Action** — An explicit post-render, origin/CSRF/session-bound mutation for a destination classified as `google_review` or `secondary_link`. A redirect GET is navigation only and never increments it.
- **Source** — How the guest arrived at the portal: `qr` (QR code scan), `nfc` (NFC tap), or `direct` (typed URL).

## Relationships

- A **Guest** visit produces a **Scan Event** on page load
- A **Guest** submits a **Rating** by interacting with the star widget on a portal page
- A **Rating** is always followed first by the same Google Review Action. An eligible rating may then add private feedback; secondary links follow both.
- A destination action is tracked through an explicit mutation; the redirect GET remains an untracked no-JavaScript/failure fallback.
- All guest interactions are tied to a **Session Cookie** (no PII)
- The Portal's inclusive threshold is snapshotted with the initial rating. Rating corrections may unlock feedback but never erase feedback already submitted.
- **Anti-discouragement** compliance ensures the Google Review Action has identical copy, order, timing, and prominence for every rating.
- Guest context **depends on** `PortalPublicApi` for portal resolution and public portal data.
- Notification consumes Guest's content-free `findPortalIdForFeedback` public API; Guest retains ownership of canonical and legacy response attribution.

## Invariants

- Rating must be an integer 1–5 (`validateRating`). Non-integer or out-of-range values are rejected.
- The initial response command requires a private rating and cannot carry text. Eligible private feedback is a separate atomic command, max 2,000 characters and non-empty after trim.
- Scan source must be one of `qr`, `nfc`, `direct` (`validateSource`).
- Session cookie (24h `HttpOnly`, `guest_session`) prevents duplicate ratings within the same session.
- **Anti-discouragement**: after a durable rating, Google is always first and identical for values 1–5. Private feedback is additive, never an alternative, prerequisite, delay, or replacement for Google.
- If the Property-owned Google destination degrades after publication, the same first post-rating position shows gentle unavailable copy for every rating. Private feedback and secondary links remain usable, and no stale Google URI reaches the browser.
- The guest-facing response view is a receipt: private feedback text, canonical response/session IDs, tenant/provider IDs, category IDs, and internal consent fields are never returned to the browser after submission.
- For 24 hours after private-feedback submission, the same signed session may withdraw only that feedback. The command purges text/contact, emits `guest.feedback.retracted`, and leaves the private rating and its lineage intact. A content-free withdrawal tombstone prevents resubmission.
- For 24 hours after the initial rating, the same signed session may instead withdraw the entire response. That terminal command retracts rating and any still-effective feedback, purges content, and schedules media deletion.
- The first action per signed session, Portal, kind, and destination commits a 24-hour dedupe receipt and content-free durable fact atomically. Duplicate/replayed actions emit no second fact; Redis is abuse control, not correctness authority.
- Guest media is hard-blocked for the first beta cohort and has no public issuance or confirmation entry point. Existing rows remain available only for audit/purge compatibility.
- IP hash (SHA-256 with daily-rotating salt) is used for abuse detection only — not for identity.

## Events produced

- **`guest.scan.recorded`** — scanId, organizationId, portalId, propertyId, source, occurredAt.
- **`guest.rating.submitted`** — ratingId, organizationId, portalId, propertyId, value, occurredAt. Produced by `responseLifecycle.submit` when the guest consented to share a rating.
- **`guest.rating.retracted`** — ratingId, scope identifiers, superseded source-event id, and occurredAt. Produced atomically when a correction removes consent/value or the guest withdraws the response.
- **`guest.feedback.submitted`** — feedbackId, organizationId, portalId, propertyId, ratingId, occurredAt. Produced by the separate eligible private-feedback command without consuming the one rating correction.
- **`guest.feedback.retracted`** — feedbackId, scope identifiers, superseded source-event id, and occurredAt. It corrects the feedback-count projection and closes related Inbox work without carrying text/contact.

The canonical response stores the currently effective rating/feedback source-event ids. Corrections and withdrawals commit their state transition and every replacement/retraction fact in one transaction. Missing historical lineage fails closed rather than adding a second reading or leaving a stale one.

- **`guest.review_link.clicked`** — linkId, destinationKind, organizationId, portalId, propertyId, occurredAt. Legacy facts without a kind decode as `secondary_link`; new Google selections are explicit.

## Events consumed

None. Guest context does not subscribe to events from other contexts.

## Architecture layers

```
guest/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             guest-interaction.repository.ts, portal-context-resolver.port.ts,
                       public-portal-lookup.port.ts
    dto/               public-portal.dto.ts
    use-cases/         record-scan.ts, guest-response-lifecycle.ts,
                       track-review-link-click.ts, resolve-link-and-track.ts,
                       resolve-portal-context.ts, get-public-portal.ts
    public-api.ts      re-exports domain types, event types/constructors
  infrastructure/
    repositories/      guest-interaction.repository.ts
    feedback-portal-attribution.ts  tenant-scoped, content-free source lookup
    mappers/           guest.mapper.ts
    resolvers/         portal-context-resolver.ts, public-portal-lookup.ts
  server/              public.ts, guest-scans.ts
  build.ts             composition root
```

## Use cases

- **`recordScan`** — Record a scan event (no referral attribution).
- **`responseLifecycle`** — Submit the required private rating, add eligible private feedback, withdraw only that feedback within 24 hours, correct the rating once, and withdraw/moderate the aggregate. State and content-free facts commit atomically.
- **`trackReviewLinkClick`** — Atomically commit the short-lived classified action receipt and `guest.review_link.clicked`; persistence failure is reported but never blocks an approved navigation.
- **`resolveLinkAndTrack`** — Resolve a token-owned Portal link. It tracks only when the explicit POST edge supplies a qualified signed session; calls from the redirect GET resolve without analytics.
- **`resolvePortalContext`** — Resolve org + property from portal ID.
- **`getPublicPortal`** — Fetch full public portal data for guest-facing rendering.

## Public API

Exported from `application/public-api.ts`:

- Types: `ScanEvent`, `Rating`, `Feedback`, `ScanSource`
- Cross-context API: `findPortalIdForFeedback(organizationId, feedbackId)` returns only the source `PortalId` (or null), with canonical-response precedence and legacy-read compatibility.
- Event types: `GuestScanRecorded`, `GuestRatingSubmitted`, `GuestRatingRetracted`, `GuestFeedbackSubmitted`, `GuestFeedbackRetracted`, `GuestReviewLinkClicked`, `GuestEvent`
- Event constructors: `guestScanRecorded`, `guestRatingSubmitted`, `guestRatingRetracted`, `guestFeedbackSubmitted`, `guestFeedbackRetracted`, `guestReviewLinkClicked`

## Server functions

- **`public.ts`** — Guest-facing origin/CSRF/signed-session mutations for rating, feedback submission/withdrawal, Google selection, secondary-link selection, rating correction, and whole-response withdrawal.
- **`guest-scans.ts`** — Visit recording, public Portal read, and the navigation-only secondary-link resolver.

## Permissions

Guest context is entirely public — no authentication is required for any endpoint. All server functions are unauthenticated (`public` permission level). These are logical operation identifiers for tracing/auditing only. All guest endpoints are unauthenticated (public by design). No `can()` enforcement exists because guest context has no auth middleware.

- `scan:create` — Record a portal visit. Public.
- `rating:create` — Submit a star rating. Public.
- `feedback:create` — Submit feedback text. Public.
- `review_link:click` — Track a review link click. Public.
- `portal:read` — Read public portal data (name, description, links). Public.
- `feedback.read` — Reserved for future use (viewing feedback history).
- `feedback.respond` — Reserved for future use (responding to guest feedback).
