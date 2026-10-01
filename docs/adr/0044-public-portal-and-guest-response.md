---
status: accepted
date: 2026-07-15
---

# 0044 — Public Portal and Guest Response Policy

## Context

The existing public portal creates guest sessions client-side, accepts unsigned cookies, trusts raw `X-Forwarded-For`, records scans on page mount (inflated by refresh/bots), and allows review-link visibility to drift toward conditional feedback logic (review gating).

## Decision

The public portal is a **review-link touchpoint first**. Private rating/feedback is optional, separately controlled, and must never steer, gate, hide, reorder, or emphasize the review link.

### Independent capabilities

`public_portal`, `private_response`, `free_text`, `guest_contact`, `guest_media` are independently governed. An independently governed capability is not necessarily promotable: `guest_contact` and `guest_media` are beta-blocked until their separate activation evidence is accepted.

### Token and session

1. Public URL uses a high-entropy random token; store a keyed hash, not the raw token.
2. Token rotation supports a grace period for printed codes and explicit revocation.
3. Sessions are server-issued, signed, `Secure`, `HttpOnly`, appropriately scoped `SameSite`.
4. Client-side session creation is removed.

### Anti-gating rule

Review destination visibility, ordering, wording, and prominence are **invariant** across guest response values and states. This is enforced by architectural test:
`src/components/features/guest/public-portal/guest-page-view.test.ts` renders the guest page for ratings 1–5, with and without the private-note card, and in the note-writing, done, withdrawn-note and correcting states, in English and Bulgarian. It does so on both paths a guest can reach: a controlled preview state, and the live public container that binds the response session (`PublicPortalContent`). It requires the Google card to have the same markup, position, heading, copy and accessible name every time, on every path.

The Immersive Hub (snapshot schema version 3) has its own response view, and `src/components/features/guest/public-portal/immersive/immersive-response.test.ts` holds it to the same rule on its own markup. It renders the receipt strip, the Google card and the note card for ratings 1–5 in English and Bulgarian, and requires the Google card to be identical and second at every rating, whether or not the note is offered, and the Google-unavailable card to take the same place. The view takes no rating comparison: the note appears only when the server sets `privateFeedbackEligible`, and the test pins that the view follows that flag (it shows the note card when the flag is set and hides it when it is not). The inclusive threshold boundary itself belongs to the server rule and is held by `src/contexts/guest/application/use-cases/guest-response-lifecycle.test.ts`.

### Abuse and privacy

1. Layered limits by portal, session, network signal, organization, and operation.
2. Idempotency keys for submit and correction; duplicates return existing result.
3. Public edge fails closed for submissions/uploads if the limiter/session dependency is unavailable. The static review-link page may remain available through a separate read path.
4. No arbitrary redirects; only allowlisted HTTPS provider URLs.

## Consequences

- Client-generated session cookies are removed.
- Raw `X-Forwarded-For` is replaced by trusted-proxy chain handling.
- Scan recording moves server-side with bot/link-preview filtering.
- Guest rating and feedback submit as one aggregate, not independent partial records.
- Cookie notice must not claim anonymity when session identifiers, network signals, or free text are stored.

## Rejected Alternatives

- **Client-side session** — guest can rotate identity and evade per-session controls; cookie is not trustworthy.
- **Rating-conditioned review link visibility** — prohibited review gating.

## Amendment 2026-10-01 — sealed address (ADR 0064)

"Token and session" decision 1 ("store a keyed hash, not the raw token") is
amended by [ADR 0064](0064-sealed-portal-address-and-download-again.md). Public
resolution still reads only the keyed hash. When a keyring is configured, the
raw address of an active code is also stored sealed (AES-256-GCM, bound to its
tenant, Portal, token and version) so a manager can download the code again;
every disclosure is recorded before it happens, and no other path reads the
sealed copy. Without a keyring this ADR's behaviour is unchanged.
