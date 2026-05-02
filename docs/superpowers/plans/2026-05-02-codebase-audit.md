# Codebase Audit Report — patterns.md & conventions.md

> **Date:** 2026-05-02
> **Audited against:** `docs/patterns.md` (31 canonical patterns), `docs/conventions.md` (architectural rules)
> **Scope:** Production code in `src/`, grouped by bounded context

---

## Executive Summary

| Severity | Count | Key Themes                                                                                                                      |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | 2     | Guest server functions bypass use cases entirely; cross-context imports via public-api (intentional but undocumented exception) |
| HIGH     | 12    | Form schemas duplicate DTO rules; components import from server/; plain Error throws in infrastructure                          |
| MEDIUM   | 10    | Large files; console statements; missing type annotations; orphaned test                                                        |
| LOW      | 8     | Unused components; debug code; minor naming inconsistencies                                                                     |

**Verdict: WARNING** — No hard blockers, but 12 HIGH issues should be addressed in the next iteration.

---

## CRITICAL Findings

### 1. Guest server functions contain full business logic

```
[HIGH→CRITICAL] src/contexts/guest/server/public.ts
```

`getPublicPortal`, `submitRatingFn`, and `submitFeedbackFn` contain:

- Direct Drizzle queries (no repository)
- Rate limiting logic
- IP hashing
- Honeypot checks
- Portal lookup with business rules

**Rule:** Server functions validate input, call use case, translate errors. No business logic. No direct DB access.
**Fix:** Extract use cases (`getPublicPortal`, `submitRating`, `submitFeedback`) with proper ports. Move rate limiting to a port/adapter. Move IP hashing to a utility.

### 2. Cross-context imports via public-api (intentional, needs docs)

```
[CRITICAL→ACCEPTED] src/contexts/team/application/use-cases/*.ts → #/contexts/property/application/public-api
[CRITICAL→ACCEPTED] src/contexts/property/application/use-cases/*.ts → #/contexts/staff/application/public-api
[CRITICAL→ACCEPTED] src/contexts/portal/application/use-cases/create-portal.ts → #/contexts/property/application/public-api
```

These use `public-api.ts` files — an explicit cross-context communication pattern. **This IS the intended design** (the public-api acts as a bounded-context facade). However, `conventions.md` does not document this exception.

**Rule:** Dependency rules say "Forbidden: contexts/A/<non-server-non-dto> from contexts/B/\*" but public-api.ts IS the DTO-like facade.
**Fix:** Update conventions.md to explicitly allow `public-api.ts` imports between contexts.

---

## HIGH Findings

### 3. Form schemas duplicate DTO validation rules (5 instances)

Pattern #30 requires deriving form schemas from DTO schemas. None of the feature forms do this.

