---
status: accepted
date: 2026-08-10
---

# 0050 — Google property import and live Performance reporting

Accepted 2026-08-10 and amended 2026-08-12 under the former `railway_closed_beta_exception_accepted` release state; the machine-bound approval state was later removed, while the external Google contracts below remain.

## Context

This decision preserves the external Google content, OAuth, provider-route, and
live-only reporting boundaries for the independently controlled
`property.import_gbp_v2` and `property.read_gbp_performance` capabilities.
Google requires temporary secure content storage, manual end-user sign-in,
exact registered OAuth redirects, and `business.manage` for the Account
Management and Business Information endpoints.

## Decision

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

Request-lifetime period sums and chart composition are reporting transformations, not durable manipulation.

### 5. OAuth/OIDC integrity

OAuth state v2 is a random 256-bit opaque handle. Provider Redis holds the authoritative record for at most ten minutes under an audience-separated HMAC. The record fixes organization, initiating user, visibility, server-selected purpose, connection mode/target or global absence, return-route key, independent OIDC nonce, PKCE S256 verifier/challenge, issue/expiry, and the initiating Better Auth session binding.

The initiating-session binding is a versioned, audience-separated HMAC of the stable server-side session ID. The raw session ID/cookie is never persisted. Callback handling re-resolves the same-site authenticated session and active organization, then atomically compares session digest, user, and organization before consuming state. Sessionless or mismatched callbacks:

- do not consume another browser's state;
- do not call token, JWKS, or another provider route;
- do not mutate or disclose tenant state; and
- use one fixed generic redirect.

V2 requests exactly `openid` and `https://www.googleapis.com/auth/business.manage`; the normalized granted set must match exactly. Signed OIDC `sub` is the sole Google connection identity. `googleSubject` replaces the misleading `googleAccountId`; it is distinct from a Business Profile account suffix. V1 state/event support exists only for the measured compatibility window and is drained before contract removal. There is no dual emit or downgrade.

Initial exchange never calls `/revoke`: before the subject is authoritative, the returned credential cannot be proven safe to revoke without risking another valid authority. Credential lifecycle and cleanup instead use the serialized source/guard/child contract below.

#### Why the OAuth state record key is keyed

The handle is the OAuth `state` value. It is sent to Google in a redirect URL
and comes back in another, so it survives in browser history, `Referer`
headers, proxy and CDN access logs, and any analytics that captures query
strings. Under the unkeyed digest, anyone who obtained one of those copies
could compute the exact `provider-ephemeral:{oauth-state}:<key>` location
holding that ceremony's PKCE code verifier and OIDC nonce — no secret required.
Keying the derivation means a leaked `state` is no longer sufficient on its
own; the keyring secret is also needed.

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

### 10. Live Performance reporting contract

The Performance range key is independent from Dashboard `timeRange` and accepts exactly `7d|30d|90d|180d`, defaulting invalid/multiple input to `30d`. Current is the selected number of Property-local dates ending at confirmed local yesterday; prior is the immediately preceding equal range. One request covers at most 360 days.

Omitted provider values are zero. A missing requested date or series is unavailable, not zero. Deltas require equal requested lengths, complete like-for-like constituent coverage, and non-zero prior. Request-memory-only derived values are:

- total profile impressions = four device/surface counters;
- Search impressions = desktop Search + mobile Search;
- Maps impressions = desktop Maps + mobile Maps.

These are not unique-person totals. The UI shows no conversion rate and never describes call clicks as completed calls. Source, period, retrieval time, coverage, and missing-data limitations are explicit.

The frozen presentation result is `PropertyGooglePerformanceResultV1`. Base Dashboard data renders independently from provider latency or failure. The live dependency boundary accepts only policy, authorization lease, Property read, Google source, clock, and code-only authorization-audit dependencies. Write repositories, queues/jobs, server caches, and Metric dependencies are denied.

## Consequences

- Import discovery remains content-minimized and short-lived; live Performance
  values never become durable application data.
- Unknown routes, metrics, scopes, state bindings, or report coverage fail only
  the affected Google operation and do not invent provider truth.
