# Review: Portal, Guest, Team, Staff + Routes + Components

## Summary

Reviewed 4 bounded contexts (Portal, Guest, Team, Staff), all route files, and all component files across the project. The overall architecture is solid — clean hexagonal boundaries, proper use case 7-step patterns, good tenant isolation. However, several **security-critical issues** demand immediate attention, and a handful of convention violations need cleanup.

**Severity distribution:** 3 Critical (P0/P1), 7 Warnings (P2), 12 Minor (P3), 6 Security Findings.

---

## Critical Issues (P0/P1)

### C-01. Open Redirect via Click Tracking — `resolveLinkAndTrack` returns arbitrary URL with no validation

**File:** `src/contexts/guest/server/public.ts:191-235`
**Severity:** P0 — Security

The `resolveLinkAndTrack` server function queries a `portalLinks` row by ID and blindly returns its `url` field as a 302 redirect destination. The URL stored in `portalLinks` is user-supplied content (set by PropertyManager when creating links). There is **no URL validation at write time** (no scheme allowlist, no domain check) and **no validation at read time**.

An attacker with PropertyManager access (or via a compromised account) can insert a link with `url: javascript:alert(1)` or `url: https://evil-phishing.com` and the click-tracking endpoint will happily redirect any guest to it.

**Fix:** Validate URLs at link creation time (in `createLink` / `updateLink` use cases) — allow only `https://` scheme, reject `javascript:`, `data:`, etc. Optionally validate at redirect time too as defense-in-depth.

### C-02. QR code API has no authentication — any portal ID can be enumerated

**File:** `src/contexts/portal/server/portals.ts:244-290`, `src/routes/api/portals/$id/qr.ts`
**Severity:** P1 — Security

The `getPortalForQR` server function explicitly states "No auth required — this is called from a public API route." The QR route passes `params.id` directly, meaning **any unauthenticated user can enumerate portal IDs** to generate QR codes for any portal in the system. The response also leaks the organization slug.

While the QR image itself isn't sensitive (it just encodes a public URL), the lack of auth means:

1. Portal ID enumeration is trivial
2. Organization slug leakage from internal DB query
3. Direct `getContainer().db` usage bypasses the repository layer entirely

**Fix:** Either require auth for the QR endpoint, or make it truly public but accept slugs instead of internal IDs (like the guest portal does). At minimum, the direct DB query should go through the repository layer.

### C-03. `resolveLinkAndTrack` bypasses the repository pattern — direct Drizzle imports in server fn

**File:** `src/contexts/guest/server/public.ts:196-210`
**Severity:** P1 — Architecture violation

```ts
const { db, useCases } = getContainer()
const { portalLinks, portals } = await import('#/shared/db/schema/portal.schema')
const { eq } = await import('drizzle-orm')
```

This server function directly imports Drizzle ORM and portal schema to perform a JOIN query. This violates the convention: "API routes delegate to server fns — no direct getContainer() or Drizzle imports." This is not an OAuth callback or webhook — it's a guest-facing API route that should go through the repository/use case layer.

**Fix:** Create a `resolveLinkForClick` use case in the guest context that uses a port/interface, and implement it in the infrastructure layer with proper repository access.

---

## Warnings (P2)

### W-01. `ProfileSettingsForm` calls `authClient.updateUser()` directly — violates convention #15

**File:** `src/components/features/identity/profile-settings-form.tsx:76`
**Severity:** P2

```ts
await authClient.updateUser({ image: result.avatarUrl })
```

Convention states: "No direct authClient calls in feature components — extract to server fn + Action prop." This component directly calls the auth client SDK, coupling the component to the client-side auth library.

**Fix:** Extract to a server function that updates the user image, pass as an Action prop.

### W-02. `OrganizationSettingsPage` directly imports server functions — violates convention #3

**File:** `src/components/features/organization/organization-settings-page.tsx:12-17`
**Severity:** P2

The component imports `updateOrganization`, `requestOrgLogoUpload`, `finalizeOrgLogoUpload`, `setActiveOrganization` directly from server files and calls `useServerFn` / `useAction` inside itself. While it has a documented exception comment ("5+ mutations"), the convention says these should be defined in the route file and passed as props. The exception is reasonable but should be tracked.

