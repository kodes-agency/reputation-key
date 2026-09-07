# Integration — Context

**Audience:** Developers and agents working in `src/contexts/integration/`.

## Responsibility

Owns Google OAuth connections, governed provider access, opaque property-import
discovery, the durable v2 import lifecycle, live Business Profile Performance
retrieval, and Pub/Sub subscription management.

## Boundaries

- Property state changes cross only `PropertyGoogleBindingPublicApi`; Integration
  does not construct or insert Property entities directly.
- Browser DTOs and durable events never expose provider account/location
  identifiers. Access tokens are encrypted at rest and never logged.
- Browser consumers use the Integration public API for provider-content clearing,
  view-epoch guards, stale-completion outcomes, and expiry delays; feature
  components do not redefine that policy.
- Performance data is live-only and Property-scoped; the base Dashboard does not
  depend on provider availability.
- Organization export answers what state the Integration is in, never what Google
  told RepKey. Export and lifecycle contributors stay outside `publicApi`.

## Model

A GoogleConnection owns encrypted credentials and the verified Google OIDC
subject. Discovery normalizes bounded provider pages behind opaque HMAC handles
for at most 24 hours. A confirmed import creates one durable saga, stable child
batches of at most 100, and per-location checkpoints. The saga is the
browser-visible job; child batches are worker checkpoints.

A Property Google binding remains Property-owned. Business Profile Performance is
returned with source/retrieval metadata and never persisted.

## Runtime

Provider calls require a current connection, capability approval, execution
permit, quota admission, and generation checks. OAuth exchange, refresh, revoke,
notification, import, Review fallback, and recovery execute through governed
routes. Durable outbox dispatch is always on; worker boot fails when delivery
dependencies are unavailable.

The callback preserves one encrypted provider response behind a leased,
server-generated exchange-attempt identifier. Refresh uses a renewable Redis
single-flight lease and credential-generation compare-and-swap. Disconnect erases
the local binding before gateway dispatch and reconciles ambiguous outcomes
without resending the token.

## Invariants

1. Import discovery data is bounded per provider page and by a 24-hour absolute deadline. It is stored behind opaque HMAC handles; normalized rows grow linearly without a fleet-total cap and expired rows are swept.
2. A confirmed selection has no product-level 100-item cap. One transaction persists the replay-safe saga root, every stable child batch, every item checkpoint, and one identifier-only dispatch fact per child batch.
3. Browser status, retry, and cancellation address the saga root. Partial child completion remains visible rather than being rewritten as all-or-nothing success.
4. Every credential-bearing Google operation executes in this deployment; there is no credential home or routing directory.
5. Discovery reads Google's output-only `metadata.newReviewUri`, validates it against the approved HTTPS Google-host policy, and hands it to the Property binding effect. It is never manually entered by an administrator.
6. Production credential-bearing Google adapters have no direct-socket escape hatch. OAuth exchange/refresh/revoke, legacy account lookup, notifications, and Review fallbacks fail before network access unless a governed executor owns the route; fixed-origin JWKS retrieval is the only current non-credential direct trust read.
7. `GOOGLE_PROVIDER_EGRESS_INVENTORY` is the exhaustive executable authority for every provider route, credential class, fixed production origin, transport, owner, recovery rule, and current repository activation state. A new route cannot compile without an explicit inventory decision.
8. The browser can supply only the one-use code and opaque state; it never supplies PKCE verifier or token material to a general server function.
9. A bound callback replay carries no code verifier and can only claim that preserved response; it never re-exchanges the provider code. Claims use a 30-second lease, ciphertext expires after ten minutes, and every terminal path erases it. The five-minute provider-recovery sweep bounds abandoned ciphertext retention and records an unpreserved started exchange as ambiguous.
10. Provider success, provable not-sent, and ambiguous outcomes commit with local token/subject redaction; an elapsed attempt reconciles the linked permit and never sends the token again. The attempt window is 60 seconds and the same five-minute sweep bounds crash recovery. Neither route may fall back to a direct credential socket.
11. Coordination ambiguity denies the refresh before credential decryption or database mutation.
12. Lifecycle `prepareClosing` stops provider effects and deletes nothing. `verifyPurgeReadiness` is read-only and fails closed while credential, work, attempt, operation, or discovery evidence remains live.
13. An Organization that never connected Google answers `no_data` — affirmative evidence, never an omitted contributor.

## Verification

Unit tests stay beside OAuth, connection, view-lifecycle, import, Performance,
provider-route, worker, and public-boundary subjects. PostgreSQL integration tests
cover exchange preservation, permits, generations, sagas, cancellation, replay,
closure, export, and purge. Redis tests cover renewable refresh leadership,
ownership proof, backoff, and ambiguity denial. Executable inventory tests pin
every production provider route and forbid direct credential sockets.
