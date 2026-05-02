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
