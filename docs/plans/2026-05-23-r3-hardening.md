# R3 Hardening Plan — 118 → 0

> **For Hermes:** Use subagent-driven-development skill. Execute streams in dependency order.

## Summary

R3 found 0 BLOCKERs, 41 MAJORs, 47 MINORs, 30 NITs. Many are repeated across reviews (PII logged 3x, component→server imports in R7+R8). Deduped: ~60 unique fixes.

---

## Stream F: Auth & Permissions (14 MAJOR, 8 MINOR)

_Foundation — unblocks other streams_

### F1: Goal use-case can() checks

- Add `role` param + `can(role, 'goal.create'|'goal.update'|'goal.cancel'|'goal.read')` to all 5 goal use cases
- Add permissions to `src/shared/auth/permissions.ts` + `src/shared/domain/permissions.ts`
- Files: create-goal.ts, update-goal.ts, cancel-goal.ts, get-goal.ts, list-goals.ts

### F2: Inbox hasRole() → can()

- Replace all `hasRole()` with `can(role, 'inbox.xxx')` in 9 inbox use cases
- Add `inbox.read`, `inbox.write`, `inbox.manage` permissions
- Files: add-inbox-note.ts, assign-inbox-item.ts, bulk-update-inbox-status.ts, create-inbox-item.ts, get-inbox-item-detail.ts, get-inbox-items.ts, get-inbox-notes.ts, get-unread-count.ts, update-inbox-status.ts

### F3: Missing read permissions

- Add `property.read`, `portal.read`, `team.read`, `staff_assignment.read`, `inbox.read` to permission statement
- Fix `getPortal` using `portal.update` for read → use `portal.read`
- Files: src/shared/auth/permissions.ts, src/shared/domain/permissions.ts

### F4: Missing can() checks in misc use cases

- refresh-google-token.ts → can(role, 'integration.manage')
- listPortals, listPortalLinks, listProperties, getProperty, listStaffAssignments → add can() or document as intentional

### F5: Auth-settings session validation

- Add session check to auth-settings.ts server functions (changePassword, updateProfile)
- File: src/contexts/identity/server/auth-settings.ts

---

## Stream G: PII & Security (4 MAJOR, 5 MINOR)

_Security-critical — do early_

### G1: PII in logs

- Mask email in signInUser failure log (src/contexts/identity/server/organizations.ts:513)
- Mask PII in all sign-in/auth failure paths
- Files: organizations.ts, traced-server-fn.ts

### G2: Empty catch block

- Fix `catch (e) {}` in composition.ts `setActiveOrg` — add logger.error
- File: src/composition.ts

### G3: Guest tenant scoping

- Verify `resolveLinkAndTrack` can't leak cross-tenant data via link enumeration
- File: src/contexts/guest/application/use-cases/resolve-link-and-track.ts

### G4: resolveReferralCode auth

- Add orgId validation to resolveReferralCode (already takes orgId, needs can() or public-only doc)
- File: src/contexts/staff/application/use-cases/resolve-referral-code.ts

---

## Stream H: Architecture Purity (6 MAJOR, 8 MINOR)

_Layer violations_

### H1: Component→server imports (10+ components)

- Components import from `contexts/*/server/` directly — pass server actions as props from route files
- Files: inbox-bulk-actions.tsx, inbox-notes-thread.tsx, inbox-filters.tsx, inbox-unread-badge.tsx, portal-delete-button.tsx, delete-property-dialog.tsx, people-page.tsx, use-gbp-locations.ts, use-import-job-polling.ts, + others
- **Approach:** For each component, move the server call into the route/loader and pass data/actions as props

### H2: identity infrastructure imports server framework

- Move `getRequest()` out of auth-identity.adapter.ts — pass request via port param
- File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts

### H3: getLogger() → LoggerPort in guest use cases

- Replace `getLogger()` with injected LoggerPort in record-scan.ts, track-review-link-click.ts
- Files: src/contexts/guest/application/use-cases/record-scan.ts, track-review-link-click.ts

