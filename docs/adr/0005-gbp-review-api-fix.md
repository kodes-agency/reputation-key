# ADR 0005 — GBP Review API Path and Error Model Fix

**Status:** Accepted
**Date:** 2026-05-19

The GBP Reviews API returns 404 because (1) the Business Information API stores location names as `locations/{id}` but the Reviews API requires `accounts/{accountId}/locations/{id}`, and (2) `integrationError` is a plain object without `Error` prototype, losing stack traces and breaking `instanceof` checks. We fix the path at import time by enriching `GbpLocation.name` with the account prefix in the `listGbpLocations` use case, change the adapter base URL from v1 to v4, and extend `integrationError` to inherit from `Error` with a `recoverable` flag.

## Considered Options

### Path resolution

- **Import-time enrichment (chosen):** The `listGbpLocations` use case prepends `accounts/{accountName}/` to `GbpLocation.name` before returning. Stored as `gbpLocationName` in the database. Computed once, durable, no extra API calls during sync.
- **Adapter resolves account at sync time:** Review adapter calls `listAccounts` to derive the full path. Extra API call per sync, zero schema changes, but adds latency and an unnecessary dependency on the accounts endpoint.
- **Store `gbpAccountName` on connection:** Add account name to `GoogleConnection`. Requires connection flow changes and assumes one GBP account per connection (not always true).

### Error model

- **Hybrid `Error` + tagged union (chosen):** Same pattern as `GbpApiError` — `integrationError()` returns `Error & IntegrationError` via `Object.defineProperties`. Adds `recoverable: boolean`. Existing call sites unchanged. Consistent with codebase convention of tagged unions over classes.
- **Class-based `IntegrationError`:** `class IntegrationError extends Error`. Cleaner JavaScript but violates the project convention of "no class, use tagged discriminated unions" (documented in `gbp-api-error.ts`).

## Consequences

- `GbpLocation.name` semantics change from short-form (`locations/{id}`) to full-form (`accounts/{accountId}/locations/{id}`). Only consumer is the import flow, which stores it as `gbpLocationName` — no downstream breakage.
- Existing properties with short-form `gbpLocationName` need re-import (dev data only, no migration written).
- `integrationError` now carries stack traces. The `[object Object]` serialization in logs is resolved automatically.
- Callers can check `recoverable` to decide retry behavior: 429 (rate limit) is retryable, 401/403 (auth failure) is not.
- The two Google adapters (`gbp-api.adapter.ts` and `google-review-api.adapter.ts`) remain separate — different port contracts, different auth patterns, different bounded contexts.