### W-03. `Promise.allSettled` used in component mutation batches

**Files:**

- `src/components/features/staff/assign-staff-form.tsx:52`
- `src/components/features/team/team-members/team-member-list.tsx:66`

**Severity:** P2

The convention explicitly states "Never Promise.allSettled in loaders" but using it in component-side batch mutations is a different case. The pattern here is intentional — batch staff assignment where partial success is acceptable. However, the error reporting is weak: `assign-staff-form.tsx` shows a toast with "N failed" but the actual error reasons are swallowed. This should at minimum log the rejection reasons.

### W-04. `star-rating.tsx` manages its own `isSubmitting` state instead of using Action state

**File:** `src/components/features/guest/public-portal/star-rating.tsx:21`
**Severity:** P2

```ts
const [isSubmitting, setIsSubmitting] = useState(false)
```

The component creates `submitAction` via `useAction(submitRating)` but then manually manages `isSubmitting` state around the call. The action already provides `isPending`. This is a double-bookkeeping bug waiting to happen — if the action fails, `isSubmitting` is correctly cleared in `finally`, but the pattern is still fighting the hook's design.

### W-05. Inline Zod schemas in components

**Files:**

- `src/components/features/portal/portal-form/edit-portal-form.tsx:17-20` — extends DTO schema inline
- `src/components/features/portal/portal-form/create-portal-form.tsx:14-20` — extends DTO schema inline
- `src/components/features/identity/profile-settings-form.tsx:23-28` — `profileSchema` defined inline
- `src/components/features/staff/assign-staff-form.tsx:16-19` — `formSchema` defined inline

**Severity:** P2

Convention #10 says "No inline Zod schemas in components — import from DTOs." While some of these extend DTO schemas (which is borderline acceptable), the `profileSchema` in `profile-settings-form.tsx` and `formSchema` in `assign-staff-form.tsx` are entirely new schemas that should live in their respective DTOs.

### W-06. `people.tsx` route is 342+ lines — exceeds 150-line convention

**File:** `src/routes/_authenticated/properties/$propertyId/people.tsx`
**Severity:** P2

The people route defines 5+ mutations inline (justified by exception) plus complex layout rendering. At 340+ lines, it needs extraction of sub-components into the `features/staff/` directory.

### W-07. `_authenticated/properties/$propertyId/portals/index.tsx` defines `CopyButton` inline

**File:** `src/routes/_authenticated/properties/$propertyId/portals/index.tsx:30-50`
**Severity:** P2

A `CopyButton` component is defined inside the route file. This should be extracted to `components/ui/` or `components/features/` since it's a reusable UI element.

---

## Minor (P3)

### M-01. `dangerouslySetInnerHTML` in `__root.tsx` — acceptable but documented

**File:** `src/routes/__root.tsx:44`
**Severity:** P3 — Acknowledged

```tsx
<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
```

The script is a hardcoded string constant (no user input). This is the standard pattern for flash-of-unstyled-content prevention. Safe as-is, but worth a `// SECURITY: safe — constant string, no user input` comment.

### M-02. No `notFound()` for portal property validation in loaders

**Files:** Various portal/team route loaders
**Severity:** P3

Several route loaders (e.g., `$portalId.tsx`) load data via server functions that return null on missing resources, but the route components handle null rendering rather than using TanStack's `notFound()` + `notFoundComponent` pattern. Convention #7 specifies using `notFound()`.

### M-03. `fallow-ignore-next-line` comments in use case files

**Files:** `create-portal.ts:17`, `update-portal.ts:22`, `create-team.ts:16`
**Severity:** P3

These appear to be Fallow linter suppression comments for unused type exports. The types are used (exported as part of the public API), so the suppression comments suggest either a linter misconfiguration or an outdated tool.

### M-04. `list` method in `portal.repository.ts` missing `trace()` wrapper

**File:** `src/contexts/portal/infrastructure/repositories/portal.repository.ts:51-57`
**Severity:** P3

```ts
list: async (orgId) => {
  const rows = await db
    .select()...
```

All other methods are wrapped in `trace()`, but `list` and `listByProperty` are not. Inconsistent observability.

### M-05. `portal-link.repository.ts` exceeds 150-line limit

