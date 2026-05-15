# Review: Domain + Application + Build

## Summary

**30 files reviewed** spanning domain types/errors/events/constructors/rules, application ports/DTOs/use-cases, and the build function. Overall the layers are exceptionally clean and follow hexagonal architecture conventions closely. Found **0 critical, 1 high, 5 medium, and 3 low** issues.

The domain layer is pure (no async, no I/O, no classes). Application use cases consistently throw tagged `IntegrationError`. The build function correctly wires deps through factory functions. DTOs use Zod v4 for validation.

---

## Critical Issues (P0)

None found.

---

## High Issues (P1)

### P1-1: `GbpApiError` is a hybrid — tagged union + Error class — breaks pure domain convention

- File: `src/contexts/integration/domain/gbp-api-error.ts` — Lines 14-28
- Description: `createGbpApiError` creates a `new Error(...)` then uses `Object.defineProperties` to graft on `_tag`, `operation`, `status`, `body`. This is a runtime class instance masquerading as a tagged union. The type says `GbpApiError` is `Readonly<{ _tag, operation, status, body, message }>` but the actual value is an `Error` instance. This breaks the "no class" convention (Error is a class), and the `Object.defineProperties` approach creates non-writable, non-configurable properties which could cause issues with serialization or spread operators. A cleaner approach: make `GbpApiError` a plain object with a `toError()` helper for when you need stack traces, or keep the current approach but document why the hybrid is needed (pino serialization).

---

## Medium Issues (P2)

### P2-1: `buildGoogleConnection` performs email validation with weak heuristic

- File: `src/contexts/integration/domain/constructors.ts` — Line 29
- Description: `!args.googleEmail.includes('@')` is too permissive — `@` alone passes. Should use a proper email regex or Zod's `.email()` validator. This is in the domain layer so it should be a pure validation rule, but the current check would accept `@`, `@@`, etc.

### P2-2: `GbpCacheEntry.payload` is typed `unknown` — no type safety for cached data

- File: `src/contexts/integration/domain/types.ts` — Line 40
- Description: The `payload` field on `GbpCacheEntry` is `unknown`. While this may be intentional for flexibility (GBP API responses vary), it forces consumers to cast everywhere. Consider a discriminated union: `{ dataType: 'location', payload: GbpLocation } | { dataType: 'reviews', payload: GbpReviews }`.

### P2-3: Use case `connect-google-account` does not verify scopes match expectations

- File: `src/contexts/integration/application/use-cases/connect-google-account.ts`
- Description: After OAuth callback, the token response includes `scope` but the use case doesn't verify that the granted scopes match the requested scopes. A user could grant partial consent (e.g., only `business.manage` without `userinfo.email`), leading to later failures when trying to access user info. The use case should validate that all required scopes are present before creating the connection.

### P2-4: Use case `disconnect-google-account` silently succeeds even if token revocation fails

- File: `src/contexts/integration/application/use-cases/disconnect-google-account.ts`
- Description: The use case calls `deps.oauth.revokeToken(accessToken)` but catches and logs the error, proceeding to mark the connection as disconnected regardless. This is a reasonable design choice (best-effort revocation), but it should be documented explicitly in a comment so future maintainers understand the intent.

### P2-5: `build.ts` queuePort fallback error message is misleading

- File: `src/contexts/integration/build.ts` — Line 59
- Description: The error message says "enableJobs not set" but after the composition.ts change (queue now created when Redis is available, not gated by `enableJobs`), this message is misleading. It should say "Redis not available" or "Job queue not configured" to match the actual condition.

---

## Low Issues (P3 / Suggestions)

### P3-1: `constants.ts` has only one export

- File: `src/contexts/integration/application/constants.ts` — 4 lines
- Description: Contains only `GBP_API_BASE`. Could be inlined where used or moved to the port file that defines the GBP API contract. A separate file for one constant is over-modular.

### P3-2: Domain types re-export branded IDs redundantly

- File: `src/contexts/integration/domain/types.ts` — Lines 77-78
- Description: `export type { GoogleConnectionId, GbpImportJobId }` and `export type { PropertyId }` re-export from `#/shared/domain/ids`. Consumers should import directly from `#/shared/domain/ids` rather than through the domain types barrel. This creates two import paths for the same type.

### P3-3: DTO files are thin wrappers — consider consolidating

- Files: `src/contexts/integration/application/dto/*.ts` — 6 files, 80 lines total
- Description: Each DTO file is 10-20 lines (schema + inferred type). While the single-responsibility is clean, having 6 separate files for thin schemas adds import noise. A `dto/index.ts` barrel re-export would reduce import paths.

