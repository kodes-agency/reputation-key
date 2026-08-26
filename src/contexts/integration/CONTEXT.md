# Integration Context

## Bounded context

Owns Google OAuth connections, provider access, opaque property-import discovery, the durable v2 import lifecycle, Business Profile Performance retrieval, and Pub/Sub subscription management. Property state changes cross the Property context only through sanctioned binding ports.

## Core concepts

- **GoogleConnection** — tenant-owned OAuth credentials keyed by the verified Google OIDC subject. Credentials and the subject are cleared on disconnect.
- **Opaque import reference** — short-lived browser handle whose provider routing data exists only in the provider-ephemeral store.
- **Provider-content view lifecycle** — framework-free application policy that advances a view epoch before ordered query/content clearing, classifies each completion as current or stale with the causal clear reason, and derives bounded expiry delays. React, cache, visibility, and timer coordination remain in the feature hook.
- **Import saga/batch/item** — one durable tenant-scoped import command, split into stable child batches of at most 100 and per-location work. The saga is the browser-visible job; batches are worker checkpoints. Pending work keeps protected routing suffixes; terminal retention follows the v2 lifecycle.
- **Property Google binding** — Property-owned account/location suffixes, connection, lifecycle state, source epoch, confirmed profile, and validated Google review destination snapshot.
- **Performance report** — live property-scoped Google Business Profile daily metrics, returned with source and retrieval metadata and never persisted.
- **Token encryption** — access and refresh tokens are encrypted at rest through `TokenEncryptionPort`.

## Invariants

- Provider calls require a current connection, capability approval, execution permit, quota admission, and generation checks.
- Browser DTOs and durable events never expose provider account/location identifiers.
- Import discovery data is bounded, short-lived, and stored only in provider-ephemeral Redis.
- Browser consumers use the Integration public API for provider-content clearing, view-epoch guards, stale-completion outcomes, and expiry delays; feature components do not redefine that policy.
- A confirmed selection has no product-level 100-item cap. One transaction persists the replay-safe saga root, every stable child batch, every item checkpoint, and one identifier-only dispatch fact per child batch. Pre-confirmation provider references retain their 2,000-record/15-minute safety envelope, so arbitrary-fleet discovery still needs the GGL-01 server-side checkpoint follow-up recorded in the program status.
- Browser status, retry, and cancellation address the saga root and aggregate every child batch. User cancellation is initiator-scoped, idempotent, and records `user_cancelled`; partial child completion remains visible rather than being rewritten as all-or-nothing success.
- The child worker/security bound remains 100. Provider candidate pages are also bounded, while “Select all eligible locations” fetches through every remaining page before it changes the selection.
- One credential is denied from spanning multiple Data Cells until the REG-01 credential-home broker explicitly authorizes that operation; the current composition root does not install that authorization.
- Property create/relink effects use `PropertyGoogleBindingPublicApi`; Integration does not construct or insert Property entities directly.
- Discovery reads Google's output-only `metadata.newReviewUri`, validates it against the approved HTTPS Google-host policy, carries it through opaque/durable import state, and hands it to the Property binding effect. It is never manually entered by an administrator.
- Performance data is live-only and property-scoped; the base Dashboard does not depend on provider availability.
- Access tokens are encrypted at rest and never logged.
- Production credential-bearing Google adapters have no direct-socket escape
  hatch. OAuth exchange/refresh/revoke, legacy account lookup, notifications,
  and Review fallbacks fail before network access unless a governed executor
  owns the route; fixed-origin JWKS retrieval is the only current
  non-credential direct trust read.
- Refresh leadership is shared across replicas through Redis using an opaque
  HMAC connection key, renewable owner lease, pre-commit ownership proof,
  credential-generation CAS, and shared 5–300 second provider-failure backoff.
  Coordination ambiguity denies the refresh before credential decryption or
  database mutation.

## Events produced

- **`integration.google_account.connected`** — identifier-only connection lifecycle fact.
- **`integration.google_account.disconnected`** — identifier-only disconnect fact.
- **`integration.google_connection.visibility_changed`** — identifier-only visibility fact.
- **`integration.property_import.requested`** — identifier-only durable import dispatch fact.
- **`integration.property_import.retention_released`** — bounded identifier-only receipt-release fact.

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
    google-import-*    durable v2 and provider-ephemeral implementations
  server/              Google connection, import-v2, and Performance endpoints
  build.ts             composition root
```

## Public API

`application/public-api.ts` exports:

- connection DTO/status/visibility contracts;
- exact Google provider-route and Performance metric catalogues;
- opaque discovery and import-v2 DTO/contracts;
- provider-content view lifecycle policy and its stale-completion contract;
- identifier-only import event contracts.

## Permissions

- `integration.manage` — manage Google connections and authorized discovery.
- `property.import_gbp_v2` — start, inspect, retry, and cancel v2 property import sagas.
- `dashboard.performance_google` — retrieve live property Performance reporting.

## Background jobs

- **`import-gbp-property-item-v2`** — deterministic, fenced per-item create/relink execution with bounded retries and domain-owned convergence.
