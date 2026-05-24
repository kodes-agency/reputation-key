# Round 3A — Final Comprehensive Audit

**Date:** 2026-05-24
**Scope:** Full codebase audit after Round 1 + Round 2 fixes
**Branch:** feat/phase-15c-goal-ui

---

## Audit Checks Performed

1. ✅ hasRole in use cases — CLEAN (only in domain rules, documented as intentional per ADR-0001)
2. ✅ throw new in use cases — CLEAN in test files only
3. ✅ All CONTEXT.md Permissions sections — verified
4. ✅ GoogleConnectionDto through public-api — CLEAN
5. ✅ JOB_NAME constants in bootstrap+worker — CLEAN
6. ✅ Cross-context import audit — 3 imports found
7. ✅ Components import audit — CLEAN (sibling imports within feature folders only)
8. ✅ All CONTEXT.md files ↔ code file existence — verified all contexts
9. ✅ as any — only in auto-generated routeTree.gen.ts
10. ✅ @ts-ignore/@ts-expect-error — NONE found
11. ✅ Non-null assertions in use cases — only in test files
12. ✅ console.log in non-test code — NONE found
13. ✅ TODO/FIXME — 5 found in shared code
14. ✅ .skip/.todo in tests — NONE found
15. ✅ Result pattern in use cases — verified (throw-based pattern per architecture)
16. ✅ Silent catch blocks — all intentional (analytics graceful degradation)
17. ✅ permissions.ts ↔ CONTEXT.md consistency — verified

---

## Findings

### [MAJOR] Use case imports from cross-context internal-ports (not public-api)

**File:** `src/contexts/integration/application/use-cases/handle-gbp-notification.ts:6`
**Detail:** Imports `ReviewQueuePort` from `#/contexts/review/application/internal-ports`
**Fix:** Define a local port in integration context (`application/ports/review-queue.port.ts`) and implement an adapter that wraps the review context's queue — or move the import to go through `public-api.ts` if `ReviewQueuePort` should be public.

The architecture exception in `contexts/CONTEXT.md` line 58 explicitly covers only "Cross-context **adapter implementations**" in `infrastructure/`, not use cases in `application/`. The `internal-ports.ts` file header also says "for internal/adapter use only." This use case bypasses the public-api boundary rule.

---

### [MAJOR] identity/CONTEXT.md missing Permissions section

**File:** `src/contexts/identity/CONTEXT.md`
**Fix:** Add a Permissions section documenting: `organization.update/delete`, `member.create/list/update/delete`, `invitation.create/list/cancel/resend`, `identity.avatar_upload/logo_upload/leave_org` with the AccountAdmin/PropertyManager/Staff permission matrix (matching the role definitions in `shared/auth/permissions.ts`).

The context enforces permissions at the use-case layer but does not document them in CONTEXT.md. The architecture says: "All new use cases must define a permission... and document it in the context's CONTEXT.md."

---

### [MAJOR] team/CONTEXT.md missing Permissions section

**File:** `src/contexts/team/CONTEXT.md`
**Fix:** Add a Permissions section documenting: `team.read`, `team.create`, `team.update`, `team.delete` with the AccountAdmin/PropertyManager/Staff permission matrix (matching the role definitions in `shared/auth/permissions.ts` where PropertyManager has `team: ['read', 'create', 'update']` but not `delete`).

The context has server functions and use cases that enforce `can()` checks, but CONTEXT.md does not document the permissions.

---

### [MINOR] Untested use case: get-public-portal.ts

**File:** `src/contexts/guest/application/use-cases/get-public-portal.ts`
**Fix:** Add `get-public-portal.test.ts` with unit tests covering: portal found, portal not found (throws `guestError`).

---

### [MINOR] Untested use case: resolve-portal-context.ts

**File:** `src/contexts/guest/application/use-cases/resolve-portal-context.ts`
**Fix:** Add `resolve-portal-context.test.ts` with unit tests covering: valid portal ID resolves org+property, invalid portal ID throws `guestError`.