---

## Positive Findings

1. **Domain layer is perfectly pure.** No `async`, no I/O, no mutations, no classes. `constructors.ts` returns `Result<T, E>` via neverthrow. `rules.ts` is a pure validation function. `events.ts` uses past-tense naming correctly.

2. **Excellent error design.** `IntegrationError` is a proper tagged union with `_tag: 'IntegrationError'`, typed error codes, and a type guard (`isIntegrationError`). All use cases throw this consistently.

3. **Use cases follow the factory pattern perfectly.** Every use case is `(deps) => async (input, ctx) => Promise<T>`, with typed ports as dependencies. No use case directly accesses infrastructure.

4. **DTOs use Zod v4 consistently.** All input validation schemas use `z` from `zod/v4` with proper `.min()`, `.url()`, and branded ID validation.

5. **Build function is clean.** Proper separation: repos → adapters → queue port → use cases. The queue port correctly falls back to a throw-on-call stub when no queue is available.

6. **Events are well-designed.** All four event types are properly discriminated by `_tag`, use past-tense names, and include relevant context (IDs, counts, timestamps).

7. **No `console.*` usage, no `any`, no non-null assertions** in any domain or application file.

8. **All files use kebab-case filenames, named exports, and stay well under the 150-line limit.** The largest file is `connect-google-account.ts` at 126 lines.

---

## Files Reviewed

| #   | File                                                                             | Lines |
| --- | -------------------------------------------------------------------------------- | ----- |
| 1   | `src/contexts/integration/domain/types.ts`                                       | 78    |
| 2   | `src/contexts/integration/domain/errors.ts`                                      | 35    |
| 3   | `src/contexts/integration/domain/events.ts`                                      | 67    |
| 4   | `src/contexts/integration/domain/gbp-api-error.ts`                               | 28    |
| 5   | `src/contexts/integration/domain/constructors.ts`                                | 75    |
| 6   | `src/contexts/integration/domain/rules.ts`                                       | 8     |
| 7   | `src/contexts/integration/application/ports/gbp-api.port.ts`                     | 26    |
| 8   | `src/contexts/integration/application/ports/gbp-cache.repository.ts`             | 17    |
| 9   | `src/contexts/integration/application/ports/gbp-import.repository.ts`            | 20    |
| 10  | `src/contexts/integration/application/ports/gbp-queue.port.ts`                   | 19    |
| 11  | `src/contexts/integration/application/ports/google-connection.repository.ts`     | 63    |
| 12  | `src/contexts/integration/application/ports/google-oauth.port.ts`                | 20    |
| 13  | `src/contexts/integration/application/ports/token-encryption.port.ts`            | 8     |
| 14  | `src/contexts/integration/application/dto/connect-google.dto.ts`                 | 12    |
| 15  | `src/contexts/integration/application/dto/disconnect-google.dto.ts`              | 11    |
| 16  | `src/contexts/integration/application/dto/import-properties.dto.ts`              | 21    |
| 17  | `src/contexts/integration/application/dto/import-status.dto.ts`                  | 11    |
| 18  | `src/contexts/integration/application/dto/list-locations.dto.ts`                 | 11    |
| 19  | `src/contexts/integration/application/dto/update-connection-visibility.dto.ts`   | 14    |
| 20  | `src/contexts/integration/application/use-cases/connect-google-account.ts`       | 126   |
| 21  | `src/contexts/integration/application/use-cases/disconnect-google-account.ts`    | 91    |
| 22  | `src/contexts/integration/application/use-cases/get-import-status.ts`            | 29    |
| 23  | `src/contexts/integration/application/use-cases/list-gbp-locations.ts`           | 122   |
| 24  | `src/contexts/integration/application/use-cases/list-google-connections.ts`      | 22    |
| 25  | `src/contexts/integration/application/use-cases/refresh-google-token.ts`         | 79    |
| 26  | `src/contexts/integration/application/use-cases/start-property-import.ts`        | 89    |
| 27  | `src/contexts/integration/application/use-cases/update-connection-visibility.ts` | 73    |
| 28  | `src/contexts/integration/application/use-cases/index.ts`                        | 50    |
| 29  | `src/contexts/integration/application/constants.ts`                              | 4     |
| 30  | `src/contexts/integration/build.ts`                                              | 122   |

**Total: 30 files, ~1,462 lines of code reviewed.**
