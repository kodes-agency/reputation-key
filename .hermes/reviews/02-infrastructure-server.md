# Review: Infrastructure + Server + Shared Jobs

## Summary

**21 files reviewed** spanning infrastructure adapters, repositories, mappers, server functions, shared job infrastructure, composition, and bootstrap. Overall the codebase is well-structured and follows hexagonal architecture conventions closely. Found **3 critical, 5 high, 7 medium, and 6 low** issues.

---

## Critical Issues (P0)

### P0-1: Duplicate import-property handler — shared/jobs dead code + divergence risk

- File: `src/shared/jobs/handlers/import-property.ts` — 207 lines
- File: `src/contexts/integration/infrastructure/jobs/import-property.job.ts` — 207 lines (identical copy)
- Description: Two **byte-for-byte identical** copies of the `importPropertyHandler` exist. The context-level copy (`infrastructure/jobs/import-property.job.ts`) is what bootstrap registers. The shared-level copy (`shared/jobs/handlers/import-property.ts`) is **never imported anywhere** — zero references found across the entire codebase. This is dead code that will silently rot. If someone edits one copy and not the other, the job behavior diverges. **Remove the shared copy immediately.**

### P0-2: GoogleOAuthAdapter throws raw `Error` instead of domain-tagged `IntegrationError`

- File: `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts` — Lines 43, 57, 72, 107, 135
- Description: The OAuth adapter is an infrastructure adapter and per layer behavior rules **must catch+translate lib errors to domain errors**. Instead it throws plain `new Error(...)` for all failure modes (code exchange failure, missing refresh token, user-info fetch failure, token refresh failure, revoke failure). These are thrown as untagged errors that bypass the `isIntegrationError()` check in server functions, causing them to hit the `catchUntagged` safety net and return a generic 500 instead of the appropriate domain-specific error code. The adapter should throw `integrationError('oauth_failed', ...)` or a tagged equivalent.

### P0-3: Dead job handlers — syncGbpCacheHandler and purgeExpiredCacheHandler never registered

- File: `src/shared/jobs/handlers/sync-gbp-cache.ts` — Lines 14, 39
- File: `src/bootstrap.ts`
- Description: `syncGbpCacheHandler` and `purgeExpiredCacheHandler` are exported but **never registered** in `bootstrap.ts` and **never referenced** anywhere else in the codebase. They are completely dead code. The `syncGbpCacheHandler` is also partially implemented (it queries properties but does nothing with the result — see P1-2). The `purgeExpiredCacheHandler` has actual logic (deleting expired cache entries) but is orphaned.

---

## High Issues (P1)

### P1-1: GbpApiAdapter helper functions throw raw `Error` — not translated to domain errors

- File: `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts` — Lines 140, 147, 152, 165, 173, 178
- Description: The private `mapGbpAccount()` and `mapGbpLocation()` helper functions throw `new Error('Invalid GBP account data')` etc. These are called from within the adapter's public methods. While the main API error paths correctly create `GbpApiError`, these mapping failures throw untagged `Error` objects that won't be caught by `isIntegrationError()` or `isGbpApiError()` checks in application/server layers. They should throw `createGbpApiError(...)` or `integrationError(...)` to maintain the domain error contract.

### P1-2: sync-gbp-cache handler is a no-op stub — queries data then discards it

