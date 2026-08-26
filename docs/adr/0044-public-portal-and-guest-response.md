# ADR 0044 — Public Portal and Guest Response Policy

**Status:** Accepted
**Date:** 2026-07-15

## Context

The existing public portal creates guest sessions client-side, accepts unsigned cookies, trusts raw `X-Forwarded-For`, records scans on page mount (inflated by refresh/bots), and allows review-link visibility to drift toward conditional feedback logic (review gating).

## Decision

The public portal is a **review-link touchpoint first**. Private rating/feedback is optional, separately controlled, and must never steer, gate, hide, reorder, or emphasize the review link.

### Independent capabilities

`public_portal`, `private_response`, `free_text`, `guest_contact`, `guest_media` are independently governed. An independently governed capability is not necessarily promotable: `guest_contact` and `guest_media` are beta-blocked until their separate activation evidence is accepted.

### Contact Request separation (2026-08-26 clarification)

1. A Contact Request is a separate aggregate and table linked to an exact Guest Response scope. Rating and Feedback models cannot carry contact or contact consent fields.
2. The only accepted first shape is a valid email plus an optional name for `manager_follow_up`. Consent defaults false and must be explicitly true; purpose is explicit; phone is excluded.
3. Contact material is encrypted with a versioned key and scope-bound authenticated data. It expires exactly 30 days after submission; logical reads enforce the deadline before bounded physical cleanup.
4. Ordinary reads are masked. Plaintext is available only through an audited just-in-time command that rechecks the Portal creator, current Portal responsible-manager assignments, or current AccountAdmin membership. A PropertyManager also needs current access to the exact Property; being an unrelated Property Manager is insufficient.
5. Withdrawal and whole-response termination clear the encrypted material atomically. Purge uses serialized checkpoint evidence but never trusts the checkpoint to exclude otherwise eligible rows.
6. Contact values never enter facts/events, logs, notifications, analytics, Inbox/search fields, AI inputs, or activity payloads.
7. No route, server function, component, worker, schedule, or public API activates Contact Request. `portal.guest_contact` is blocked until named approval evidence covers the guest notice, retention wording, manager handling, and delivery channel.

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
- Contact Request is intentionally not part of that aggregate and has a shorter, separately enforced lifecycle.
- Cookie notice must not claim anonymity when session identifiers, network signals, or free text are stored.

## Rejected Alternatives

- **Client-side session** — guest can rotate identity and evade per-session controls; cookie is not trustworthy.
- **Rating-conditioned review link visibility** — prohibited review gating.