**File:** `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts:184 lines`
**Severity:** P3

184 lines. Could be split into category and link sub-repositories since they serve distinct concerns.

### M-06. `as unknown as string` brand-type coercion scattered across repositories

**Files:** `portal.repository.ts:34`, `portal-link.repository.ts:26-43`, `staff-assignment.repository.ts:27-28`, `team.repository.ts`
**Severity:** P3

The pattern `eq(portals.id, id as unknown as string)` appears throughout. This is a known TypeScript branded-type pain point. A shared utility like `toDbId(id)` would clean this up and centralize the coercion.

### M-07. Guest `hasRated` check has TOCTOU race condition

**File:** `src/contexts/guest/application/use-cases/submit-rating.ts:30-37`
**Severity:** P3

The check-then-insert pattern (`hasRated` → `insertRating`) has a race window. Two concurrent requests from the same session could both pass the `hasRated` check before either inserts. The database should enforce uniqueness on `(organization_id, session_id, portal_id)` with a UNIQUE constraint.

### M-08. `getPortalForQR` uses `process.env.BETTER_AUTH_URL` instead of `getEnv()`

**File:** `src/contexts/portal/server/portals.ts:271`
**Severity:** P3

```ts
const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
```

The rest of the codebase uses `getEnv()` for configuration. Direct `process.env` access bypasses the validated env configuration layer.

### M-09. `ProfileSettingsForm` exports `Props` as `export type Props`

**File:** `src/components/features/identity/profile-settings-form.tsx:32`
**Severity:** P3

```ts
export type Props = Readonly<{...}>
```

Component props types shouldn't be exported unless needed by external consumers. In this case, the route file doesn't import `Props` — it constructs the props inline.

### M-10. `MemberTable` uses `interface` instead of `type`

**File:** `src/components/features/identity/member-directory/member-table.tsx:23`
**Severity:** P3

```ts
export interface MemberRow {
```

Convention specifies `type` aliases. This uses `interface`. Minor style inconsistency.

### M-11. `useDragDrop` and `useFileUpload` hooks have dependency arrays that may miss updates

**File:** `src/components/forms/image-upload-field/use-file-upload.ts:62`
**Severity:** P3

```ts
;[acceptedTypes, maxFileSize, onUpload, onImageUrlChange]
```

`validateFile` captures `acceptedTypes` and `maxFileSize` from the outer scope but is defined inside the hook, not memoized. If these change between renders, the stale closure could use old values. The `useCallback` dependency array is correct, but `validateFile` itself isn't memoized and is called inside the callback.

### M-12. `SmartRoutingConfig` props type name doesn't match convention

**File:** `src/components/features/portal/portal-settings/smart-routing-config.tsx:3`
**Severity:** P3

```ts
type SmartRoutingConfigProps = Readonly<{...}>
```

Convention says `type Props = Readonly<{ ... }>`. This uses `SmartRoutingConfigProps`.

---

## Security Findings

### S-01. Open redirect via link URLs — CONFIRMED

**Severity:** HIGH
**Details:** See C-01 above. The click-tracking endpoint (`/api/public/click/$linkId`) redirects to arbitrary URLs stored in the database with no validation. This is exploitable by any PropertyManager in the system.

### S-02. QR code API accessible without authentication — CONFIRMED

**Severity:** MEDIUM
**Details:** See C-02 above. While the data exposed is semi-public (portal URLs), the endpoint accepts internal IDs and leaks organization slugs. Should require auth or use public slugs.

### S-03. OAuth callback state validation — WELL IMPLEMENTED

**File:** `src/routes/api/auth/google/callback.ts`
**Verdict:** PASS

The OAuth callback has excellent security:

- HMAC-SHA256 state verification with `timingSafeEqual`
- 10-minute timestamp freshness check
- Proper error classification (session vs connection failure)
- All redirects go to a hardcoded base URL (`env.BETTER_AUTH_URL`) — no open redirect
- Cookie forwarding for session resolution

### S-04. Guest rate limiting — IMPLEMENTED

**File:** `src/contexts/guest/server/public.ts:87-94, 144-151`
**Verdict:** PASS

