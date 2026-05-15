# Codebase Audit Report — Full Scan (excl. Portal + GBP)

**Date:** 2025-05-15
**Scope:** All routes, components, contexts, and shared infrastructure
**Excluded:** `src/components/features/portal/`, `src/components/features/integration/`,
`src/routes/_authenticated/properties/import/`, `src/routes/p/`

---

## HIGH — Action Required (7 issues)

### H1. Guest server throws raw errors instead of `ServerFunctionError`

**File:** `src/contexts/guest/server/public.ts` (lines 60, 82, 112, 135)
**Problem:** `throw guestError(...)` and `if (isGuestError(e)) throw e` bypass the
`throwContextError()` pattern used by every other context. Raw tagged objects won't
serialize correctly via seroval to the client.
**Fix:** Replace all `throw guestError(...)` with `throwContextError('GuestError', ...)`.
Add `guestErrorStatus()` function with `ts-pattern .exhaustive()` mapping.
**Impact:** Guest-facing errors (rate limits, inactive portals) may surface as generic 500s
instead of proper HTTP status codes.

### H2. `eslint-disable` + `as any` casts in guest components

**Files:**

- `src/components/features/guest/public-portal/star-rating.tsx` (lines 21-22)
- `src/components/features/guest/public-portal/feedback-form.tsx` (lines 27-28)
  **Problem:** `eslint-disable-next-line @typescript-eslint/no-explicit-any` +
  `useAction(submitRating as any)` — unsafe casts masking type mismatches.
  **Fix:** Type the `submitRating`/`submitFeedback` props correctly as `Action<Variables>`.

### H3. Missing barrel exports in 3 feature directories

**Directories:**

- `src/components/features/organization/` (6 components, no index.ts)
- `src/components/features/staff/` (5 components, no index.ts)
- `src/components/features/settings/` (no index.ts)
  **Fix:** Create `index.ts` barrel exports for each.

### H4. Duplicate domain types in `shared/domain/integration.ts`

**File:** `src/shared/domain/integration.ts` (lines 1-62) + `src/shared/domain/index.ts` (lines 53-61)
**Problem:** `GoogleConnection`, `GbpLocation`, `GbpImportJob`, `GbpCacheEntry` etc. defined
here AND in `src/contexts/integration/domain/types.ts`. Shared versions use `organizationId: string`
instead of branded `OrganizationId`, losing type safety.
**Fix:** Remove duplicate types from `shared/domain/integration.ts`. Update consumers to
import from context's domain. If UI needs simplified types, map at the server boundary.

---

## MEDIUM — Should Fix (12 issues)

### M1. `accept-invitation.tsx` uses raw `useServerFn` instead of `useMutationAction`

**File:** `src/routes/_authenticated/accept-invitation.tsx` (line 38)
**Fix:** Use `useMutationAction(acceptInvitation, { successMessage: 'Invitation accepted' })`.

### M2. `_authenticated.tsx` uses raw `useServerFn(setActiveOrganization)`

**File:** `src/routes/_authenticated.tsx` (line 141)
**Fix:** Use `useMutationActionSilent(setActiveOrganization)` for consistency.

### M3. Missing `staleTime` in organization settings route

**File:** `src/routes/_authenticated/settings/organization.tsx` (line 10)
**Fix:** Add `staleTime: 60_000` (org settings rarely change).

### M4. Duplicate `MemberOption` type defined 5 times

**Files:** `create-team-form.tsx`, `edit-team-form.tsx`, `team-lead-select.tsx`,
`member-selector.tsx`, `assign-staff-form.tsx`
**Fix:** Extract to `features/team/shared/types.ts` or `lib/lookups.ts`.

### M5. Duplicate `AssignmentInTeam` type defined 3 times

**Files:** `team-member-list.tsx`, `member-table.tsx`, `member-table-row.tsx`
**Fix:** Extract alongside `MemberOption`.

### M6. Duplicate `FormWithField` generic type defined 3 times

**Files:** `register-form-fields.tsx`, `org-identity-card.tsx`, `org-billing-card.tsx`
**Fix:** Extract to `components/forms/` as shared utility.

### M7. Duplicate `PendingInvitation` type in 2 files

**Files:** `invitation-list-view.tsx`, `accept-invitation-page.tsx`
**Fix:** Extract to shared identity types.

### M8. Mutable array props (not `readonly`)

**Files:**

- `forms/image-upload-field.tsx`, `drop-zone.tsx`, `empty-state.tsx` — `acceptedTypes: string[]`
- `guest/public-portal/public-portal-content.tsx` — `categories: PortalCategory[]`
- `registration/invitation-list-view.tsx`, `accept-invitation-page.tsx` — `invitations: PendingInvitation[]`
  **Fix:** Change to `ReadonlyArray<T>` or `readonly T[]`.

