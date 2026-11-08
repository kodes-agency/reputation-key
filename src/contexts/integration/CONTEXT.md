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

`provider/google-client.server.ts` owns the shared provider-call stages: credential
liveness, request-bound permits, one refreshed 401 retry, response parsing and
error classification. The governed egress gateway performs fetch and Redis-backed
admission. Composition imports the provider construction helpers through `build.ts`.
Refresh reauthorizes the same scope and acquires a new permit; a refused
retry preserves the first call's answered evidence. Feature adapters retain their
provider schemas and product-specific error mappings.

## Model

A GoogleConnection owns encrypted credentials and the verified Google OIDC
subject. Discovery normalizes bounded provider pages behind opaque HMAC handles
for at most 24 hours. A confirmed import creates one durable saga, stable child
batches of at most 100, and per-location checkpoints. The saga is the
browser-visible job; child batches are worker checkpoints.

Each active item has a durable recovery appointment. The minute sweep reserves
at most 100 due items with `FOR UPDATE SKIP LOCKED` and advances their
appointments before attempting work. Pending redispatch preserves the dispatch
epoch; claim release, takeover and manual Retry advance it. Every acquired claim
spends one of the revision's five PostgreSQL-held attempts, independent of queue
delivery counts. Expired or exhausted work returns through the item processor
for receipt reconciliation and its existing follow-ups. Item failures defer
only that appointment and do not abort the page. An item past its effect deadline
ends as retryable `temporarily_unavailable`. Retry opens fresh discovery and asks
the manager to confirm the Google location again; confirmation creates a new import
with a new deadline rather than extending or executing the expired work. Before
the deadline, Retry preserves the existing revision and replay fences.

`infrastructure/google-import-authorization-snapshot.ts` owns the stored
authorization columns and reconstructs the frozen vector for item reads.

`infrastructure/google-import-completion.ts` owns every terminal transition,
including lifecycle and isolated restore. It locks the item before reading the
Property receipt through Property's transaction-aware API, fixes Review's history
cutoff before success, scrubs routing state and reduces parent counters in that
transaction. Receipt failures leave the recovery appointment intact.

Three independent `property.google_binding.changed` consumers initialize the
conditional public name, assert notification subscription desired state, and admit
initial review sync. Only facts explicitly marked for these follow-ups are eligible;
retained unmarked facts are acknowledged without repeating finished imports.
Before completing an unfinished item with a committed receipt, recovery asks
Property to preserve a marked fact in the same transaction. Existing marked facts
are reused; an unmarked fact's acknowledgements cannot settle the recovered work. Each
checks the current binding epoch. Failed effects leave
no acknowledgement. Review persists one initial run identity before enqueue and
acknowledges after its worker commits snapshot progress or records the terminal
retry schedule. Failed initial admissions reuse their run so binding redelivery
preserves Review's backoff, including the day-long cap pause. Binding facts with
missing acknowledgements remain retained after import completion and enter durable
outbox delivery even after exhausting the legacy redelivery budget. Failed
executions follow the delivery ledger's retry schedule and remain visible for
operator repair if quarantined.

A Property Google binding remains Property-owned. Business Profile Performance is
returned with source/retrieval metadata and never persisted.

Who asked for an import stays here. The import request rows are Integration's
alone, so the public API answers one identifier-only question about them:
`imports.findInitiator(organizationId, propertyId)` — the initiator of the
FIRST import that produced a Property, so a later relink does not take credit
for the history the original brought in. Feed addresses the import-finished
notice with it (ADR 0046, amended 2026-09-24). `null` is a normal answer: those
rows are purged 30 days after the import becomes terminal, and the notice falls
back to the Property's responsible managers.

All of `publicApi` is Integration's request surface (`docs/standards.md` §3.1):
`connections`, `oauth`, `imports` and `performance` are what Integration's
server functions and the Google OAuth callback route call. Its exceptions to
that section's rules:

- `oauth.getAuthorizationUrl` does not authorize its caller. Its one caller,
  the server function in `server/google-auth-url.ts`, asks the policy for
  `integration.manage` and passes the user, Organization and session it
  resolved.
- `oauth.redeemState`, `oauth.admitPreState` and `oauth.admitResolvedTenant`
  are edge controls of the callback, not commands: the state-handle redemption
  and the two abuse budgets, published as they are. The callback route
  (`src/routes/api/auth/google/callback.ts`) runs them before it calls
  `connections.connect` or `connections.resume`.