Both `submitRatingFn` and `submitFeedbackFn` implement rate limiting per session ID via `rateLimiter.check()`. The `hashIp` function properly salts and hashes client IPs with a daily-rotating salt. Honeypot field check on feedback form is a nice touch.

### S-05. Guest session ID generation — POTENTIAL CONCERN

**File:** `src/contexts/guest/server/public.ts:84-85`
**Severity:** LOW

```ts
const sessionId = cookieHeader.match(/guest_session=([^;]+)/)?.[1] ?? crypto.randomUUID()
```

If no `guest_session` cookie exists, a new UUID is generated server-side but **never set as a cookie in the response**. This means:

1. Every request from a new visitor gets a fresh session ID
2. The `hasRated` duplicate check is ineffective for first-time visitors making concurrent requests
3. The rate limiter is also per-session, so a new session ID bypasses the rate limit

The session cookie needs to be set on the response for the system to work correctly.

### S-06. Webhook JWT verification — PROPERLY IMPLEMENTED

**File:** `src/routes/api/webhooks/gbp/notifications.ts`
**Verdict:** PASS

Good implementation: Bearer token extraction, JWT verification via dedicated verifier, proper Pub/Sub message parsing, BullMQ job deduplication via `messageId`-based `jobId`.

---

## Positive Findings

### Well-executed patterns:

1. **Use case 7-step pattern** — Portal, Team, and Staff contexts consistently follow: authorize → validate refs → check uniqueness → build → persist → emit → return. Textbook implementation.

2. **`beforeLoad` error discrimination** — `_authenticated.tsx` properly handles `isRedirect`, `isNoActiveOrg`, and real errors with appropriate behavior for each case.

3. **Tenant isolation** — Every repository query uses `organizationId` filtering via `baseWhere()` or explicit `eq()` conditions. Insert operations validate `organizationId` match.

4. **Server function pattern** — Consistent thin server fn layer: `resolveTenantContext → try useCase → catch domain error → throwContextError`. Clean separation.

5. **`useMutationAction` adoption** — Routes consistently use `useMutationAction` with `invalidateRoutes` for targeted cache invalidation instead of blanket `router.invalidate()`.

6. **`FormErrorBanner` pattern** — Consistent error handling across all forms with proper `unknown` narrowing. No duplicate toasts.

7. **Upload flow** — Presigned URL → client upload → finalize pattern is well-implemented across org logos, portal hero images, and avatars.

8. **Domain constructors with Result** — `buildPortal`, `buildRating`, `buildTeam`, etc. all return `Result<T, E>` from neverthrow, forcing callers to handle errors.

9. **Component Props typing** — Nearly every component correctly uses `type Props = Readonly<{ ... }>`.

10. **Barrel exports** — Feature directories have `index.ts` barrel files for clean imports.

---

## Files Reviewed

### Portal Context

- `src/contexts/portal/domain/types.ts`
- `src/contexts/portal/domain/errors.ts`
- `src/contexts/portal/domain/constructors.ts`
- `src/contexts/portal/domain/events.ts`
- `src/contexts/portal/domain/rules.ts`
- `src/contexts/portal/build.ts`
- `src/contexts/portal/application/use-cases/create-portal.ts`
- `src/contexts/portal/application/use-cases/update-portal.ts`
- `src/contexts/portal/application/use-cases/get-portal.ts`
- `src/contexts/portal/application/use-cases/create-link.ts`
- `src/contexts/portal/server/portals.ts`
- `src/contexts/portal/server/portal-links.ts`
- `src/contexts/portal/infrastructure/repositories/portal.repository.ts`
- `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts`

### Guest Context

- `src/contexts/guest/domain/types.ts`
- `src/contexts/guest/domain/errors.ts`
- `src/contexts/guest/domain/constructors.ts`
- `src/contexts/guest/domain/rules.ts`
- `src/contexts/guest/build.ts`
- `src/contexts/guest/server/public.ts`
- `src/contexts/guest/application/use-cases/submit-rating.ts`
- `src/contexts/guest/application/use-cases/submit-feedback.ts`
- `src/contexts/guest/application/use-cases/track-review-link-click.ts`
- `src/contexts/guest/application/use-cases/resolve-portal-context.ts`
- `src/contexts/guest/application/use-cases/record-scan.ts`
- `src/contexts/guest/application/use-cases/get-public-portal.ts`
- `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts`
- `src/contexts/guest/infrastructure/resolvers/public-portal-lookup.ts`

