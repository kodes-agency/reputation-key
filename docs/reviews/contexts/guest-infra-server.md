# Guest Context — Infrastructure & Server Review

**Date:** 2026-06-10
**Scope:** `src/contexts/guest/infrastructure/`, `src/contexts/guest/server/`
**Dimensions:** D5 (Repository Ports), D7 (Multi-Tenancy), D8 (Server Functions), D12 (CONTEXT.md Accuracy), D15 (Error Handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 3     |
| NIT      | 3     |

---

## D5 — Repository & Port Standards

### [D5] MINOR — Repository port file uses bare `guest-interaction.repository.ts` naming

- **File:** `src/contexts/guest/application/ports/guest-interaction.repository.ts`
- **Quote:**
  ```
  export type GuestInteractionRepository = Readonly<{
    recordScan(scan: ScanEvent): Promise<void>
    insertRating(rating: Rating): Promise<void>
    ...
  ```
- **Rule:** D5 — Port: `{Entity}Repository` interface. The port aggregates multiple entities (ScanEvent, Rating, Feedback) under `GuestInteractionRepository` which is acceptable for a write-only context, but the file name drops the `port` suffix used by other ports in the same directory (`portal-context-resolver.port.ts`, `public-portal-lookup.port.ts`).
- **Fix:** Rename to `guest-interaction.repository.port.ts` for consistency with sibling ports, or accept as-is since the convention permits dropping `.port` for repository ports.

### [D5] NIT — `insertRating` / `insertFeedback` don't return domain objects

- **File:** `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts:35-45`
- **Quote:**
  ```
  insertRating: async (rating) => {
    return trace('guestInteraction.insertRating', async () => {
      await db.insert(ratings).values(ratingToRow(rating))
    })
  },
  ```
- **Rule:** D5 — adapter returns domain types. These insert-only methods return `void`, which is fine for pure inserts. Not a violation, just noting the asymmetry with `findFeedbackById` / `findRatingById` which do return domain types.
- **Fix:** No action needed.

### [D5] ✓ PASS — Port location correct

Port interface in `application/ports/`, factory `createGuestInteractionRepository(db)` in `infrastructure/repositories/`. Domain-generated IDs used throughout. Mapper layer converts between domain and row types cleanly.

---

## D7 — Multi-Tenancy

### [D7] MAJOR — `insertRating` and `insertFeedback` lack explicit `organizationId` WHERE clause

- **File:** `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts:35-45`
- **Quote:**

  ```
  insertRating: async (rating) => {
    return trace('guestInteraction.insertRating', async () => {
      await db.insert(ratings).values(ratingToRow(rating))
    })
  },

  insertFeedback: async (fb) => {
    return trace('guestInteraction.insertFeedback', async () => {
      await db.insert(feedback).values(feedbackToRow(fb))
    })
  },
  ```

- **Rule:** D7 — Every DB query on tenant-owned table has organizationId. Inserts do include `organizationId` in the values (via mapper), so the data is stored with tenant context. However, for defense-in-depth, the repository should validate that the domain object's `organizationId` matches the authenticated context's organization. This is mitigated by the fact that the organizationId is resolved server-side from `resolvePortalContext` (never from user input), so the tenant context is correct at the source.
- **Fix:** Low risk due to server-side resolution, but consider adding an assertion in the insert methods that the domain object's `organizationId` is present (non-null) as a safety net.

### [D7] ✓ PASS — All read queries include `organizationId` in WHERE

- `hasRated` (line 47-61): `eq(ratings.organizationId, unbrand(organizationId))` ✓
- `getLatestScanBySession` (line 64-85): `eq(scanEvents.organizationId, unbrand(organizationId))` ✓
- `findFeedbackById` (line 87-98): `eq(feedback.organizationId, unbrand(orgId))` ✓
- `findRatingById` (line 100-111): `eq(ratings.organizationId, unbrand(orgId))` ✓

### [D7] ✓ PASS — `organizationId` never from request body

Server functions resolve `organizationId` via `useCases.resolvePortalContext({ portalId })` (lines 45-47 in `public.ts`, 66-68 in `guest-scans.ts`). The portal ID acts as a capability token — the organization is derived, never user-supplied.

### [D7] ✓ PASS — Multi-tenancy isolation tested

`guest-interaction.repository.test.ts:126-143` explicitly tests that `hasRated(ORG_B, sessionId, PORTAL_A)` returns `false` for a rating created under `ORG_A`. Tenant isolation is verified.

### [D7] ✓ PASS — Resolvers correctly unscoped

`portal-context-resolver.ts` and `public-portal-lookup.ts` are correctly unscoped for `organizationId` with explicit comments explaining the design rationale: "PUBLIC API — no organizationId scoping by design. These resolvers serve unauthenticated guest requests where the portal ID acts as a capability token (unguessable UUID)."

---

## D8 — Server Functions

### [D8] MAJOR — Server functions use `tracedHandler` instead of `tracedServerFn`

- **File:** `src/contexts/guest/server/public.ts:20-21`, `src/contexts/guest/server/guest-scans.ts:53-54`
- **Quote:**
  ```
  export const submitRatingFn = createServerFn({ method: 'POST' })
    .inputValidator(ratingInputSchema)
    .handler(
      tracedHandler(
  ```
- **Rule:** D8 — Wrapped in `tracedServerFn`, auth middleware, input validation, permission check, use case from composition. Guest functions use `createServerFn` + `tracedHandler` wrapper instead. This is architecturally correct for guest endpoints (no auth middleware needed — public by design), but deviates from the D8 standard. The `tracedHandler` provides tracing without auth. Input validation is present via `.inputValidator()`.
- **Fix:** Document the exception in CONTEXT.md or align with a `tracedPublicServerFn` pattern. The current approach is functionally correct for public endpoints.

### [D8] ✓ PASS — Input validation via Zod schemas

All server functions validate input: `recordScanSchema`, `ratingInputSchema`, `feedbackInputSchema`, `publicPortalSchema`, `resolveLinkSchema`.

### [D8] ✓ PASS — Error translation consistent

All server functions catch errors, translate domain errors via `isGuestError` + `guestErrorStatus` + `throwContextError`, and re-throw untagged errors via `catchUntagged`. The `guestErrorStatus` function uses exhaustive `ts-pattern` matching ensuring new error codes are caught at compile time.

### [D8] ✓ PASS — Use cases from composition root

`getContainer()` provides use cases; server functions are thin orchestration layers.

---

## D12 — CONTEXT.md Accuracy

### [D12] ✓ PASS — Events consumed: None

CONTEXT.md §Events consumed says "None." The `infrastructure/event-handlers/` directory is empty with a README confirming guest is event-producer only.

### [D12] ✓ PASS — Architecture layers match

CONTEXT.md lists:

- `infrastructure/repositories/guest-interaction.repository.ts` — exists ✓
- `infrastructure/mappers/guest.mapper.ts` — exists ✓
- `infrastructure/resolvers/portal-context-resolver.ts` — exists ✓
- `infrastructure/resolvers/public-portal-lookup.ts` — exists ✓
- `server/public.ts` — exists ✓

### [D12] MINOR — CONTEXT.md lists `server/public.ts` but actual implementation is split across `public.ts` + `guest-scans.ts`

- **File:** `src/contexts/guest/CONTEXT.md:66`
- **Quote:**
  ```
  server/              public.ts
  ```
- **Rule:** D12 — Verify CONTEXT.md claims match actual code. The `server/` directory contains `public.ts`, `guest-scans.ts`, and `public.test.ts`. CONTEXT.md only lists `public.ts`. The `guest-scans.ts` file exports `recordScanFn`, `getPublicPortal`, `resolveLinkAndTrack`, and `hashIp` — three server functions and a helper.
- **Fix:** Update CONTEXT.md to reflect the split:
  ```
  server/              public.ts, guest-scans.ts
  ```

### [D12] MINOR — CONTEXT.md server functions section incomplete

- **File:** `src/contexts/guest/CONTEXT.md:90`
- **Quote:**
  ```
  - **`public.ts`** — Guest-facing server functions (record scan, submit rating, submit feedback, track review link click, get public portal data). No authentication required — guest endpoints.
  ```
- **Rule:** D12 — Verify CONTEXT.md claims match actual code. The `resolveLinkAndTrack` server function exists in `guest-scans.ts` but is not listed in the server functions section. Additionally, the section references `public.ts` as the sole file.
- **Fix:** Add `resolveLinkAndTrack` to the server functions description and mention `guest-scans.ts`.

### [D12] MINOR — CONTEXT.md permissions list `review_link:click` but actual code has no permission checks

- **File:** `src/contexts/guest/CONTEXT.md:100`
- **Quote:**
  ```
  - `review_link:click` — Track a review link click. Public.
  ```
- **Rule:** D12 — Verify CONTEXT.md claims match actual code. The CONTEXT.md lists granular permission strings (`scan:create`, `rating:create`, `feedback:create`, `review_link:click`, `portal:read`), but no server function enforces these via `can(role, permission)`. All endpoints are unauthenticated. The permission list appears aspirational or documentation-only.
- **Fix:** Either remove the permission list or clarify these are logical operation identifiers for tracing/auditing only, not enforced permission checks (since guest is fully public).

---

## D15 — Error Handling

### [D15] ✓ PASS — Domain errors use `guestError()` factory, not `throw new Error`

All domain error creation goes through `guestError(code, message)` which returns a typed `GuestError` with `_tag: 'GuestError'`.

### [D15] ✓ PASS — No bare catch blocks

All catch blocks check `isGuestError(e)` and either translate via `throwContextError` or re-throw via `catchUntagged(e)`.

### [D15] ✓ PASS — No HTTP codes in domain

`domain/errors.ts` defines only `GuestErrorCode` and `GuestError` — no HTTP status codes. Status mapping is in `server/guest-scans.ts` (`guestErrorStatus`), which is the correct layer.

### [D15] ✓ PASS — Consistent error envelope

All server functions use the same pattern: `throwContextError('GuestError', e, guestErrorStatus(e.code))` producing a consistent error response.

### [D15] NIT — Honeypot silently returns success without error

- **File:** `src/contexts/guest/server/public.ts:79-81`
- **Quote:**
  ```
  // Honeypot check
  if (data.honeypot) {
    return { success: true, blocked: true }
  }
  ```
- **Rule:** D15 — Consistent error handling. The honeypot block silently returns `{ success: true, blocked: true }` which is correct anti-spam behavior (don't reveal the block), but the `blocked: true` field leaks that the submission was detected as spam to any caller observing the response shape. If the API contract is internal-only this is fine.
- **Fix:** Consider returning `{ success: true }` without `blocked: true` to avoid leaking detection to bot authors who might observe response payloads.

### [D15] NIT — `public-portal-lookup.ts` uses fragile `_tag` string check for error re-throwing

- **File:** `src/contexts/guest/infrastructure/resolvers/public-portal-lookup.ts:17-28`
- **Quote:**
  ```
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      '_tag' in err &&
      (err as { _tag: string })._tag === 'portal_inactive'
    ) {
      throw guestError('portal_inactive', 'Portal is inactive')
    }
    throw err
  }
  ```
- **Rule:** D15 — Consistent error envelope. The resolver checks for `_tag === 'portal_inactive'` from the portal context's error type without importing the portal's error guard. This is a cross-context error type assumption that could break silently if portal changes its error shape.
- **Fix:** Import and use the portal context's `isPortalError` guard (if exported from `public-api.ts`) instead of manually checking `_tag`.

---

## Additional Observations

### [D1] ✓ PASS — Infrastructure layer boundaries correct

Infrastructure imports domain types, application ports, and shared libraries. No React, TanStack, or framework imports in infrastructure. Server layer imports domain errors, application DTOs, and shared infrastructure (`tracedHandler`, `headersFromContext`).

### [D1] ✓ PASS — Server layer boundaries correct

Server functions don't contain business logic — they orchestrate: resolve context → call use case → translate errors. No direct DB access.

### NIT — `guest-scans.ts` imports `getEnv` for IP hashing

- **File:** `src/contexts/guest/server/guest-scans.ts:14,37-42`
- **Quote:**
  ```
  import { getEnv } from '#/shared/config/env'
  ...
  export function hashIp(ip: string): string {
    const env = getEnv()
    const today = new Date().toISOString().slice(0, 10)
    const salt = `${env.GUEST_SESSION_SALT}:${today}`
    return createHash('sha256').update(`${ip}:${salt}`).digest('hex')
  }
  ```
- **Rule:** D8 — Server functions should be thin. The `hashIp` function is infrastructure utility logic. It's in the server layer which is acceptable since it's a server-side-only concern (needs env access + crypto), but could be extracted to `infrastructure/` if it grows.
- **Fix:** Low priority; acceptable as-is.