### M9. Props without `Readonly<{...}>` wrapper

**Files:** `layout/header.tsx` (lines 26-32, 69), `visually-hidden-input.tsx` (lines 7-15)
**Fix:** Wrap with `Readonly<{...}>`.

### M10. `as string[]` unsafe casts in member-directory

**Files:** `property-assignment-selector.tsx` (line 35), `invite-member-form.tsx` (lines 60, 68),
`assign-staff-form.tsx` (line 56)
**Fix:** Type the form properly so `getFieldValue` returns correct types.

### M11. `useEffect` with stale closure in `accept-invitation-page.tsx`

**File:** `src/components/features/identity/registration/accept-invitation-page.tsx` (lines 94-98)
**Problem:** `useEffect` calls `handleAccept` which depends on `accept` and `accepted`,
but only `[invitationId]` in deps. Stale closure risk.
**Fix:** Include all dependencies or use `useCallback`.

### M12. Inline Zod schemas instead of DTOs

**Files:**

- `organization-settings-form.tsx` (lines 21-30) — `orgSettingsSchema` defined locally
- `security-settings-form.tsx` (lines 20-29) — `passwordSchema` defined locally
  **Fix:** Derive from `contexts/identity/application/dto/`.

---

## LOW — Nice to Fix (10 issues)

### L1. Missing targeted `invalidateRoutes` on destructive mutations

**Files:** `people.tsx` (lines 88, 97), `members.tsx` (line 23), `teams/$teamId/index.tsx` (line 18)
**Note:** Full `router.invalidate()` works but is less efficient than targeted invalidation.

### L2. `roleLabel` function duplicated with different labels

**Files:** `identity/shared/role-badge.tsx` vs `identity/member-directory/role-selector.tsx`
**Fix:** Extract `roleLabel(role, style: 'short' | 'full')`.

### L3. Manual toast calls bypassing `useMutationAction`

**Files:** `organization-settings-page.tsx` (line 60), `security-settings-form.tsx` (line 52),
`profile-settings-form.tsx` (lines 64, 85), `assign-staff-form.tsx` (lines 80-87)
**Note:** Verify whether mutations already toast to avoid double-toasts.

### L4. `fallow-ignore` comments on exported types

**Files:** `use-mutation-action.ts` (line 26), `assign-staff-form.tsx` (lines 15, 22),
`member-table.tsx` (line 23), `invitation-table.tsx` (line 33)

### L5. Raw SQL in `public-portal-lookup.ts`

**File:** `src/contexts/guest/infrastructure/resolvers/public-portal-lookup.ts` (lines 42-44)
**Fix:** Use Drizzle query builder.

### L6. `guest.mapper.ts` uses `as unknown as string` instead of `as string`

**File:** `src/contexts/guest/infrastructure/mappers/guest.mapper.ts` (line 4)
**Fix:** Branded IDs are strings at runtime — `as string` is sufficient.

### L7. `guest-interaction.repository.ts` missing `baseWhere` for tenant isolation

**File:** `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts` (lines 29-43)

### L8. `google-connection.repository.ts` doesn't use `baseWhere`

**File:** `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts`

### L9. Missing `guestErrorStatus()` function with `ts-pattern .exhaustive()`

**File:** `src/contexts/guest/server/public.ts`
**Note:** All other contexts have this pattern.

### L10. `getPublicPortal` handler missing try/catch for `GuestError`

**File:** `src/contexts/guest/server/public.ts` (lines 32-38)

---

## What's Clean (zero issues)

- ✅ **Domain layer** — all types `Readonly<{...}>`, data-only, pure rules, correct imports
- ✅ **Application layer** — use cases use ports, DTOs have Zod, no upward imports
- ✅ **Server layer** — `tracedHandler` pattern consistent, `ts-pattern .exhaustive()` everywhere
- ✅ **Infrastructure** — mappers handle all fields, repositories follow Drizzle conventions
- ✅ **No `useQuery`/`useMutation`** from `@tanstack/react-query` anywhere
- ✅ **No `@ts-ignore`** in route files
- ✅ **No error swallowing** in loaders
- ✅ **No domain type stripping** via `.map()` in loaders
- ✅ **`getRouteApi`** usage is convention-compliant
- ✅ **Auth/tenant middleware** properly implemented with `ts-pattern`

---

## Priority Order

1. **H1** — Guest server error serialization (breaks client-side error handling)
2. **H2** — `as any` casts (type safety risk)
3. **H4** — Duplicate integration types (type conflicts)
4. **M1-M2** — `useServerFn` → `useMutationAction` (consistency)
5. **M4-M7** — Extract shared types (maintenance burden)
6. **H3** — Missing barrel exports (convention)
7. **M8-M11** — Type safety improvements
8. Everything else (LOW)
