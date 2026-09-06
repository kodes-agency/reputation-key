# Integration Context

## Bounded context

Owns Google OAuth connections, provider access, opaque property-import discovery, the durable v2 import lifecycle, Business Profile Performance retrieval, and Pub/Sub subscription management. Property state changes cross the Property context only through sanctioned binding ports.

## Core concepts

- **GoogleConnection** — tenant-owned OAuth credentials keyed by the verified Google OIDC subject. Credentials and the subject are cleared on disconnect.
- **Opaque import reference** — bounded browser handle whose HMAC-derived key and provider routing data are checkpointed as normalized rows in the credential-home database for at most 24 hours.
- **Provider-content view lifecycle** — framework-free application policy that advances a view epoch before ordered query/content clearing, classifies each completion as current or stale with the causal clear reason, and derives bounded expiry delays. React, cache, visibility, and timer coordination remain in the feature hook.
- **Import saga/batch/item** — one durable tenant-scoped import command, split into stable child batches of at most 100 and per-location work. The saga is the browser-visible job; batches are worker checkpoints. Pending work keeps protected routing suffixes; terminal retention follows the v2 lifecycle.
- **Property Google binding** — Property-owned account/location suffixes, connection, lifecycle state, source epoch, confirmed profile, and validated Google review destination snapshot.
- **Performance report** — live property-scoped Google Business Profile daily metrics, returned with source and retrieval metadata and never persisted.
- **Token encryption** — access and refresh tokens are encrypted at rest through `TokenEncryptionPort`.

## Invariants

- Provider calls require a current connection, capability approval, execution permit, quota admission, and generation checks.
- Browser DTOs and durable events never expose provider account/location identifiers.
- Import discovery data is bounded per provider page and by a 24-hour absolute deadline. It is stored only in the credential-home database behind opaque HMAC handles; normalized rows grow linearly without a fleet-total cap and expired rows are swept.
- Browser consumers use the Integration public API for provider-content clearing, view-epoch guards, stale-completion outcomes, and expiry delays; feature components do not redefine that policy.
- A confirmed selection has no product-level 100-item cap. One transaction persists the replay-safe saga root, every stable child batch, every item checkpoint, and one identifier-only dispatch fact per child batch. Pre-confirmation discovery streams bounded pages into normalized, server-side 24-hour checkpoints with no aggregate record cap; authorization, invalidation fencing, cursor redemption, and candidate claims remain exact and bounded.
- Browser status, retry, and cancellation address the saga root and aggregate every child batch. User cancellation is initiator-scoped, idempotent, and records `user_cancelled`; partial child completion remains visible rather than being rewritten as all-or-nothing success.
- The child worker/security bound remains 100. Provider candidate pages are also bounded, while “Select all eligible locations” fetches through every remaining page before it changes the selection.
- Each active Organization grant is bound to the one current append-only
  credential-home authority generation. New grants preserve that exact home;
  beta home replacement is a governed reconnect permitted only when no other
  active grant would remain on the superseded generation. Legacy rows without
  an authority generation fail closed until an operator applies a digest-bound,
  explicitly targeted backfill.
- The signed routing directory contains identifiers, cells, authority
  generations, policy, and monotonic revision only. It never selects a home
  from country/request origin and never falls back from a missing exact route.
- The cross-cell broker protocol validates short-lived, operation-bound grants
  and persists only keyed hashes plus opaque sealed references. Live cross-cell
  execution remains dark until public-TCP self-TLS/mTLS peer, certificate, and
  drill evidence exists; a target cell never decrypts the home refresh token.
- Property create/relink effects use `PropertyGoogleBindingPublicApi`; Integration does not construct or insert Property entities directly.
- Discovery reads Google's output-only `metadata.newReviewUri`, validates it against the approved HTTPS Google-host policy, carries it through opaque/durable import state, and hands it to the Property binding effect. It is never manually entered by an administrator.
- Performance data is live-only and property-scoped; the base Dashboard does not depend on provider availability.
- Access tokens are encrypted at rest and never logged.
- Production credential-bearing Google adapters have no direct-socket escape
  hatch. OAuth exchange/refresh/revoke, legacy account lookup, notifications,
  and Review fallbacks fail before network access unless a governed executor
  owns the route; fixed-origin JWKS retrieval is the only current
  non-credential direct trust read.
