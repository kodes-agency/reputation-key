# Fix Plan — Codebase Audit Issues

## Batch 1: Guest server error handling (H1 + L9 + L10)

- [ ] Add `guestErrorStatus()` with `ts-pattern .exhaustive()`
- [ ] Replace all `throw guestError(...)` → `throwContextError('GuestError', ...)`
- [ ] Replace `if (isGuestError(e)) throw e` → `throwContextError(...)`
- [ ] Wrap `getPublicPortal` handler in try/catch

## Batch 2: Duplicate integration types (H4)

- [ ] Remove `shared/domain/integration.ts` duplicate types
- [ ] Update `shared/domain/index.ts` barrel
- [ ] Update consumers to import from context domain

## Batch 3: eslint-disable + as any casts (H2)

- [ ] Fix `star-rating.tsx` — type `submitRating` as `Action<...>`
- [ ] Fix `feedback-form.tsx` — type `submitFeedback` as `Action<...>`

## Batch 4: Missing barrel exports (H3)

- [ ] Create `features/organization/index.ts`
- [ ] Create `features/staff/index.ts`
- [ ] Create `features/settings/index.ts`

## Batch 5: useServerFn → useMutationAction (M1 + M2)

- [ ] `accept-invitation.tsx` — use `useMutationAction(acceptInvitation, ...)`
- [ ] `_authenticated.tsx` — use `useMutationActionSilent(setActiveOrganization)`

## Batch 6: Missing staleTime (M3)

- [ ] Add `staleTime: 60_000` to organization settings route

## Batch 7: Extract shared types (M4 + M5 + M6 + M7)

- [ ] Create `features/team/shared/types.ts` — MemberOption, TeamOption, AssignmentInTeam
- [ ] Create `components/forms/form-with-field.ts` — FormWithField type
- [ ] Extract PendingInvitation to identity shared

## Batch 8: Readonly props + mutable arrays (M8 + M9)

- [ ] Fix image-upload-field props → ReadonlyArray<string>
- [ ] Fix public-portal-content props → readonly arrays
- [ ] Fix invitation props → readonly arrays
- [ ] Fix header props → Readonly<{...}>

## Batch 9: Unsafe casts + stale closure (M10 + M11)

- [ ] Type forms properly in member-directory
- [ ] Fix accept-invitation-page useEffect deps

## Batch 10: Inline schemas → DTOs (M12)

- [ ] Create org settings DTO, derive form schema
- [ ] Create password change DTO or server fn wrapper

## Batch 11: LOW items

- [ ] L2: Extract roleLabel
- [ ] L3: Verify double-toast risk in manual toast locations
- [ ] L5: Raw SQL → Drizzle in portal-lookup
- [ ] L6: Fix mapper cast
- [ ] L7/L8: Document baseWhere exceptions

## Verify

- [ ] tsc --noEmit
- [ ] Final scan