- File: `src/shared/jobs/handlers/sync-gbp-cache.ts` — Lines 14-36
- Description: The `syncGbpCacheHandler` queries `linkedProperties` from the database (line 20-29) but then does nothing with the result (line 31: `if (linkedProperties.length === 0) return` followed by a comment explaining it's incomplete). This handler was never connected to the real GBP API sync flow. If someone registers this job via a scheduler, it would silently succeed without doing anything, giving a false sense of data freshness.

### P1-3: Token encryption adapter has no key-length validation

- File: `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts` — Line 10
- Description: `Buffer.from(getEnv().ENCRYPTION_KEY, 'hex')` creates the key. AES-256-GCM requires exactly 32 bytes. If `ENCRYPTION_KEY` is the wrong length (too short, too long, or not valid hex), the error surfaces as a cryptic Node.js crypto error at runtime rather than a clear startup error. Add an explicit validation: `if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)')`.

### P1-4: import-property.job.ts exceeds 150-line soft limit significantly (207 lines)

- File: `src/contexts/integration/infrastructure/jobs/import-property.job.ts` — 207 lines
- Description: This file is 38% over the 150-line soft limit. The inner loop with its per-location error handling, the race-condition detection for PG 23505, and the final status logic create a complex, deeply nested function. Consider extracting: (1) a `processLocation()` helper, (2) a `determineFinalStatus()` helper, (3) the batch-fetch logic into their own functions.

### P1-5: google-connection.repository.ts exceeds 150-line soft limit (187 lines)

- File: `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts` — 187 lines
- Description: The file is 25% over the soft limit. The `updateTokens`, `updateTokensAndStatus`, and `updateReconnection` methods are structurally near-identical Drizzle `UPDATE` calls. Consider whether all three variants are needed, or if a single method with optional parameters could reduce duplication.

---

## Medium Issues (P2)

### P2-1: gbp-api.adapter.ts exceeds 150-line soft limit (206 lines)

- File: `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts` — 206 lines
- Description: The file contains both the adapter factory and two private mapping functions (`mapGbpAccount`, `mapGbpLocation`). Extract the mapping functions to a dedicated mapper file (consistent with the pattern used for `gbp-cache.mapper.ts`, `gbp-import.mapper.ts`, etc.).

### P2-2: google-connections.ts exceeds 150-line soft limit (183 lines)

- File: `src/contexts/integration/server/google-connections.ts` — 183 lines
- Description: Contains 5 server functions plus state-signing helpers. The `getGoogleAuthUrl` handler is the most complex (OAuth URL construction). Consider extracting the state signing helpers to a separate utility file.

### P2-3: batchGetReviews returns `unknown` type for reviews

- File: `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts` — Lines 102, 124-127
- File: `src/contexts/integration/application/ports/gbp-api.port.ts` — Line 25
- Description: The `batchGetReviews` method returns `reviews: unknown` with no type safety. This forces consumers to cast or treat reviews as opaque. While this may be intentional (GBP review schema complexity), it creates a gap where downstream code operates on untyped data.

### P2-4: Job queue factory passes shared Redis client — potential blocking issues

- File: `src/shared/jobs/queue.ts` — Lines 19-31
- Description: `createJobQueue()` creates a `Queue` using `getRedis()` which returns the shared Redis client with `maxRetriesPerRequest: 3`. The worker factory (`createJobWorker`) correctly creates a dedicated connection with `maxRetriesPerRequest: null`. However, the `Queue` (used for enqueuing) also uses blocking-compatible settings — this is less critical for Queue vs Worker, but BullMQ docs recommend dedicated connections for Queue as well under high throughput. Worth noting for production scaling.

### P2-5: getGoogleAuthUrl handler doesn't use tenant context result

- File: `src/contexts/integration/server/google-connections.ts` — Line 47
- Description: `await resolveTenantContext(headers)` is called but the result is discarded. This is presumably just for authentication verification (ensure user is logged in), but it means the OAuth URL is not scoped to the user's organization. The `state` parameter carries `visibility` but not `organizationId`, meaning the callback handler must somehow determine the org. This could be a security concern if the callback is not properly validating org membership.

### P2-6: health-check.job.ts imports `pino` directly instead of using `getLogger()`

- File: `src/shared/jobs/health-check.job.ts` — Line 6
- Description: `import pino from 'pino'` is used for the `HealthCheckDeps` type (`logger: pino.Logger`). While the deps pattern is fine (dependency injection), the direct `pino` import creates a tight coupling. Other files use `import { getLogger } from '#/shared/observability/logger'`. Consider using a `Logger` interface type instead.

### P2-7: createJobQueue passes `Queue` as `connection` — may not match BullMQ's expected IORedis connection

- File: `src/shared/jobs/queue.ts` — Line 23
- Description: `getRedis()` returns an `ioredis.Redis` instance, and BullMQ's `Queue` accepts `ConnectionOptions`. This works at runtime because ioredis `Redis` satisfies the connection interface, but the type mismatch (`Redis | undefined` returned by `getRedis()`) is handled by the early return on line 21. This is acceptable but fragile.

---

## Low Issues (P3 / Suggestions)

### P3-1: composition.ts singleton container is not thread-safe

- File: `src/composition.ts` — Lines 232-240
- Description: `_container` is a module-scoped `let` variable checked lazily. In Node.js single-threaded model this is fine, but if ever used in a worker thread or Edge runtime, it could be initialized multiple times. Consider using `globalThis` for true singleton pattern if needed.

### P3-2: google-connections.ts `getAuthUrlInputSchema` defined locally in server file

- File: `src/contexts/integration/server/google-connections.ts` — Lines 34-36
- Description: All other server functions import their input schemas from `application/dto/`. The `getAuthUrlInputSchema` is defined inline in the server file, breaking the pattern. Consider moving it to `application/dto/get-auth-url.dto.ts`.

### P3-3: buildIntegrationContext uses non-null assertion `deps.jobQueue!`

- File: `src/contexts/integration/build.ts` — Line 50
- Description: `deps.jobQueue!.add(...)` uses a non-null assertion inside a truthy branch. While technically safe (the ternary ensures it's defined), it would be cleaner to capture the queue in a local `const` after the truthy check.

### P3-4: gbp-api.adapter.ts `as` type assertions in mapping functions

- File: `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts` — Lines 143, 144, 155, 159, 169, 170, 182-192, 197
- Description: Multiple `as` type assertions (`as Record<string, unknown>`, `as string | undefined`, etc.) in the mapping functions. While these are reasonably safe after the initial type guards, they are technically non-null/type assertions. Consider using a runtime validation library (zod) for the GBP API response shapes.

### P3-5: No rate-limiting on GBP API calls

- File: `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`
- Description: The adapter makes paginated API calls in loops (`do...while` with `nextPageToken`). For accounts with many locations (hundreds+), this could trigger Google's rate limits. Consider adding configurable delays or using the `batchGet` endpoints more aggressively.

### P3-6: `fallow-ignore-next-line` comments appear unused

- File: `src/shared/jobs/queue.ts` — Line 11
- File: `src/shared/jobs/worker.ts` — Lines 10, 12
- Description: `// fallow-ignore-next-line unused-type` appears multiple times. If `fallow` is not configured as a linting tool in this project, these comments are dead code. If it is configured, they should be `// eslint-disable-next-line` or the project's actual lint directive format.

---

## Positive Findings

1. **Excellent hexagonal architecture adherence.** Layer boundaries are clean: adapters implement ports, repositories implement repository ports, mappers are pure functions isolated in their own files.

2. **Strong security posture for OAuth tokens.** Tokens are encrypted at rest with AES-256-GCM (12-byte IV, authenticated encryption with auth tag). The encryption format (`iv:authTag:ciphertext`) is well-documented. OAuth state is HMAC-signed to prevent forgery.

3. **Proper BullMQ worker configuration.** The worker factory (`createJobWorker`) correctly uses `maxRetriesPerRequest: null` with a dedicated Redis connection, avoiding the common pitfall of sharing the caching Redis client with blocking workers.

4. **Robust error handling in import-property job.** The handler correctly detects PG 23505 unique constraint violations and distinguishes between race conditions (treat as skip) and real failures (treat as error). The outer try/catch ensures the job always transitions out of `in_progress` status.

5. **Clean server function pattern.** All server functions consistently use `tracedHandler`, `resolveTenantContext`, and proper error mapping via `isIntegrationError()` + `throwContextError()`. The `tracedHandler` wrapper handles `clearTenantCache()` in both success and error paths.

6. **Well-designed job registry pattern.** The `JobRegistry` uses a functional factory returning a record of functions (no classes), and bootstrap is cleanly separated from composition.

7. **Tenant isolation in repositories.** Every repository method takes `organizationId` as a parameter and uses it in WHERE clauses, ensuring proper multi-tenant data isolation.

8. **Consistent mapper pattern.** All three mappers (`gbp-cache`, `gbp-import`, `google-connection`) follow the same pattern: typed row inference from Drizzle schema, separate `fromRow` and `toInsert` functions, and proper branded ID wrapping.

9. **No `console.*` usage.** All files use the `getLogger()` facility for logging.

10. **No hardcoded secrets.** All sensitive values (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`) are sourced from `getEnv()`.

---

## Files Reviewed

| #   | File                                                                                   | Lines |
| --- | -------------------------------------------------------------------------------------- | ----- |
| 1   | `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`                  | 206   |
| 2   | `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`             | 144   |
| 3   | `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts`         | 44    |
| 4   | `src/contexts/integration/infrastructure/jobs/import-property.job.ts`                  | 207   |
| 5   | `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts`                  | 31    |
| 6   | `src/contexts/integration/infrastructure/mappers/gbp-import.mapper.ts`                 | 35    |
| 7   | `src/contexts/integration/infrastructure/mappers/google-connection.mapper.ts`          | 43    |
| 8   | `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`         | 92    |
| 9   | `src/contexts/integration/infrastructure/repositories/gbp-import.repository.ts`        | 88    |
| 10  | `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts` | 187   |
| 11  | `src/contexts/integration/server/gbp-import.ts`                                        | 90    |
| 12  | `src/contexts/integration/server/google-connections.ts`                                | 183   |
| 13  | `src/contexts/integration/server/shared.ts`                                            | 22    |
| 14  | `src/shared/jobs/queue.ts`                                                             | 31    |
| 15  | `src/shared/jobs/worker.ts`                                                            | 62    |
| 16  | `src/shared/jobs/registry.ts`                                                          | 31    |
| 17  | `src/shared/jobs/health-check.job.ts`                                                  | 46    |
| 18  | `src/shared/jobs/handlers/import-property.ts`                                          | 207   |
| 19  | `src/shared/jobs/handlers/sync-gbp-cache.ts`                                           | 44    |
| 20  | `src/composition.ts`                                                                   | 240   |
| 21  | `src/bootstrap.ts`                                                                     | 61    |
| 22  | `src/shared/cache/redis.ts`                                                            | 38    |

**Total: 22 files, ~2,083 lines of code reviewed.**