- `GOOGLE_PROVIDER_EGRESS_INVENTORY` is the exhaustive executable authority for
  every provider route, credential class, fixed production origin, transport,
  owner, recovery rule, and current repository activation state. A new route
  cannot compile without an explicit inventory decision.
- A first OAuth exchange reserves the canonical Organization credential home
  before egress, freezes that home plus a prospective connection UUID into the
  authorization vector, and starts through the database-locked v2 permit. Two
  concurrent starts can produce only one `started` transition. The browser can
  supply only the one-use code and opaque state; it never supplies PKCE verifier
  or token material to a general server function.
- The OAuth callback's opaque state owns a server-generated exchange-attempt
  identifier. After the one allowed provider start, a successful token response
  is application-encrypted and committed before JWKS/identity validation or
  connection/audit commit. A bound callback replay carries no code verifier and
  can only claim that preserved response; it never re-exchanges the provider
  code. Claims use a 30-second lease, ciphertext expires after ten minutes, and
  every terminal path erases it. The five-minute provider-recovery sweep bounds
  abandoned ciphertext retention and records an unpreserved started exchange
  as ambiguous.
- OAuth refresh is gateway-wired and retains its renewable single-flight and
  credential-generation CAS. Disconnect revoke uses a distinct server-generated
  attempt, exact credential binding, current connection versions, and one
  admitted cleanup permit. The executor atomically changes the connection to
  `disconnecting/cleanup_only` and erases the binding before gateway dispatch.
  Provider success, provable not-sent, and ambiguous outcomes commit with local
  token/subject redaction; an elapsed attempt reconciles the linked permit and
  never sends the token again. The attempt window is 60 seconds and the same
  five-minute sweep bounds crash recovery. Neither route may fall back to a
  direct credential socket.
- Refresh leadership is shared across replicas through Redis using an opaque
  HMAC connection key, renewable owner lease, pre-commit ownership proof,
  credential-generation CAS, and shared 5–300 second provider-failure backoff.
  Coordination ambiguity denies the refresh before credential decryption or
  database mutation.

## Events produced

| Tag                                                   | Payload                                                                                                                   | When recorded                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `integration.google_account.connected`                | eventId, connectionId, organizationId, userId, occurredAt, correlationId                                                  | An Organization-owned Google connection is established                           |
| `integration.google_account.disconnected`             | eventId, connectionId, organizationId, occurredAt, correlationId                                                          | The current Google connection is disconnected                                    |
| `integration.google_account.reauthorization_required` | eventId, connectionId, organizationId, cause, occurredAt, correlationId                                                   | Connector departure or role loss requires an AccountAdmin to reauthorize         |
| `integration.google_connection.visibility_changed`    | eventId, connectionId, organizationId, visibility, occurredAt, correlationId                                              | The governed connection visibility changes                                       |
| `integration.google_review_push.accepted`             | eventId, organizationId, propertyId, connectionId, sourceEpoch, referenceRef, notificationKind, occurredAt, correlationId | Authenticated GBP push ingress commits an identifier-only targeted-fetch handoff |
| `integration.property_import.requested`               | eventId, organizationId, importJobId, occurredAt, correlationId                                                           | A confirmed import child batch commits its durable dispatch fact                 |
| `integration.property_import.retention_released`      | eventId, organizationId, importJobId, idempotencyKeys, occurredAt, correlationId                                          | A bounded terminal import set releases retained dispatch receipts                |

## Architecture

```text
integration/
  domain/              connection types, events, errors, rules
  application/
    ports/             connection, provider, import-store, reference-store, queue contracts
    dto/               connection, discovery, import-v2, Performance DTOs
    use-cases/         OAuth/connection/notification use cases
    google-import-*    discovery, authorization, reducer, transaction, lifecycle
    google-import-content-lifecycle  provider-content view clearing and epoch policy
    google-performance-* authorization, retrieval, report normalization
  infrastructure/
    adapters/          OAuth and Google provider adapters
    repositories/      connection and credential lifecycle stores
    jobs/              import-gbp-property-item-v2
    google-import-*    durable v2 lifecycle and durable discovery checkpoints
  server/              Google connection, import-v2, and Performance endpoints
  build.ts             composition root
```

## Public API