---

### [MINOR] Untested use case: resolve-link-and-track.ts

**File:** `src/contexts/guest/application/use-cases/resolve-link-and-track.ts`
**Fix:** Add `resolve-link-and-track.test.ts` with unit tests covering: link found + click tracked, link not found, event emission.

---

### [MINOR] Untested use case: list-portal-links.ts

**File:** `src/contexts/portal/application/use-cases/list-portal-links.ts`
**Fix:** Add `list-portal-links.test.ts` with unit tests covering: returns categories with links, forbidden (no read permission), portal not found.

---

### [MINOR] TODO comments in shared production code

**File:** `src/shared/auth/auth.ts:19,54,66` — 3 TODOs about email verification
**File:** `src/shared/events/event-bus.ts:11` — 1 TODO about BullMQ event persistence
**Fix:** These are tracked reminders for future phases. Consider migrating to issue tracker or ADR backlog to keep production code clean.

---

### [MINOR] goal/ui/helpers.ts bypasses public-api for DTO imports

**File:** `src/contexts/goal/ui/helpers.ts:6`
**Detail:** Imports `Goal, GoalStatus` from `#/contexts/goal/application/dto/goal.dto` instead of `#/contexts/goal/application/public-api`
**Fix:** Change import to `#/contexts/goal/application/public-api` (which re-exports these types). The goal CONTEXT.md documents this as an intentional deviation, but public-api already exports these types so there's no reason to bypass it.

---

### [NIT] Orphan integration test file naming

**File:** `src/contexts/guest/application/use-cases/staff-attribution-flow.integration.test.ts`
**Detail:** No matching source file `staff-attribution-flow.ts`. The test exercises a multi-use-case flow (recordScanWithRef + getStaffIdForSession + submitRating) which is valid, but the colocated naming convention (`foo.ts` next to `foo.test.ts`) doesn't apply here.
**Fix:** Consider moving to `src/contexts/guest/application/__tests__/staff-attribution-flow.integration.test.ts` to signal it's a flow test, not a per-file unit test.

---

## Verified Clean (No Issues)

- **hasRole in use cases:** Zero occurrences. Only in `inbox/domain/rules.ts` and `identity/domain/rules.ts` — both documented as intentional per ADR-0001.
- **throw in use case source files:** Expected architecture pattern — application layer throws tagged errors on `Result.isErr()` per `contexts/CONTEXT.md` Error pattern table.
- **as any:** Only in `src/routeTree.gen.ts` (auto-generated by TanStack Router).
- **@ts-ignore/@ts-expect-error:** Zero occurrences.
- **console.log:** Zero occurrences in non-test production code.
- **.skip/.todo tests:** Zero occurrences.
- **Non-null assertions in use cases:** Only in test files.
- **GoogleConnectionDto:** All component imports go through `#/contexts/integration/application/public-api`. Server functions use `toGoogleConnectionDto` mapper correctly.
- **JOB_NAME constants:** All 8 job types registered in `bootstrap.ts` and scheduled in `worker/index.ts` using exported constants.
- **Components cross-boundary imports:** All `../` imports within `src/components/` are sibling imports within the same feature folder (portal/\*). No domain layer imports.
- **Silent catch blocks:** All intentional — guest analytics (scan, click tracking) and inbox counter graceful degradation have explicit comments explaining the silent-failure rationale.
- **CONTEXT.md ↔ code file existence:** All 12 contexts verified. Every use case, server function, event handler, job, and infrastructure file listed in CONTEXT.md exists on disk.
- **permissions.ts ↔ CONTEXT.md:** All permission strings in `shared/domain/permissions.ts` match the documented permissions in their respective CONTEXT.md files (for contexts that have Permissions sections).

---

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 0      |
| MAJOR     | 3      |
| MINOR     | 6      |
| NIT       | 1      |
| **Total** | **10** |
