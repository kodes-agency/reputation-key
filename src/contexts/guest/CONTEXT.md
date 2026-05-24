# Guest Context

Guest-facing interactions on public portal pages. Covers scan tracking, star ratings, feedback submission, and review-link click tracking.

## Language

**Guest**:
A person visiting a public portal page to rate their experience and optionally leave feedback or a review.
_Avoid_: User, customer, visitor (too generic)

**Scan Event**:
A recorded visit to a public portal page, captured on page load with source attribution (qr, nfc, direct).
_Avoid_: Page view, impression, visit

**Rating**:
A 1–5 star value submitted by a guest after tapping the star widget on a portal page.
_Avoid_: Score, review, star rating (use "star rating" only when referring to the UI component)

**Feedback**:
Free-text commentary submitted by a guest after rating. Always shown regardless of rating value.
_Avoid_: Comment, review, complaint, suggestion

**Review Link**:
A link to an external review platform (Google, TripAdvisor, etc.) displayed on a portal page.
_Avoid_: External link, CTA, platform link

**Smart Routing**:
Layout emphasis strategy: for low ratings (≤ threshold), the feedback form is positioned higher or visually emphasized. Review links are always shown identically regardless of rating.
_Avoid_: Gating, filtering, steering

**Session Cookie**:
A short-lived (24h) `HttpOnly` cookie (`guest_session`) that ties guest interactions together without collecting PII.
_Avoid_: Auth session, user session, token

**IP Hash**:
SHA-256 hash of the guest's IP address with a daily-rotating salt. Used for abuse detection, not identity.
_Avoid_: IP address, fingerprint, device ID

**Anti-Gating**:
The policy that review links must never be hidden, reordered, or visually deprioritized based on rating value. Feedback is always available.
_Avoid_: Review gating, filtering, moderation

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

## Events produced

- **`scan.recorded`** — scanId, organizationId, portalId, propertyId, source, staffId, occurredAt.
- **`rating.submitted`** — ratingId, organizationId, portalId, propertyId, value, staffId, occurredAt.
- **`feedback.submitted`** — feedbackId, organizationId, portalId, propertyId, ratingId, staffId, occurredAt.
- **`review-link.clicked`** — linkId, organizationId, portalId, propertyId, staffId, occurredAt.

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
    use-cases/         record-scan.ts, record-scan-with-ref.ts, submit-rating.ts,
                       submit-feedback.ts, track-review-link-click.ts,
                       resolve-link-and-track.ts, resolve-portal-context.ts,
                       get-public-portal.ts, get-staff-id-for-session.ts
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
- **`recordScanWithRef`** — Record a scan event with referral code resolution via StaffPublicApi.
- **`submitRating`** — Submit a 1–5 star rating, emit `rating.submitted`.
- **`submitFeedback`** — Submit free-text feedback after rating, emit `feedback.submitted`.
- **`trackReviewLinkClick`** — Track a review link click, emit `review-link.clicked`.
- **`resolveLinkAndTrack`** — Resolve a portal link URL and track the click in one operation.
- **`resolvePortalContext`** — Resolve org + property from portal ID.
- **`getPublicPortal`** — Fetch full public portal data for guest-facing rendering.
- **`getStaffIdForSession`** — Resolve staff ID from session cookie for attribution.

## Public API

Exported from `application/public-api.ts`:

- Types: `ScanEvent`, `Rating`, `Feedback`, `ScanSource`
- Event types: `ScanRecorded`, `RatingSubmitted`, `FeedbackSubmitted`, `ReviewLinkClicked`, `GuestEvent`
- Event constructors: `scanRecorded`, `ratingSubmitted`, `feedbackSubmitted`, `reviewLinkClicked`

## Server functions

- **`public.ts`** — Guest-facing server functions (record scan, submit rating, submit feedback, track review link click, get public portal data). No authentication required — guest endpoints.

## Example dialogue

> **Dev:** "When a guest visits a portal, do we show the rating stars immediately or require a click first?"
> **Domain expert:** "Stars are visible and interactive on first load — no CTA step. Tapping a star submits the rating immediately."
>
> **Dev:** "Does the feedback form appear for all ratings or only low ones?"
> **Domain expert:** "Always shown. Smart routing only changes its visual emphasis — low ratings get the feedback form positioned higher."
>
> **Dev:** "Can a guest rate the same portal twice?"
> **Domain expert:** "Not within the same session. The session cookie prevents duplicate ratings."

## Flagged ambiguities

- "Review" refers to external platform reviews (Google, TripAdvisor), not internal ratings or feedback. Internal concepts are **Rating** and **Feedback**.
- "Smart routing" does NOT hide or filter anything — it only affects visual emphasis of the feedback form. This is critical for anti-gating compliance.
- "Session" refers to the guest session cookie, not an authenticated user session.