`application/public-api.ts` exports:

- connection DTO and status contracts;
- the exact Google provider-route and Performance metric catalogues;
- bounded import-v2 status and display DTOs;
- provider-content view lifecycle policy and its stale-completion contract;
- identifier-only Integration event types.

## Organization Export contribution

`infrastructure/adapters/integration-organization-export.adapter.ts` implements the
Identity-owned `OrganizationExportContributor` port and is exposed on
`lifecycle.organizationExportContributor` — never on `publicApi`. The contract
permits this context exactly one disclosure class, `content_free_lifecycle`, so
the contribution answers _what state is this Organization's Google integration
in_, never _what did Google tell us_.

It reads, from one bounded read-only repeatable-read snapshot:
`google_connections` (status, visibility, credential-use state, version and
credential-home fences, sync/status timestamps), `google_organization_credential_homes`
(generation, cell, policy version, transition reason, interval),
`gbp_import_sagas`, `gbp_import_requests` (status and counts),
`gbp_import_request_items` **aggregated to counts by state/action/outcome**, and
`google_disconnect_revoke_attempts` (state, outcome, timings).

It deliberately withholds encrypted access/refresh tokens, token expiry, the
encryption key id, the Google OIDC subject, granted scopes, provider account and
location suffixes, the Google review URI, import replay digests, the disconnect
credential binding and cleanup permit, `google_oauth_exchange_attempts`,
`credential_revoke_permits`, `authorization_execution_permits`,
`google_credential_broker_replay`, the signed routing directory,
`google_import_discovery_records`, credential-home operator identity
and change ticket, and live Business Profile Performance payloads. Every
exclusion is listed in the returned `excludedRecordClasses`.

An Organization that never connected Google contributes `no_data`, never an
invented empty CSV.

## Organization lifecycle contribution

`infrastructure/adapters/integration-organization-lifecycle.adapter.ts`
implements the Identity-owned `OrganizationLifecycleContributor` port on the
shared, transaction-bound receipt store, and is exposed on
`lifecycle.organizationLifecycleContributor` — never on `publicApi`. Composing
it does not arm it: the coordinator that reaches `purge` is composed only under
an explicitly reviewed composition.

- **prepareClosing** stops provider effects and deletes nothing. For each still
  credentialed connection it unsubscribes from GBP notifications and then
  revokes the OAuth grant through
  `GoogleOrganizationClosureProviderPort`, whose contract is convergence rather
  than success: neither method may throw, so a partial provider failure still
  leaves the local fence committed. It then sets every connection to
  `disconnected`, retires the credential, redacts the token material, and bumps
  `lifecycle_version`/`access_version`/`credential_generation` — the fence every
  in-flight import item, review sync, reply push and discovery handle pins — and
  bumps `deletion_fence` on `gbp_import_requests` while voiding their replay
  digests. A second pass sends nothing, because a retired credential is skipped.
- **verifyPurgeReadiness** is read-only and fails closed while a connection is
  still credentialed, an import item is still pending or processing, a
  disconnect-cleanup or OAuth-exchange attempt has no terminal outcome, a
  credential source operation is still open, a cross-cell broker grant is live,
  or a discovery handle has not expired.
- **purge** is irreversible, idempotent and content-free. It deletes this
  tenant's import work, discovery records, OAuth exchange attempts, broker
  grants and the legacy `gbp_*` compatibility mirror ROWS — no table is ever
  dropped and no mirror removed. `google_connections`,
  `google_organization_credential_homes`,
  `google_disconnect_revoke_attempts` and `authorization_execution_permits` are
  scrubbed in place instead of deleted: the disconnect attempt is independently
  retained content-free evidence and references the other three with ON DELETE
  RESTRICT.

An Organization that never connected Google answers `no_data` — affirmative
evidence, never an omitted contributor.

## Permissions

- `integration.manage` — manage Google connections and authorized discovery.
- `property.import_gbp_v2` — start, inspect, retry, and cancel v2 property import sagas.
- `dashboard.performance_google` — retrieve live property Performance reporting.

## Background jobs

The durable outbox relay and dispatcher are always on; worker boot fails when
their delivery dependencies are unavailable.

- **`import-gbp-property-item-v2`** — deterministic, fenced per-item create/relink execution with bounded retries and domain-owned convergence.