- `imports.findInitiator`, described above, is a store read published as it
  is and the one member another context reaches: the composition root fills
  Feed's import-initiator port from it. It takes no caller and answers by
  identifier only.

## Runtime

`application/google-import-command-authorizer.ts` reauthorizes import provider
calls against current membership and command authority after a credential refresh.
`application/google-authorization-vector.ts` owns vector construction and the
comparison that permits only the credential generation to change.

Provider calls require a current connection, capability approval, execution
permit, quota admission, and generation checks. Admission acquires Redis in-flight
capacity, then quota, then starts the permit; a refused permit keeps its quota
charge until the bucket refills. Admission and egress share a local handle
rather than a signed Redis grant.
Completion retries only bookkeeping and preserves the provider response; the
permit sweep and Redis lease expiry settle leftovers. OAuth exchange, refresh, revoke,
notification, import, Review fallback, and recovery execute through governed
routes. Durable outbox dispatch is always on; worker boot fails when delivery
dependencies are unavailable.

`domain/google-call-error.ts` owns provider error codes and normalizes dispatch,
HTTP status, allowlisted Google refusal status, and retry hints. Import,
Performance, notification and Review boundaries map those facts to their existing
product errors. The reachable GBP Error tag and `kind` alias remain compatible;
neither a retryable code nor missing evidence proves a write was not sent.

The import, Performance, sync and publication authorizers share vector fields
with the transactional content resolver. Sync and publication share the
tenant-scoped binding and connection read; Performance keeps its interactive
scope, connection and content checks separate. Token access is bracketed by
authority checks; a routine refresh may advance credentials, but changed tenant,
member, Property or connection authority is refused. Permit admission checks
again and the SQL start predicate remains the final send fence. Notification
management retains its own system principal through the sync authorizer.

GBP push is desired state per Google account: each account bound to an active
Property publishes to `GBP_PUBSUB_TOPIC`. An import item asserts it, and the
daily `reconcile-gbp-notification-subscriptions` job re-asserts it for every
organization with an active connection that current policy allows, reading each
account's setting first and writing only on a difference, so accounts imported
while push was off or broken and a changed topic converge without an operator.

A push names an account and a location, and no tenant. A location is unique only
within an Organization, so it is handed to every Property, in any Organization,
whose current binding is `active` on that account and location, each under its
own Organization, connection and source epoch. A Property that holds the
location through another account, or whose binding is no longer active, gets
nothing from it, and nothing of one tenant reaches another. The message's
receipt decides a redelivery once for all of them; each Property handed the push
gets a receipt row and an identifier-only handoff fact of its own, committed in
that one transaction. The handoff fact's `occurredAt` is the acceptance time:
the dispatch consumer carries it, with the notification kind, into the targeted
fetch job as `acceptedAt` and `notificationKind`, so Review's push health ledger
judges a push by when Pub/Sub accepted it and not by when the job ran. Receipts
still hold no Review identity.

The callback preserves one encrypted provider response behind a leased,
server-generated exchange-attempt identifier. Refresh uses a renewable Redis
single-flight lease and credential-generation compare-and-swap. A refresh Google
refuses for good (`invalid_grant`) moves the connection to `reauth_required`
under that lease, fenced on the lifecycle and credential generations the
refresh started from, and commits
`integration.google_account.reauthorization_required` (cause `provider_revoked`)
in the same transaction. `invalid_client` and `unauthorized_client` name
RepKey's own client configuration, not one grant, so they stay a retryable
`token_refresh_failed` like 5xx answers, timeouts and coordination denials. Disconnect erases
the local binding before gateway dispatch and reconciles ambiguous outcomes
without resending the token.

## Invariants

1. Import discovery data is bounded per provider page and by a 24-hour absolute deadline. It is stored behind opaque HMAC handles; normalized rows grow linearly without a fleet-total cap and expired rows are swept.
2. A confirmed selection has no product-level 100-item cap. One transaction persists the replay-safe saga root, every stable child batch, every item checkpoint, and one identifier-only dispatch fact per child batch.
3. The `integration.google_account.disconnected` fact names the admin who
   disconnected (`userId`, identifier only). It is null when the recovery
   reconciler completes an attempt it cannot attribute, and on facts recorded
   before 2026-09-24. Feed reads it to leave that admin out of the notice it
   sends the other AccountAdmins (ADR 0046).
