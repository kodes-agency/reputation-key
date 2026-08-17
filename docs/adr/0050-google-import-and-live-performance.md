---
status: accepted
release_state: railway_closed_beta_exception_accepted
accepted_date: 2026-08-10
amended_date: 2026-08-12
---

# 0050 — Google property import and live Performance reporting

## Context

The existing Google Business Profile (GBP) import path conflates provider APIs, loses the account identity required for account-scoped routing, exposes provider identifiers to browser code, assumes unbounded discovery, and commits import work through a coarse legacy job model. The Property Dashboard has no live Business Profile Performance report.

This decision covers two independently controlled capabilities:

- `property.import_gbp_v2`
- `property.read_gbp_performance`

It does not change the existing core Reviews connection capability. It replaces neither ADR 0031's Google Reviews content policy nor ADR 0047's persisted policy state; it adds a stricter contract for the new import and live Performance surfaces.

### Primary policy evidence

Retrieved 2026-08-10 from the canonical [Business Profile APIs policies](https://developers.google.com/my-business/content/policies), last updated by Google 2025-08-28 UTC:

- Content storage: “Stored Content must … be stored temporarily for no more than 30 calendar days,” “be stored securely,” and “cannot be manipulated or aggregated in any way.”
- Automated use: “End users of your Business Profile APIs need to manually sign in to use it.”
- Disassociation: after notice, a third party has seven business days to let the end-client disassociate its Business Profile account and regain exclusive control.
- Attribution: provider-supplied brand features or attribution must be displayed as provided and must not be deleted or altered.
- Product identity: an API client must not replicate the Business Profile UI or imply partnership, sponsorship, or endorsement by Google.

The current Performance discovery document, retrieved 2026-08-10 at revision `20260809`, marks `BUSINESS_FOOD_ORDERS` deprecated. The canonical DailyMetric reference lists eleven non-unknown numeric metrics; this release requests the ten non-deprecated values frozen below.

Google's OAuth web-server guidance requires exact registered redirect URIs, recommends state to reduce CSRF risk, and requires the `business.manage` scope for the Account Management and Business Information endpoints. This ADR adopts a stronger opaque, session-bound state contract plus PKCE and signed OIDC identity.

## Decision

### 1. Context ownership

- **Integration** owns Google OAuth/token lifecycle, provider transports, provider error classification, provider quota policy, provider-ephemeral references, connection visibility, import requests/items, and the live Performance source adapter.
- **Property** owns the tenant Property profile, canonical Google binding, source/profile generations, confirmed timezone, create/relink mutation, deletion fencing, and operation receipts.
- **Dashboard** owns manager-facing live Performance composition and presentation DTOs. It receives an authorized live report through a narrow port.
- **Metric** remains unchanged. Google Performance values, derivatives, definitions, source policies, queues, and projections are prohibited in this release.
- **Shared auth** owns capability vocabulary, persisted policy and emergency-kill generations, approval bindings, authorization decisions, execution permits, credential-source serialization, and credential cleanup authority.
- **Composition** owns cross-context adapters. Contexts consume public/application contracts rather than another context's repositories.

The frozen source contracts are:

- `src/shared/auth/google-content-contract.ts`
- `src/contexts/integration/application/google-provider-contract.ts`
- `src/contexts/integration/application/google-import-v2-contract.ts`
- `src/contexts/property/application/google-binding-contract.ts`
- `src/contexts/dashboard/application/dto/google-performance-contract.ts`
- `src/shared/architecture/google-performance-live-boundary.ts`

### 2. Version and capability contract

| Contract                 | Frozen value               |
| ------------------------ | -------------------------- |
| Capability policy        | `beta-local-2`             |
| Execution policy         | `beta-local-2`             |
| Google Content policy    | `google-content-live-1`    |
| Google OAuth/OIDC        | `google-oauth-oidc-1`      |
| Provider route catalogue | `google-provider-routes-1` |
| Performance catalogue    | `2026-08-05`               |
| Runtime isolation        | `google-content-egress-1`  |
| Closed-beta deployment   | `railway-closed-beta-1`    |
| Import DTO               | `2`                        |
| Performance DTO          | `1`                        |

Both new capabilities are non-core, off by default, independently allowlisted, and independently subject to a shared persisted emergency kill. `BETA_CAPABILITIES_OFF` is a stricter boot-time seed/defense, not the rolling-runtime rollback mechanism.

No new provider call, Content publication, enqueue, retry, Property effect, or lease renewal may rely on cached allow. The operation must refresh authoritative policy and commit through a bounded one-attempt execution permit immediately before the protected adapter.

### 3. Google Content treatment

#### Import discovery

Discovery Content may exist only in request/browser memory and a dedicated provider-ephemeral Redis service for at most 15 minutes. That service has no volume, AOF, RDB snapshot, persistence-capable replication/backlog, backup, export, restore, or new outbound network path. It is not the general BullMQ/quota Redis.

Browser DTOs carry 256-bit random opaque account, candidate, cursor, and lease handles. Provider Redis keys and indexes use audience-separated, versioned HMACs of those handles. Browser code never receives account IDs, location IDs, provider page tokens, OAuth tokens, resource paths, or self-contained provider claims.

A durable import stores the manager's explicitly confirmed RepKey profile. Provider display fields may prefill review UI, but are not durable mutation/routing authority and are cleared with the discovery epoch.

#### Live Performance

Performance values and derivatives are live-only. RepKey must not persist, prefetch, synchronize, backfill, cache server-side, index, queue, export, log, trace, screenshot, hash, or ingest them into Metric. Allowed residence is limited to:

1. bounded request buffers in the egress gateway and web process;
2. normalized/derived request memory; and
3. the currently observed, non-persisted browser query state.

Every successful result has an absolute deadline of at most 15 minutes. HTTP responses are `private, no-store, max-age=0`; SSR never prefetches or dehydrates the report; browser queries have no persister, `gcTime: 0`, `retry: false`, and no focus/reconnect/background refetch.

The controlled runtime uses read-only roots, tmpfs-only writable/temp locations, core dumps and diagnostic snapshots disabled, and body-free observability. This does not prove that an unmanaged browser/OS cannot swap, hibernate, crash-recover, extend, or forensically capture client memory. Any non-sandbox Performance approval must explicitly accept that residual. A denial keeps only the Performance capability killed.

Request-lifetime period sums and chart composition are reporting transformations, not durable manipulation. Railway closed-beta enablement requires one accountable owner to sign all five role documents for the exact release and environment. Later production phases retain five independent role owners. There is no approval by silence or by an absent record.

### 4. Canonical Property binding

The application/domain symbol is `gbpLocationId`, not `gbpPlaceId`. A bare validated account/location suffix contains 1–255 characters and no slash, question mark, hash, whitespace, or control character. Integration alone constructs provider resource names.

```ts
type GoogleBindingState =
  | 'unbound'
  | 'account_confirmation_required'
  | 'active'
  | 'disconnected'

type GoogleLocationBinding = Readonly<{
  connectionId: GoogleConnectionId
  accountId: string
  locationId: string
  sourceEpoch: number
}>
```

A non-deleted location is unique within an organization under the exact partial predicate `gbp_location_id IS NOT NULL AND deleted_at IS NULL`. The account suffix is mutable routing metadata; relink may replace it. Disconnect retains routing identity for explicit relink. Provider-identity purge and Property deletion scrub the tuple and leave `unbound`; restore never resurrects it.

`sourceEpoch` is the binding/timezone generation. `profileVersion` is the Property profile optimistic-concurrency generation. Connection authority is split into lifecycle, access, and credential generations.

### 5. OAuth/OIDC integrity

OAuth state v2 is a random 256-bit opaque handle. Provider Redis holds the authoritative record for at most ten minutes under an audience-separated HMAC. The record fixes organization, initiating user, visibility, server-selected purpose, connection mode/target or global absence, return-route key, independent OIDC nonce, PKCE S256 verifier/challenge, issue/expiry, and the initiating Better Auth session binding.

The initiating-session binding is a versioned, audience-separated HMAC of the stable server-side session ID. The raw session ID/cookie is never persisted. Callback handling re-resolves the same-site authenticated session and active organization, then atomically compares session digest, user, and organization before consuming state. Sessionless or mismatched callbacks:

- do not consume another browser's state;
- do not call token, JWKS, or another provider route;
- do not mutate or disclose tenant state; and
- use one fixed generic redirect.

V2 requests exactly `openid` and `https://www.googleapis.com/auth/business.manage`; the normalized granted set must match exactly. Signed OIDC `sub` is the sole Google connection identity. `googleSubject` replaces the misleading `googleAccountId`; it is distinct from a Business Profile account suffix. V1 state/event support exists only for the measured compatibility window and is drained before contract removal. There is no dual emit or downgrade.

Initial exchange never calls `/revoke`: before the subject is authoritative, the returned credential cannot be proven safe to revoke without risking another valid authority. Credential lifecycle and cleanup instead use the serialized source/guard/child contract below.

### 6. Credential source and cleanup contract

One audience-separated HMAC subject-authority guard serializes every subject-authoritative refresh, reauth, and reconnect source operation. A source registers before provider access and leaves `provider_started` only by atomically committing or discarding the credential response, linking any exact-token cleanup child, and recording a code-only terminal result.

Frozen source states are:

- `registered`
- `provider_started`
- `terminal`
- `provider_outcome_ambiguous`
- `provider_reset_terminal`

Frozen cleanup child states are:

- `dormant`
- `active`
- `dispatching`
- `consumed_no_revoke`
- `confirmed_not_sent`
- `confirmed_revoked`
- `cleanup_ambiguous`
- `provider_reset_confirmed`

Required child transitions include `dormant -> consumed_no_revoke`, `active -> confirmed_not_sent|dispatching`, and `dispatching -> confirmed_not_sent|confirmed_revoked|cleanup_ambiguous`, followed only by the guarded provider-reset recovery path where required.

Only `confirmed_revoked` is cleanup-drained. `confirmed_not_sent` moves aggregate authority to `provider_reset_required`; `cleanup_ambiguous` moves it to `ambiguous`. Both keep `cleanupDrainedAt` null and readiness red until post-quiescence provider-reset recovery. No automatic retry can turn uncertainty into proof.

Cleanup receives a reserved quota and may survive a work deny only to reduce provider authority. One-use authorization, exact token HMAC, credential material, and send deadline are bounded to 60 seconds. Work quota cannot consume cleanup capacity.

### 7. Provider routes and catalogue

All server-side Google traffic uses a separately authenticated egress gateway plus content-free execution-admission service. App/worker code has no direct provider socket path. The gateway has no generic `CONNECT`, accepts only typed route schemas, rejects redirects, and constructs provider URLs from validated suffixes.

| Route                | Contract                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account Management   | `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`; `pageSize=20`; optional provider-held `pageToken`; parse `accounts`, `name`, `accountName`, and `role`                 |
| Business Information | `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{accountId}/locations`; `pageSize=100`; read mask `name,title,storefrontAddress,categories`; preserve account identity |
| Performance          | `GET https://businessprofileperformance.googleapis.com/v1/locations/{locationId}:fetchMultiDailyMetricsTimeSeries`; exact frozen metrics/date query; `prettyPrint=false`                     |
| OAuth token          | fixed `https://oauth2.googleapis.com/token`                                                                                                                                                  |
| OAuth revoke         | fixed Google revoke endpoint; cleanup permits only                                                                                                                                           |
| OIDC JWKS            | fixed Google JWKS endpoint; redirects denied                                                                                                                                                 |
| Reviews              | existing v4 behavior retained through typed routes                                                                                                                                           |

No request, caller, database row, environment override, or Property may provide an origin/path/query fragment. A sandbox profile accepts only exact TLS local-stack origins, rejects a Railway deployment identity, and uses a run-scoped local CA without disabling TLS verification.

The active Performance catalogue is:

1. `BUSINESS_IMPRESSIONS_DESKTOP_MAPS`
2. `BUSINESS_IMPRESSIONS_DESKTOP_SEARCH`
3. `BUSINESS_IMPRESSIONS_MOBILE_MAPS`
4. `BUSINESS_IMPRESSIONS_MOBILE_SEARCH`
5. `BUSINESS_CONVERSATIONS`
6. `BUSINESS_DIRECTION_REQUESTS`
7. `CALL_CLICKS`
8. `WEBSITE_CLICKS`
9. `BUSINESS_BOOKINGS`
10. `BUSINESS_FOOD_MENU_CLICKS`

`DAILY_METRIC_UNKNOWN` and deprecated `BUSINESS_FOOD_ORDERS` fail closed. Decoded Performance responses are capped at 5 MiB. Present values must be canonical non-negative int64 strings and no larger than `6_152_458_507_336` before conversion to `number`; omitted values are certified zero. Unknown/unrequested metrics, duplicates, malformed/partial/out-of-range dates, JSON numbers, negative/fractional/oversize values, and any sub-entity fail the whole report.

### 8. Quota and retry contract

Provider limits are Redis-global and fail closed; there is no process-memory fallback. Every API has an eight-call in-flight semaphore with a 20-second lease and a two-second acquisition wait unless a stricter route rule applies.

- Account Management: 4 requests/second globally, burst 4; 60/minute per user+organization+connection.
- Business Information: 4 requests/second globally, burst 4; 60/minute per user+organization+connection.
- Performance: 4 requests/second globally, burst 4; 30/minute per user+organization+property; 240/minute project-wide.
- Token refresh: 4 requests/second, burst 4; 120/minute; 6/15 minutes per connection; four concurrent; single-flight leader; shared 5–300 second backoff.
- Credential cleanup revoke: reserved 8 requests/second, burst 16; 240/minute; eight concurrent; one attempt per exact-token permit.

One 401 refresh is allowed. Followers receive a typed result, never a credential. Every caller reacquires its own authorization, route quota, and semaphore before the one original-request retry.

### 9. Import v2 wire contract

The browser receives opaque references and provider-free DTOs. Durable start accepts one UUID request ID and 1–100 unique candidate refs plus explicit create/relink profile confirmation. Wire and semantic replay HMACs are versioned, domain/tenant/user/request-separated, and compare in constant time. A provider-Redis Lua claim establishes one owner for all refs before resolution.

One transaction commits parent, items, both replay digests, and `integration.property_import.requested` v1. That event payload is exactly `{organizationId, importJobId}`. Start and accepted retry use the same event. Item jobs use `import-gbp-property-item-v2` and Bull-safe IDs `import-item-<itemId>-l<lifecycleVersion>-e<epoch-or-new>-r<retryRevision>` with no colon.

The separate retention event is `integration.property_import.retention_released` v1 with exactly `{organizationId,idempotencyKeys}` and at most 100 item IDs.

The frozen parent statuses, item statuses, outcome map, user actions, DTOs, and confirmed profile inputs are exported from `google-import-v2-contract.ts`. Unknown statuses/outcomes fail closed. Only `temporarily_unavailable` is retryable. A committed Property receipt is reconciled before every route, policy, terminal, deletion, or attempt-exhaustion path; receipt reconciliation performs no new provider or Property effect.

### 10. Live Performance reporting contract

The Performance range key is independent from Dashboard `timeRange` and accepts exactly `7d|30d|90d|180d`, defaulting invalid/multiple input to `30d`. Current is the selected number of Property-local dates ending at confirmed local yesterday; prior is the immediately preceding equal range. One request covers at most 360 days.

Omitted provider values are zero. A missing requested date or series is unavailable, not zero. Deltas require equal requested lengths, complete like-for-like constituent coverage, and non-zero prior. Request-memory-only derived values are:

- total profile impressions = four device/surface counters;
- Search impressions = desktop Search + mobile Search;
- Maps impressions = desktop Maps + mobile Maps.

These are not unique-person totals. The UI shows no conversion rate and never describes call clicks as completed calls. Source, period, retrieval time, coverage, and missing-data limitations are explicit.

The frozen presentation result is `PropertyGooglePerformanceResultV1`. Base Dashboard data renders independently from provider latency or failure. The live dependency boundary accepts only policy, authorization lease, Property read, Google source, clock, and code-only authorization-audit dependencies. Write repositories, queues/jobs, server caches, and Metric dependencies are denied.

### 11. Machine-bound capability approval

A global allowlist is necessary but insufficient. Each capability needs a persisted `GoogleContentApprovalBinding` for one exact target phase, environment profile, release SHA, migration head, ADR/content/OAuth/project/catalogue/policy fingerprints, deployment attestation, evidence manifest/index, and all five runtime image digests:

- web
- worker
- Google execution-admission
- Google egress gateway
- provider-ephemeral Redis

The approval schema must add target phase `railway_closed_beta` and environment profile `railway-closed-beta-1`. Its runtime-isolation version and digest become an exact nullable pair, absent only for that phase/profile. A Railway binding instead requires a non-null digest of the immutable Railway residual-risk decision described below. Each role document adds the same explicit `railwayClosedBetaResidualDecision`; absence or denial cannot authorize the exception. `railway-closed-beta-1` is a deployment/risk profile, not a runtime-isolation profile, and must never compare equal to or satisfy `google-content-egress-1`.

The evidence graph is acyclic:

1. freeze the manifest and machine-produced artifacts;
2. each of five role documents signs the manifest digest and exact decisions, not an index;
3. construct the canonical index from manifest, artifacts, and role documents; and
4. persist the capability binding outside the index, binding both manifest and index digests.

Required roles are `engineering/runtime`, `product/property`, `security/privacy`, `google-project/integration`, and `operations/on-call`. Binding absence is the only pre-approval representation. No placeholder, synthetic approval, partially signed binding row, or approval by deployment environment is allowed.

For `railway_closed_beta` only, one accountable owner may hold all five required roles. The owner must issue five separate, role-specific signed documents with one exact `approverIdentity`; any mixed identity fails closed. This is role-complete attestation, not separation of duties. It neither weakens the five-document signature and decision checks nor applies to `production_expand_canary` or `production_final`, which retain independent role ownership.

Railway closed-beta bindings last at most 30 days. Expand-canary bindings last at most 72 hours. Final bindings expire at the earlier of the Google project-attestation expiry or 90 days after the latest required approval. Phase/profile/cohort/release/schema/image/config drift denies new work. Natural expiry may only bound already-delivered Content through its original lease and never admit new provider/effect work.

### 12. Hosting decision and controlled Railway exception

#### Open-beta production isolation

`google-content-egress-1` remains semantic infrastructure control, not an application-reported hash. Every content/credential-bearing web or worker replica is immutable and default-deny for IPv4 and IPv6. It may reach only exact internal identity+protocol+port tuples, the named allowlisting resolver, and the authenticated egress gateway. The admission service cannot reach a provider. The gateway cannot reach PostgreSQL or Redis. Provider-ephemeral Redis can initiate no outbound connection, including DNS, metadata, telemetry push, database, Redis peer, or Google.

A control-plane collector must enumerate every protected replica/policy generation and run the complete allowed/denied matrix from each role. Missing replica, drift, default route, alternate resolver/client, direct IP, metadata, unknown internal tuple, or provider-Redis outbound path denies open-beta readiness and production approval.

The planned qualifying target is GKE Standard for application workloads, a dedicated GCE Managed Instance Group for the Google egress gateway, and Google Secure Web Proxy in explicit-proxy, default-deny mode with exact gateway-service-account, hostname, and port-443 rules. This target remains unqualified until a disposable-environment spike proves the complete role-specific network and physical-nonpersistence matrix and a later ADR mutation binds its immutable infrastructure profile. Open beta, public rollout, `production_expand_canary`, and `production_final` remain blocked until that proof exists.

#### Railway closed-beta exception

Current Railway documentation provides internet egress, optional IPv6, static source IPs, and private service networking, but does not document destination-deny/FQDN egress enforcement. A static source IP is not destination enforcement. Railway therefore does not satisfy `google-content-egress-1`.

The product owner nevertheless accepts a lower-assurance, time-bounded exception for the named closed-beta cohort. An exact, explicitly approved `railway-closed-beta-1` binding may authorize **both** `property.import_gbp_v2` and `property.read_gbp_performance`; the capabilities remain independently killed, approved, and rolled back. This exception authorizes no wildcard, plan-, role-, email-domain-, or self-service enrollment and cannot authorize open beta, public access, another capability, `production_expand_canary`, `production_final`, or contract migration.

The immutable Railway risk decision must state that Railway cannot independently prove:

- destination-deny egress from Content/credential-bearing web and worker processes;
- denial of direct-IP, alternate-DNS, IPv4, IPv6, metadata, sentinel, or unexpected internal-tuple attempts;
- read-only-root and RAM-only writes at the host boundary, host swap exclusion, or host core-dump exclusion;
- deny-all-new-outbound enforcement for provider-ephemeral Redis; or
- the complete infrastructure policy generation and per-role live-probe matrix required by `google-content-egress-1`.

Application routing through a dedicated gateway reduces accidental misuse but does not remove these risks: compromise of a Railway web or worker process may retain general network reachability. The accountable owner must sign all five role documents covering this exact residual for the exact capability, release, images, migration head, Google project/client, cohort, and expiry. The runtime validator requires the same exact signed `approverIdentity` across those documents.

The exception is valid only while all of the following hold:

1. The complete shared foundation plus Import and Performance contracts in this ADR are implemented; no authorization, OAuth, replay, lifecycle, quota, content, accessibility, acceptance, or cleanup requirement is waived.
2. The cohort is an immutable, explicit organization-ID allowlist in the signed manifest. Server-side checks run at OAuth start/callback, discovery, import start/retry/enqueue/job/effect, Performance request/provider call/publication, authorization-lease renewal, and credential cleanup. Removal denies new work immediately.
3. Dedicated Railway services run the web, worker, authenticated Google egress gateway, content-free execution admission, and provider-ephemeral Redis roles. App and worker transports expose no direct Google adapter path; every Google request uses a typed gateway route with fixed production origins, constructed paths, redirects denied, and no request/database/environment origin override.
4. Provider Redis has no volume, AOF, RDB snapshot, replication/backlog persistence, backup, export, or restore path; uses authenticated TLS and least-privilege ACLs; enforces `maxmemory` with `noeviction`; and retains Content for at most 15 minutes. It is never the BullMQ/general Redis.
5. Controlled containers use read-only roots, bounded RAM-backed writable/temp paths where Railway exposes them, `ulimit core=0`, disabled diagnostics, and body-free logs/traces/APM. Import and Performance responses remain `private, no-store, max-age=0`; no SSR dehydration, browser persister, service-worker cache, export, analytics, screenshot, or durable provider-Content path is added.
6. OAuth v2 keeps the opaque initiating-session-bound state, PKCE, nonce, exact scopes, signed OIDC `sub`, generic callback failure, serialized subject guard, and exact-token cleanup contract. A beta-specific OAuth client is preferred to limit blast radius; if GCP uses another client, every affected connection is marked `reauthentication_required` rather than silently reused.
7. Both persisted capability kills begin denied. Activation requires the complete I6 and P3 local gates, integrated immutable-image drill, named-cohort Railway smoke test, dropped-response/overlap/retry/deletion/authorization-race coverage, real kill/drain rehearsal, persistence-negative inspection, and five fresh role attestations signed by the accountable owner. Evidence is body/value-free; no real Performance value or provider display Content enters screenshots or artifacts.
8. Binding expiry, project-attestation expiry, approval suspension/revocation, cohort mismatch, kill-generation change, policy/authorization refresh failure, release/schema/image/config drift, provider-Redis nonpersistence/readiness failure, or cleanup ambiguity denies new work. No environment variable, static IP, or private-network membership can self-approve or bypass a deny.

### 13. Identifier storage allowlist

Provider identifiers may exist durably only in:

- protected connection OAuth subject/token/exact-scope columns;
- canonical Property account/location routing suffixes;
- pending or retry-eligible import-item routing suffixes until their scrub boundary;
- audience/tenant/user/request-separated keyed wire/semantic replay HMACs and key versions until parent purge;
- expiring opaque-reference and authorization-lease records in provider Redis;
- exact-token credential HMAC in a one-use cleanup permit for at most 60 seconds; and
- audience-separated subject HMAC plus monotonic guard control fields until safe cleanup or audited provider-reset recovery.

Provider suffixes, subjects, tokens, URLs, bodies, display fields, handles, and plain provider-derived hashes are prohibited from browser DTOs, jobs, outbox payloads, logs, traces, analytics, evidence, SSR HTML, local/session storage, and service-worker caches.

### 14. Migration, rollout, and rollback

Use expand/compatibility/contract:

1. additive policy/OAuth/Property/import expands;
2. mixed-binary compatibility and bounded backfill;
3. advisory-locked concurrent subject and Property location indexes;
4. v2 connected-event issuance, then v2 OAuth-state issuance;
5. full state TTL+skew and event drain;
6. irreversible legacy import fence/drain/archive;
7. final compatibility-free binary on expand;
8. denied/quiescent handoff; and
9. contract DDL only after no compatibility process can run.

Railway closed beta is an additional gate after the integrated local release drill and before qualifying-target production expand. It applies only additive expand migrations, deploys the exact five approved images with both capabilities killed, completes compatibility/backfill/index/issuance/drain checks, and proves the final contract-ready binary on the expand schema. It then persists separate, expiring `railway_closed_beta` bindings and canaries Import and Performance independently for the exact organization cohort. No contract DDL/DML runs on Railway.

Before contract, rollback first kills or approval-revokes both capabilities, prevents new OAuth/discovery/Performance starts, waits the state/content TTL plus skew, drains ordinary work and credential cleanup, and proves zero active permits, import jobs, outbox relays, authorization leases, or ambiguous source/cleanup operations. It may then restore the compatibility binary/issuance. After contract, rollback is independent persisted kill/approval revoke plus forward-fix. No alias, shadow column, wildcard route, old job consumer, v1 identity path, or legacy decoder remains after contract.

Before GCP migration, Railway must reach that same denied/quiescent state and its provider Redis must be destroyed. The authoritative PostgreSQL migration follows the separately approved state-migration plan; BullMQ state is drained or deterministically reconciled rather than copied blindly. If the GCP deployment uses a different OAuth client, affected Google connections become `reauthentication_required`. Railway never resumes Google work after GCP promotion.

Qualifying-target production expand/canary and production contract remain separate release gates. The expand owner must end with both capabilities killed or approval-revoked, ordinary and cleanup work drained, and zero active permits/import jobs/outbox relays/authorization leases. The contract owner independently re-proves that state before any production DDL/DML.

## Considered options

- **Persist Performance values for 30 days.** Rejected. Current policy allows only limited temporary storage to improve project performance and prohibits stored manipulation/aggregation; the product does not need durable storage for the requested report.
- **Schedule Performance synchronization or backfill.** Rejected. It creates storage, queue, policy, and lifecycle obligations without a user-initiated reporting need.
- **Store Performance in Metric.** Rejected. It contaminates the governed Metric model with provider Content and creates durable derivatives/projections.
- **Use wildcard location routing or infer account identity.** Rejected. Business Information and Reviews are account-scoped; guessing loses authority and tenant routing.
- **Use self-contained browser claims/provider IDs.** Rejected. Opaque server-resolved references minimize disclosure and allow bounded invalidation.
- **Treat Railway static egress IP/private networking as isolation.** Rejected. Neither proves destination-deny enforcement.
- **Enable Import but keep Performance killed on Railway.** Rejected by the product owner for closed beta. The lower-assurance Railway risk is accepted for both capabilities, while all live-only Performance controls and independent kill/approval boundaries remain mandatory.
- **Delay both capabilities until GCP qualification.** Rejected for closed beta because it prevents the intended end-to-end product learning. Retained as the mandatory open-beta boundary.
- **Revoke every token returned by a failed initial exchange.** Rejected. Before authoritative subject mapping, revocation can destroy another valid authority.

## Consequences

- Import and Performance can be implemented, accepted, killed, canaried, and rolled back independently after the shared foundation.
- The exact named closed-beta cohort may use both capabilities on Railway only under fresh `railway-closed-beta-1` residual-risk approvals.
- Performance has no data rollback because it stores no provider Content.
- Import durability comes from tenant-confirmed profile data, content-free replay digests, deterministic jobs, and Property receipts rather than provider display fields.
- The architecture needs dedicated provider Redis, admission, gateway, approval, source-guard, cleanup, and release-evidence infrastructure.
- Railway remains a lower-assurance exception; it is not evidence of destination-deny or physical nonpersistence.
- Open beta and public rollout remain blocked on qualifying `google-content-egress-1` infrastructure and five exact-release approvals even after all local and Railway closed-beta tests pass.

## Pre-implementation mutation log

### 2026-08-09 — execution split and ownership correction

- **Author:** Main with architecture, security, and acceptance reviewers.
- **Reason:** WP0–WP8 were too large to execute/review as one package; shared ownership and the production handoff were ambiguous.
- **Old contract:** detailed WPs doubled as delivery units; provider-Redis/fanout ownership and Import/Performance parallelism were implicit; R3 could hand an approved active canary directly to R4.
- **New contract:** 22 bounded C/F/I/P/R units; F2 solely owns provider Redis, generic leases, and shared invalidation dispatch; F3/F7/I1/I4/P1 own non-overlapping lifecycle audiences; F8 serializes shared Performance transport/catalogue before optional Import/Performance parallelism; R3 ends denied and quiescent; R4 independently re-proves that state and solely owns production contract DDL/DML.
- **Migration/rollback impact:** production contract cannot follow an active expand canary; capability kills/revocations and drains are mandatory between R3 and R4.
- **Proof:** architecture, security, and acceptance reviews approved the staged ownership/handoff map before implementation.

### 2026-08-09 — cleanup outcome correction

- **Reason:** review found one description incorrectly treated `confirmed_not_sent` as cleanup-drained.
- **Old contract:** `confirmed_not_sent` could close cleanup.
- **New contract:** only `confirmed_revoked` closes cleanup; `confirmed_not_sent -> provider_reset_required` and `cleanup_ambiguous -> ambiguous`; both retain null `cleanupDrainedAt`, red readiness, and mandatory post-quiescence provider-reset recovery.
- **Affected implementation:** capability/permit foundation, lifecycle operations, local/production release gates, expand constraints, and acceptance evidence.
- **Migration/rollback impact:** pre-implementation only; no non-revoked outcome may be backfilled as drained.
- **Proof:** contract tests exhaustively assert the three cleanup outcomes.

### 2026-08-12 — all-feature Railway closed-beta exception

- **Author:** Product owner; recorded by Main.
- **Reason:** the closed beta needs end-to-end Import and live Performance product learning before the open-beta migration to GCP.
- **Old contract:** Railway could reach only local-green with both new capabilities production-killed because it cannot prove `google-content-egress-1`.
- **New contract:** the `railway-closed-beta-1` lower-assurance profile may authorize both new capabilities for an exact named organization cohort for at most 30 days, with independent kills/bindings, five explicit residual-risk approvals, the complete application/content/OAuth/lifecycle controls, dedicated services, and expand-schema-only rollout. It cannot satisfy the isolation profile or authorize open beta, public rollout, qualifying-target production phases, or contract migration.
- **Risk retained:** Railway still cannot independently enforce or attest destination-deny, bypass denial, host-level physical nonpersistence, provider-Redis outbound denial, or the complete role probe matrix. Gateway routing reduces accidental misuse but not compromise blast radius.
- **Migration/rollback impact:** add the approval phase/profile and residual-decision schema before activation; kill and drain both capabilities, destroy provider Redis, reconcile queues, and require reauthentication when the OAuth client changes before GCP promotion. No Railway contract DDL/DML.
- **Proof required:** ADR/blueprint parity, changed-contract tests for the new phase/profile and fail-closed predicates, complete I6/P3 and immutable-image evidence, named-cohort Railway smoke and persistence-negative checks, kill/drain rehearsal, and fresh signatures from all five roles. This policy decision is not itself a runtime approval.

### 2026-08-12 — single-accountable-owner Railway approval

- **Author:** Product owner; recorded by Main.
- **Reason:** the named closed-beta organization has one accountable operator and cannot supply five independent role owners without fabricating separation of duties.
- **Old contract:** Railway activation required five fresh residual-risk approvals from independent role owners.
- **New contract:** for `railway_closed_beta` only, one accountable owner may sign five separate role-specific approval documents. All five documents remain mandatory and must carry one exact signed `approverIdentity`; mixed identities fail closed. Production expand and final phases retain independent role ownership.
- **Risk retained:** the exception has no separation of duties. A compromised or mistaken owner can approve every Railway role, in addition to the infrastructure risks already accepted for `railway-closed-beta-1`.
- **Migration/rollback impact:** no persisted schema migration. Deploy the validator change before installing a single-owner bundle. Existing mixed-owner Railway bundles become invalid and must remain killed or be revoked; rollback kills both capabilities and removes the bundle before restoring the prior validator.
- **Proof required:** changed-contract tests proving same-owner acceptance and mixed-owner denial, a newly frozen immutable release, five separately signed role documents from the named owner, named-cohort acceptance, and the existing kill/drain controls. This ADR mutation is not itself a runtime approval.

## Contract mutation protocol

Any change to ownership, policy interpretation, capability or version names, provider origin/route/enum set, binding schema, opaque-reference audience, event/job payload, retention, Performance persistence, range semantics, DTO/status map, or acceptance evidence must update this ADR and the approved blueprint before dependent code, record migration/rollback impact and new proof, and repeat adversarial architecture/security/compliance review. A gate must never be relaxed solely to make a test pass.

Written Google authorization for different storage or aggregation is a separate future design; it does not mutate this live-only release in place.

## Primary references

- [Business Profile API policies](https://developers.google.com/my-business/content/policies)
- [Account Management `accounts.list`](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list)
- [Account Management Account schema](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts)
- [Business Information `accounts.locations.list`](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list)
- [Performance discovery schema](https://businessprofileperformance.googleapis.com/$discovery/rest?version=v1)
- [Performance `fetchMultiDailyMetricsTimeSeries`](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries)
- [Performance DailyMetric](https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [PostgreSQL concurrent indexes](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
- [Railway outbound networking](https://docs.railway.com/networking/outbound-networking)
- [Railway private networking](https://docs.railway.com/networking/private-networking)
