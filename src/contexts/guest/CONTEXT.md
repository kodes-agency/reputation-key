# Guest Context

## Bounded context

Guest-facing interactions on public portal pages. Covers scan tracking, star ratings, feedback submission, and review-link click tracking.

## Glossary

- **Guest** — A person visiting a public portal page to rate their experience. Unauthenticated — no login required.
- **ScanEvent** — A recorded visit to a public portal page, captured on page load with `source` attribution (`qr`, `nfc`, `direct`). Tracks `portalId`, `propertyId`, timestamp.
- **Rating** — A 1–5 star rating submitted by a guest for a specific portal visit. NOT the same as Review Rating (review context, public/platform rating).
- **Feedback** — Optional free-text comment (max 1000 chars) submitted alongside a rating. Private — only visible to property staff.
- **ReviewLinkClick** — A tracked click on an external review link (e.g., Google review link) from a public portal page.
- **Source** — How the guest arrived at the portal: `qr` (QR code scan), `nfc` (NFC tap), or `direct` (typed URL).

## Relationships

- A **Guest** visit produces a **Scan Event** on page load
- A **Guest** submits a **Rating** by interacting with the star widget on a portal page
- A **Rating** is always followed by review links and a **Feedback** form
- A **Review Link** click is tracked via a redirect endpoint
- All guest interactions are tied to a **Session Cookie** (no PII)
- **Smart Routing** affects the visual emphasis of the **Feedback** form based on the **Rating** value
- **Anti-Gating** compliance ensures review links are always visible and identically positioned regardless of **Rating**
- Guest context **depends on** `PortalPublicApi` for portal resolution and public portal data.
- Guest context **depends on** `StaffPublicApi` for referral code resolution (scan attribution).

## Invariants

- Rating must be an integer 1–5 (`validateRating`). Non-integer or out-of-range values are rejected.
- Feedback text: max 1000 characters, non-empty after trim (`validateFeedback`).
- Scan source must be one of `qr`, `nfc`, `direct` (`validateSource`).
- Session cookie (24h `HttpOnly`, `guest_session`) prevents duplicate ratings within the same session.
- **Anti-gating**: Review links must always be visible and identically positioned regardless of rating value. No hiding, reordering, or visual deprioritization based on rating.
- IP hash (SHA-256 with daily-rotating salt) is used for abuse detection only — not for identity.

## Events produced

- **`guest.scan.recorded`** — scanId, organizationId, portalId, propertyId, source, occurredAt.
- **`guest.rating.submitted`** — ratingId, organizationId, portalId, propertyId, value, occurredAt.
- **`guest.feedback.submitted`** — feedbackId, organizationId, portalId, propertyId, ratingId, occurredAt.
- **`guest.review_link.clicked`** — linkId, organizationId, portalId, propertyId, occurredAt.

## Events consumed

None. Guest context does not subscribe to events from other contexts.

## Architecture layers

```
guest/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             guest-interaction.repository.ts, portal-context-resolver.port.ts,
                       public-portal-lookup.port.ts
    dto/               rating.dto.ts, feedback.dto.ts, public-portal.dto.ts
    use-cases/         record-scan.ts, submit-rating.ts,
                       submit-feedback.ts, track-review-link-click.ts,
                       resolve-link-and-track.ts, resolve-portal-context.ts,
                       get-public-portal.ts
    public-api.ts      re-exports domain types, event types/constructors
  infrastructure/
    repositories/      guest-interaction.repository.ts
    mappers/           guest.mapper.ts
    resolvers/         portal-context-resolver.ts, public-portal-lookup.ts
  server/              public.ts
  build.ts             composition root
```

## Use cases

- **`recordScan`** — Record a scan event (no referral attribution).
- **`submitRating`** — Submit a 1–5 star rating, emit `guest.rating.submitted`.
- **`submitFeedback`** — Submit free-text feedback after rating, emit `guest.feedback.submitted`.
- **`trackReviewLinkClick`** — Track a review link click, emit `guest.review_link.clicked`.
- **`resolveLinkAndTrack`** — Resolve a portal link URL and track the click in one operation.
- **`resolvePortalContext`** — Resolve org + property from portal ID.
- **`getPublicPortal`** — Fetch full public portal data for guest-facing rendering.

## Public API

Exported from `application/public-api.ts`:

- Types: `ScanEvent`, `Rating`, `Feedback`, `ScanSource`
- Event types: `GuestScanRecorded`, `GuestRatingSubmitted`, `GuestFeedbackSubmitted`, `GuestReviewLinkClicked`, `GuestEvent`
- Event constructors: `guestScanRecorded`, `guestRatingSubmitted`, `guestFeedbackSubmitted`, `guestReviewLinkClicked`

## Server functions

- **`public.ts`** — Guest-facing server functions (record scan, submit rating, submit feedback, track review link click, get public portal data). No authentication required — guest endpoints.

## Permissions

Guest context is entirely public — no authentication is required for any endpoint. All server functions are unauthenticated (`public` permission level).

- `scan:create` — Record a portal visit. Public.
- `rating:create` — Submit a star rating. Public.
- `feedback:create` — Submit feedback text. Public.
- `review_link:click` — Track a review link click. Public.
- `portal:read` — Read public portal data (name, description, links). Public.
- `feedback.read` — Reserved for future use (viewing feedback history).
- `feedback.respond` — Reserved for future use (responding to guest feedback).