4. Browser status, retry, and cancellation address the saga root. Partial child completion remains visible rather than being rewritten as all-or-nothing success.
5. Every credential-bearing Google operation executes in this deployment; there is no credential home or routing directory.
6. Discovery reads Google's output-only `metadata.newReviewUri`, validates it against the approved HTTPS Google-host policy, and hands it to the Property binding effect. It is never manually entered by an administrator. Discovery also reads the location's primary category (`categories.primaryCategory.displayName`); the import item carries it, in the form `normalizeGooglePrimaryCategory` gives it, from the claimed candidate to the Property the effect creates or relinks (`gbp_import_request_items.google_primary_category`, scrubbed with the item's other provider state). It is left out of the replay digests, so a category Google moved between two attempts of one request is not a conflict. The review adapter likewise reads each review's output-only `reviewReplyUrl` and keeps it only as `https://business.google.com/n/{the review's own location}/reviews/{token}` (`normalizeGoogleReviewReplyUrl`); anything else, of any type or length, is null and counted (`reviews_reply_url_refused`, a count and the route, never a value), and never fails the page. The schema stays non-strict. It also reads each reply's output-only `reviewReplyState` and `policyViolation` (Google's moderation of the reply) as `unknown` values, maps them to a closed type in `google-review-reply-moderation.ts` (an undocumented state is `unspecified`, a code that is not an enum word is `UNKNOWN`, the code is kept only when `REJECTED`) and counts them per read (`reviews_reply_moderation`, `reviews_reply_moderation_unknown`: counts only, never a value or reply text). Nothing decides on them yet (Review CONTEXT, Model).
7. Production credential-bearing Google adapters have no direct-socket escape hatch. OAuth exchange/refresh/revoke, legacy account lookup, notifications, and Review fallbacks fail before network access unless a governed executor owns the route; fixed-origin JWKS retrieval is the only current non-credential direct trust read.
8. `GOOGLE_PROVIDER_ROUTE_POLICIES` in `src/shared/google-provider-control/route-catalogue.ts` is the exhaustive executable authority for every provider route, credential class, fixed production origin, transport, owner, recovery rule, and current repository activation state. A new route cannot compile without an explicit route-policy decision.
9. The browser can supply only the one-use code and opaque state; it never supplies PKCE verifier or token material to a general server function.
10. A bound callback replay carries no code verifier and can only claim that preserved response; it never re-exchanges the provider code. Claims use a 30-second lease, ciphertext expires after ten minutes, and every terminal path erases it. The five-minute provider-recovery sweep bounds abandoned ciphertext retention and records an unpreserved started exchange as ambiguous.
11. Provider success, provable not-sent, and ambiguous outcomes commit with local token/subject redaction; an elapsed attempt reconciles the linked permit and never sends the token again. An elapsed attempt whose connection has already moved on is closed with that outcome, without redaction or a fact of its own. The attempt window is 60 seconds and the same five-minute sweep bounds crash recovery. Neither route may fall back to a direct credential socket.
12. Coordination ambiguity denies the refresh before credential decryption or database mutation.
13. Lifecycle `prepareClosing` stops provider effects and deletes nothing. `verifyPurgeReadiness` is read-only and fails closed while credential, work, attempt, operation, or discovery evidence remains live. The closing evidence counts a connection's notification subscriptions as stopped only when every bound account's setting was cleared and read back: the notifications unsubscribe answers with an outcome, and a refusal or a connection with no account to target is recorded `not_sent`, a provider failure or a partly cleared connection `ambiguous`. Closing redacts the refresh token in the same transaction, so a subscription counted as stopped could never be stopped afterwards.
14. An Organization that never connected Google answers `no_data` — affirmative evidence, never an omitted contributor.
15. A `reauth_required` connection is never refreshed, and no sync, reply, import or Performance authorization admits it; only a fresh consent (reconnect) returns it to `active`. Credential refusals (the active-connection token provider and the refresh) say `reauthorization_required`, not `connection_disconnected`, and the review API adapter reports a reply refused for it the same way. The import and Performance authorizers keep their own refusal codes (`authorization_denied`, `connection_unavailable`, `reauthentication_required`). The review-sync authorizer says `connection_unusable` for a connection that is bound to the Property but not usable (status other than `active`, a credential use state other than `active`, no `business.manage` scope, or a refresh that learned Google refused the grant), and keeps `authorization_denied` for a refusal of a connection that IS usable (the permit vector changed, the content posture denied the call, or no such connection was found) and `runtime_unavailable` for a token provider failure that does not say the connection is unusable (a refresh that lost its credential fence, a transport error). The code is what lets the Review sync jobs end quietly, with no retry, dead letter or Sentry error, because the reconnect notice is already the signal (Review CONTEXT, sync-property-reviews); every other consumer of the sync authorizer's codes treats `connection_unusable` as it treated `authorization_denied` before.
16. A local disconnect is idempotent and never takes a row from a governed revoke. A connection an overlapping disconnect already finished repeats local category cleanup and source-content purge, with no provider cleanup or second `integration.google_account.disconnected` fact. A cleanup-only retry checks its disconnected lifecycle under the command lock; a reconnect that committed first refuses that retry before cleanup or purge. Property binding publication takes a connection share lock before its Property lock and rechecks active authority; disconnect serializes with it and clears every committed category. While a `disconnecting` connection's cleanup window is open, another disconnect is refused as in progress (`invalid_transition`); once the window has closed it finishes locally. A requested disconnect is not fenced on the credential it read, so a refresh that commits meanwhile cannot make it fail. A reconnect commits only against the exact lifecycle, access and credential versions its OAuth ceremony was approved for, and otherwise fails `oauth_failed` with nothing written. The committed connection fact drives a recoverable outbox refresh of bound locations through governed Google discovery; reconnect and reauthorization callbacks succeed without awaiting it, and completed callback replay makes no provider read. Provider failures and import-capability refusals leave the refresh without a receipt for later delivery. Property restores category hints under connection lifecycle/access, binding/profile and erasure fences: a purge after the original request wins even on redelivery. Missing categories never resurrect the cleared hint.