| File                                                                      | Issue                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/components/features/portal/CreatePortalForm.tsx:18-23`               | Inline `z.object()` instead of `createPortalInputSchema.required().extend(...)` |
| `src/components/features/portal/EditPortalForm.tsx:29-33`                 | Inline `z.object()` instead of `updatePortalInputSchema.required()`             |
| `src/components/features/team/EditTeamForm.tsx:19-27`                     | Inline `z.object()` instead of `updateTeamInputSchema.required()`               |
| `src/components/features/staff/AssignStaffForm.tsx:34-38`                 | Inline `z.object()` instead of `createStaffAssignmentInputSchema.extend(...)`   |
| `src/components/features/identity/ResetPasswordForm.tsx:18`               | Inline `z.object()` instead of deriving from identity DTO                       |
| `src/components/features/organization/OrganizationSettingsForm.tsx:17-27` | Inline `z.object()` instead of deriving from identity DTO                       |

**Positive example:** `CreatePropertyForm.tsx` correctly uses `createPropertyInputSchema.required().extend(...)`.

**Rule:** Pattern #30 — "Form schemas are derived from DTO schemas. Never re-declare a validation rule that already exists in the DTO."
**Fix:** Replace each inline schema with a derived schema from the corresponding DTO.

### 4. Components import from server/ (6 instances)

| File                                                        | Imports from                    |
| ----------------------------------------------------------- | ------------------------------- |
| `src/components/features/identity/AcceptInvitationPage.tsx` | `identity/server/organizations` |
| `src/components/features/portal/EditPortalForm.tsx`         | `portal/server/portals`         |
| `src/components/features/property/PropertyDetailFields.tsx` | `property/server/properties`    |
| `src/components/guest/feedback-form.tsx`                    | `guest/server/public`           |
| `src/components/guest/star-rating.tsx`                      | `guest/server/public`           |
| `src/components/layout/AppSidebar.tsx`                      | `identity/server/organizations` |

**Rule:** Components may only import DTOs from application layer. Server functions must be wrapped in `useServerFn` in the route file and passed as props.
**Fix:** Move `useServerFn` calls to route files, pass server function references as props to components.

### 5. Plain Error throws in infrastructure and shared

| File                                                                        | Lines          |
| --------------------------------------------------------------------------- | -------------- |
| `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts` | 70, 104        |
| `src/contexts/portal/infrastructure/mappers/portal.mapper.ts`               | 15, 23         |
| `src/contexts/portal/infrastructure/adapters/r2-storage.adapter.ts`         | 27, 30, 33, 37 |
| `src/shared/domain/permissions.ts`                                          | 64             |
| `src/shared/auth/permissions.ts`                                            | 109            |
| `src/shared/config/env.ts`                                                  | 56             |

**Rule:** "Throwing plain Error → always tagged errors."
**Fix:** Replace `throw new Error(...)` with tagged error constructors (e.g., `portalError('tenant_mismatch', ...)`).

---

## MEDIUM Findings

### 6. Large files exceeding size thresholds

| File                                                                     | Lines | Threshold             |
| ------------------------------------------------------------------------ | ----- | --------------------- |
| `src/components/ui/color-picker.tsx`                                     | 1623  | 300 (components)      |
| `src/components/ui/sidebar.tsx`                                          | 724   | 300 (components)      |
| `src/components/features/portal/PortalDetailPage.tsx`                    | 501   | 300 (components)      |
| `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts` | 252   | 200 (domain-adjacent) |

**Fix:** Extract sub-components, hooks, and utilities from oversized files.

### 7. Console statements in production code

| File                                                | Lines        |
| --------------------------------------------------- | ------------ |
| `src/routes/_authenticated.tsx`                     | 80, 101, 104 |
| `src/components/features/portal/EditPortalForm.tsx` | 159          |
| `src/components/ui/color-picker.tsx`                | 1079         |

**Fix:** Remove or replace with shared logger.

### 8. Identity context missing domain types

`src/contexts/identity/domain/` lacks `types.ts` and `constructors.ts` that all other contexts have. Identity is a wrapper context around better-auth, so this may be intentional, but should be documented.

### 9. Empty catch blocks in composition.ts

`src/composition.ts:92` and `src/composition.ts:185` have catch blocks that silently swallow errors.

**Fix:** Add explicit logging/tracking, or rethrow with context.

### 10. Orphaned test file

`src/smoke.test.ts` — test file with no corresponding source module.

### 11. `any` type usage in hooks

`src/components/hooks/use-action.ts` and `use-mutation-action.ts` use `any` in generic type parameters.

**Fix:** Narrow to `unknown` or add generic constraints.

### 12. Server function naming inconsistency

Guest context names its server file `public.ts` while other contexts use entity names (`portals.ts`, `teams.ts`).

---

## LOW Findings

### 13. Unused components

| File                                        | Status                               |
| ------------------------------------------- | ------------------------------------ |
| `src/components/ui/breadcrumb.tsx`          | Never imported                       |
| `src/components/ui/avatar.tsx`              | Never imported                       |
| `src/components/layout/PageShell.tsx`       | Never imported                       |
| `src/components/features/team/TeamCard.tsx` | Never imported                       |
| `src/components/guest/portal-not-found.tsx` | Never imported                       |
| `src/components/debug/debug-auth.ts`        | Debug code, remove before production |

### 14. React imports in non-component files

| File                      | Issue                                                |
| ------------------------- | ---------------------------------------------------- |
| `src/lib/compose-refs.ts` | React ref utility — should move to `components/`     |
| `src/router.tsx`          | TanStack Router setup — standard pattern, acceptable |

### 15. TODO comments without tickets

`src/shared/auth/auth.ts:19,54,66` and `src/shared/events/event-bus.ts:11` have TODOs without issue references.

---

## False Positives (Agent 1 — acknowledged and dismissed)

| Finding                                                              | Why Dismissed                                                                                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drizzle-orm` in `shared/db/schema/*.ts`                             | Schema definitions are Drizzle's equivalent of type declarations. Moving them to each context's infrastructure/ would break the shared schema pattern. This is an intentional architectural choice. |
| `drizzle-orm` in `shared/db/index.ts`, `base-where.ts`, `columns.ts` | Shared DB infrastructure (connection, query helpers). Same reasoning as schemas.                                                                                                                    |
| Cross-context public-api imports                                     | Intentional bounded-context facade pattern (see CRITICAL #2).                                                                                                                                       |

---

## Positive Findings (no violations)

- All domain types use `Readonly<>` and branded IDs correctly
- All repositories use `baseWhere(orgId)` for tenant isolation
- No `enum` usage — all use string literal unions
- All use cases follow appropriate patterns (full/thin/direct)
- All mappers are pure functions
- All port interfaces are properly implemented
- No dead code in domain/application layers
- `CreatePropertyForm` correctly derives from DTO (good reference example)

---

## Recommended Remediation Priority

| Priority | Finding                                                | Effort |
| -------- | ------------------------------------------------------ | ------ |
| P0       | Guest server functions → extract use cases             | Large  |
| P1       | Form schemas → derive from DTOs (5 files)              | Medium |
| P2       | Components importing server/ → pass as props (6 files) | Medium |
| P2       | Plain Error → tagged errors (infrastructure)           | Small  |
| P3       | Update conventions.md with public-api exception        | Small  |
| P3       | Remove console statements                              | Small  |
| P4       | Split oversized files                                  | Medium |
| P4       | Clean unused components                                | Small  |
