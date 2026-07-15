# ADR 0044 — Public Portal and Guest Response Policy

**Status:** Accepted
**Date:** 2026-07-15

## Context

The existing public portal creates guest sessions client-side, accepts unsigned cookies, trusts raw `X-Forwarded-For`, records scans on page mount (inflated by refresh/bots), and allows review-link visibility to drift toward conditional feedback logic (review gating).

## Decision

The public portal is a **review-link touchpoint first**. Private rating/feedback is optional, separately controlled, and must never steer, gate, hide, reorder, or emphasize the review link.

### Independent capabilities

`public_portal`, `private_response`, `free_text`, `guest_contact`, `guest_media` — each independently enableable.

### Token and session

1. Public URL uses a high-entropy random token; store a keyed hash, not the raw token.
2. Token rotation supports a grace period for printed codes and explicit revocation.
3. Sessions are server-issued, signed, `Secure`, `HttpOnly`, appropriately scoped `SameSite`.
4. Client-side session creation is removed.

### Anti-gating rule

Review destination visibility, ordering, wording, and prominence are **invariant** across guest response values and states. This is enforced by architectural test.

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