### H4: Goal/Dashboard build.ts expose publicApi

- Goal build.ts: add `publicApi` to return object
- Dashboard: expose publicApi or document why not needed
- Files: src/contexts/goal/build.ts, src/contexts/dashboard/build.ts

### H5: console.warn in production

- Replace `console.warn` in color-picker.tsx with logger
- File: src/components/ui/color-picker.tsx

---

## Stream I: Error Handling & Exhaustiveness (3 MAJOR, 6 MINOR)

### I1: Goal server switch → match().exhaustive()

- Replace `switch` with `match(result).exhaustive()` in goal server functions
- Files: src/contexts/goal/server/goals.ts

### I2: staff-goals.ts missing catch

- Add error handling to staff-goals.ts server function
- File: src/contexts/staff/server/staff-goals.ts (or wherever it lives)

### I3: auth-settings.ts generic error catch

- Distinguish error types in auth-settings catch block
- File: src/contexts/identity/server/auth-settings.ts

### I4: Unsafe `as` casts in routes

- Fix `as` casts on route params, contexts, search params in: inbox, settings/organization, portals/new, join, login, accept-invitation, import, click API, OAuth callback
- Replace with proper Zod validation or type-safe parsing

---

## Stream J: Observability (2 MAJOR, 3 MINOR)

### J1: Missing trace spans (7 adapters)

- Add trace() to: feedback-lookup.adapter.ts, property-lookup.adapter.ts, review-lookup.adapter.ts, redis-unread-counter.ts, property-event.adapter.ts, token-encryption.adapter.ts, auth-identity.adapter.ts
- Files: src/contexts/inbox/infrastructure/adapters/_.ts, src/contexts/integration/infrastructure/adapters/_.ts

### J2: Dashboard/goal event handler logging

- Add structured logging to dashboard context and on-metric-recorded handler
- Files: src/contexts/dashboard/\*, src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts

---

## Stream K: Tests (3 MAJOR, 2 MINOR)

### K1: Missing test files (4 use cases)

- Create tests for: list-portal-links, record-scan, track-review-link-click, get-dashboard-data
- Use in-memory fakes, not mocks

### K2: vi.fn() → in-memory fakes

- Refactor reply-operations.test.ts and on-reply-published.test.ts to use in-memory fakes
- Files: src/contexts/reply/application/use-cases/reply-operations.test.ts, src/contexts/inbox/infrastructure/event-handlers/on-reply-published.test.ts

---

## Stream L: Documentation & Housekeeping (1 MAJOR, 10 MINOR, 29 NIT)

### L1: CONTEXT.md for 5 missing contexts

- Create CONTEXT.md for: team, portal, property, metric, dashboard
- Follow pattern from goal/metric CONTEXT.md

### L2: goal/ui/helpers import fix

- Change import from `application/dto/goal.dto` → `application/public-api`
- File: src/contexts/goal/ui/helpers.ts

### L3: Goal public-api exports

- Export GoalInstance type from goal public-api
- File: src/contexts/goal/application/public-api.ts

### L4: Context rules doc update

- Add goal/ui/ layer to src/contexts/CONTEXT.md dependency rules
- Document mixed error pattern (Result vs throw) as intentional

### L5-NITs: Bulk NIT fixes

- ~50 `as unknown as` in test files → use branded constructors
- referral-code.test.ts crypto import → test helper
- better-auth-schemas.ts doc exception
- RoleBadge string comparison → use can()
- OAuth callback route file too long → extract to helper
- getSessionFromHeaders `as AuthUser` → proper validation

---

## Execution Order

1. **F** (Auth) — foundation, unblocks goal/inbox
2. **G** (PII/Security) — security critical
3. **H** (Architecture) — layer purity
4. **I** (Error Handling) — exhaustiveness
5. **J** (Observability) — tracing
6. **K** (Tests) — verification
7. **L** (Docs/NITs) — cleanup

Each stream: delegate to subagent, verify tsc+tests, commit.