### Team Context

- `src/contexts/team/domain/types.ts`
- `src/contexts/team/domain/errors.ts`
- `src/contexts/team/domain/constructors.ts`
- `src/contexts/team/domain/events.ts`
- `src/contexts/team/domain/rules.ts`
- `src/contexts/team/build.ts`
- `src/contexts/team/application/use-cases/create-team.ts`
- `src/contexts/team/server/teams.ts`
- `src/contexts/team/infrastructure/repositories/team.repository.ts`

### Staff Context

- `src/contexts/staff/domain/types.ts`
- `src/contexts/staff/domain/errors.ts`
- `src/contexts/staff/domain/constructors.ts`
- `src/contexts/staff/domain/events.ts`
- `src/contexts/staff/build.ts`
- `src/contexts/staff/application/public-api.ts`
- `src/contexts/staff/server/staff-assignments.ts`
- `src/contexts/staff/infrastructure/repositories/staff-assignment.repository.ts`

### Routes

- `src/routes/__root.tsx`
- `src/routes/index.tsx`
- `src/routes/_authenticated.tsx`
- `src/routes/_authenticated/properties/$propertyId/index.tsx`
- `src/routes/_authenticated/properties/$propertyId.tsx`
- `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`
- `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
- `src/routes/_authenticated/properties/$propertyId/portals/new.tsx`
- `src/routes/_authenticated/properties/$propertyId/reviews.tsx`
- `src/routes/_authenticated/properties/$propertyId/metrics.tsx`
- `src/routes/_authenticated/properties/$propertyId/people.tsx`
- `src/routes/_authenticated/properties/$propertyId/teams/$teamId.tsx`
- `src/routes/_authenticated/properties/$propertyId/teams/$teamId/index.tsx`
- `src/routes/_authenticated/properties/$propertyId/teams/$teamId/members.tsx`
- `src/routes/_authenticated/settings/profile.tsx`
- `src/routes/api/auth/google/callback.ts`
- `src/routes/api/webhooks/gbp/notifications.ts`
- `src/routes/api/portals/$id/qr.ts`
- `src/routes/api/public/click/$linkId.ts`
- `src/routes/p/$propertySlug/$portalSlug.tsx`

### Components

- `src/components/hooks/use-action.ts`
- `src/components/hooks/use-mutation-action.ts`
- `src/components/hooks/use-property-id.ts`
- `src/components/features/portal/link-tree/use-link-tree-mutations.ts`
- `src/components/features/portal/link-tree/use-link-tree-reorder.ts`
- `src/components/features/portal/link-tree/use-link-tree-state.ts`
- `src/components/features/portal/link-tree/link-tree.tsx`
- `src/components/features/portal/link-tree/link-tree-types.ts`
- `src/components/features/portal/portal-detail/portal-detail-page.tsx`
- `src/components/features/portal/portal-settings/portal-settings.tsx`
- `src/components/features/portal/portal-settings/smart-routing-config.tsx`
- `src/components/features/portal/portal-form/portal-creation-with-preview.tsx`
- `src/components/features/portal/portal-form/create-portal-form.tsx`
- `src/components/features/portal/portal-form/edit-portal-form.tsx`
- `src/components/features/guest/public-portal/public-portal-content.tsx`
- `src/components/features/guest/public-portal/feedback-form.tsx`
- `src/components/features/guest/public-portal/star-rating.tsx`
- `src/components/features/identity/member-directory/member-table.tsx`
- `src/components/features/identity/member-directory/role-select.tsx`
- `src/components/features/identity/profile-settings-form.tsx`
- `src/components/features/organization/organization-settings-page.tsx`
- `src/components/features/staff/assign-staff-form.tsx`
- `src/components/features/team/team-members/team-member-list.tsx`
- `src/components/features/integration/connect-google-button/connect-google-button.tsx`
- `src/components/features/integration/import-connected-view/use-gbp-locations.ts`
- `src/components/forms/form-error-banner.tsx`
- `src/components/forms/image-upload-field.tsx`
- `src/components/forms/image-upload-field/use-file-upload.ts`