17. A review sync page token lives behind an opaque cursor ref with a replay bound of ten sends to Google (`google-review-cursor-store.ts`). The adapter redeems before the call, because the gateway admits the exact request, and releases the redemption when the call never reached Google (dispatch `not_sent`: a quota or permit refusal). A dispatched Google 429 or 5xx, or a transport failure after `fetch` (`unknown`), keeps its use. A quota wait of any length therefore spends nothing; before 2026-10-18 each refusal spent one and the sixth failed the run as `cursor_failure`.
18. The cursor store keeps nothing across a restart (ADR 0050), so a deploy that restarts google-provider-redis drops the cursor of every review sync run then in flight. A `cursor_not_found`, from a redeem or from publishing the next page under a parent that is gone, carries when the store started (`INFO server` uptime, `startedAtMs` on the provider-ephemeral store), and the `reviews_cursor_rejected` warning logs it as `storeStartedAt`. The snapshot run ends as `cursor_lost` when the store started after the run did, and the sync job starts a fresh run at once with no coded failure, retry or dead letter. A store up since before the run began, or one that cannot say, leaves it `cursor_failure`, which fails loudly as before.
19. `reviews.list` has a head variant, `readReviewsHead`: page 1 only, `pageSize=50` with an explicit `orderBy=updateTime desc` (the route's one allowed ordering, a literal in the strict descriptor schema, `review-route-descriptors.ts`). It uses the same authorizer, route and `google-reviews-v1` lane as a list page but publishes and redeems no cursor and takes no run id; Google's `nextPageToken` is reduced to `hasMore` and dropped. A page whose `updateTime` values are not non-increasing, or that lacks one, comes back as `order_violation` and is never returned as reviews. The catalogue version is `2026-10-21` for it; admission refuses a permit from a different catalogue version.

## Verification

Unit tests stay beside OAuth, connection, view-lifecycle, import, Performance,
provider-route, worker, and public-boundary subjects. PostgreSQL integration tests
cover exchange preservation, permits, generations, sagas, cancellation, replay,
closure, export, and purge. Redis tests cover renewable refresh leadership,
ownership proof, backoff, and ambiguity denial. Executable inventory tests pin
every production provider route and forbid direct credential sockets.

`src/shared/architecture/google-import-acceptance.integration.test.ts` exercises
`integrationPublicApi.imports` through the composition root against PostgreSQL with
fake provider and queue transport. Its shared fixture builds the application
container with the production authorizers, discovery store, Property receipts,
worker recovery and lifecycle sweep. It covers stale authority, request replay, bounded crash
recovery, claim races, scoped discovery, partial success, cancellation and retention.
