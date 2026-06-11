# ADR Compliance Review

**Date:** 2026-06-10
**Scope:** docs/adr/0001–0013 vs. codebase reality

## Summary

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 1     |
| MAJOR     | 3     |
| MINOR     | 2     |
| NIT       | 1     |
| **Total** | **7** |

---

## Findings

### ADR 0005 — GBP Review API Path and Error Model Fix

````
[BLOCKER] integrationError is a plain object, NOT Error & IntegrationError hybrid
  File: src/contexts/integration/domain/errors.ts:28-39
  Quote: ```
  export const integrationError = (
    code: IntegrationErrorCode,
    message: string,
    recoverable = false,
    context?: Readonly<Record<string, unknown>>,
  ): IntegrationError => ({
    _tag: 'IntegrationError',
    code,
    message,
    recoverable,
    ...(context ? { context } : {}),
  })
````

Rule: ADR 0005 Error Model: "integrationError() returns Error & IntegrationError via Object.defineProperties. Adds recoverable: boolean."
Fix: Either update errors.ts to return Error & IntegrationError via Object.defineProperties (as ADR states), or update ADR to reflect that integrationError remains a plain tagged union and the Error wrapping happens at the server boundary via throwContextError → ServerFunctionError. The current throwContextError(ServerFunctionError) approach is actually clean — the ADR description of the fix is stale.

```

### CONTEXT.md — ADR Table Incomplete

```

[MAJOR] CONTEXT.md "Key ADRs" table omits ADRs 0008–0013
File: CONTEXT.md:115-123
Quote: ```
|| 0007 | Dashboard as a Read-Only Aggregation | Dashboard, Read Models |

```
Rule:  CONTEXT.md should reference all ADRs. ADRs 0008–0013 define cross-context boundaries, permission model, BullMQ delivery, and portal groups — all architecturally significant.
Fix:   Add rows for ADRs 0008 through 0013 to the "Key ADRs" table in CONTEXT.md.
```

### ADR 0005 — Status "Accepted" but Implementation Confirmed

````
[MAJOR] ADR 0005 status is "Accepted" but both decisions are fully implemented
  File: docs/adr/0005-gbp-review-api-fix.md:3
  Quote: ```
  **Status:** Accepted
````

Rule: ADR convention: status should reflect reality. Other implemented ADRs (0001–0004, 0006–0007) use "Implemented".
Fix: Update ADR 0005 status from "Accepted" to "Implemented". The path enrichment in listGbpLocations (accounts/{accountId}/ prefix) and the recoverable flag on IntegrationError are both in the codebase. (Note: the Error prototype claim in this ADR is the BLOCKER above.)

```

### ADR 0009 — hasRole() Used Beyond Hierarchy-Only Scope

```

[MAJOR] hasRole() used for access control, not just hierarchy, in inbox domain rules
File: src/contexts/inbox/domain/rules.ts:43
Quote: ```
export const canAssign = (role: Role): boolean => {
return hasRole(role, 'PropertyManager')
}

```
Rule:  ADR 0009 §6: "Every server function calls can(ctx.role, '<resource>.<action>') before invoking the use case." CONTEXT.md: "Never use hasRole() for permission checks — only for hierarchy."
Fix:   Replace `hasRole(role, 'PropertyManager')` with `can(role, 'inbox.manage')` (or define a specific assignment permission). The intent is "PM+ can assign," which is a permission check, not a hierarchy check. This also applies to staff/build.ts:63 where `hasRole(role, 'AccountAdmin')` gates property access — arguably hierarchy but reads like a permission bypass.
```

### ADR 0002 — "Later additions" Routes Partially Implemented

````
[MINOR] ADR 0002 route table for "Later additions" (/goals, /leaderboard, /insights) shows /goals and /leaderboard implemented but /insights absent
  File: docs/adr/0002-section-based-navigation.md:84-88
  Quote: ```
  /goals                        — property goals, team goals, individual goals
  /leaderboard                  — rankings by scope and time window
  /insights                     — AI sentiment trends, themes, suggested actions
````

Rule: ADR 0002 lists these as future additions. /goals and /leaderboard routes exist under `_authenticated/properties/$propertyId/goals/` and `_authenticated/leaderboard.tsx`. /insights does not exist.
Fix: No code change needed — this is a future-phase item. Consider annotating the ADR with implementation status (e.g., "Goals: Phase 15, Leaderboard: Phase 15, Insights: deferred to Arc 7").

```

### ADR 0004 — Event tag naming mismatch with ADR description

```

[MINOR] ADR 0004 states events are "inbox.item.created" etc. but actual tags use "inbox.inbox_item.created" (underscore variant)
File: src/contexts/inbox/domain/events.ts:17
Quote: ```
\_tag: 'inbox.inbox_item.created'

```
Rule:  ADR 0004 Decision #7: "Inbox emits events: inbox.item.created, inbox.status.changed, inbox.item.assigned"
Fix:   Update ADR 0004 Decision #7 to reflect actual event tag names (inbox.inbox_item.created, inbox.inbox_item.status_changed, inbox.inbox_item.assigned). Alternatively rename event tags to match ADR, but the underscore variant is already used in handlers and subscriptions.
```

### ADR 0013 — Date appears to have wrong year

````
[NIT] ADR 0012 date "2025-06-09" is likely a typo for 2026-06-09
  File: docs/adr/0012-nitro-dev-mode-exclusion.md:4
  Quote: ```
  **Date:** 2025-06-09
````

Rule: All other ADRs are dated 2026. ADR 0013 is dated 2026-06-09 (next day). The year 2025 is inconsistent.
Fix: Change date from 2025-06-09 to 2026-06-09.

```

---

## Compliance Verification Per ADR

### ADR 0001 — Dynamic Access Control ✅

- `dynamicAccessControl: { enabled: true }` present in `auth.ts:89-91` ✅
- `ac`, `owner`, `admin`, `memberRole` passed to `organization()` plugin ✅
- `can()` in `shared/domain/permissions.ts` — sync, boundary-compliant ✅
- `usePermissions()` hook in `shared/hooks/usePermissions.ts` ✅
- `hasRole()` used only for sidebar visibility and hierarchy checks (with exception noted above) ✅
- No `canEdit`/`canCreate`/`canDelete` prop drilling — components use `usePermissions()` ✅
- Three roles defined: AccountAdmin, PropertyManager, Staff ✅
- `invitation.list` permission present in statement ✅
- `goal.*` permissions present in statement and Permission type ✅

### ADR 0002 — Section-Based Navigation ✅

- Manager/Admin routes: /dashboard, /reviews, /people, /portals, /settings ✅
- Staff routes: /home, /progress, /leaderboard, /team (conditional), /settings ✅
- ManagerSidebar and StaffSidebar as distinct components ✅
- Settings sidebar as separate layout ✅
- Property switcher (scope filter) implemented ✅
- `hasRole(ctx.role, 'PropertyManager')` drives sidebar selection ✅

### ADR 0003 — Review Bounded Context ✅

- `review` context exists with own build.ts, domain/, application/, infrastructure/ ✅
- `GoogleReviewApiPort` in review/application/ports/ ✅
- Adapter lives in integration/infrastructure/ (composition.ts wires them) ✅
- Events: `review.created`, `review.updated` emitted ✅
- Per-property sync via BullMQ jobs ✅
- Refresh-expiring and purge-expired review jobs present ✅
- Integration retains only connection/OAuth/token concerns ✅
- Property import in property context (not integration) ✅

### ADR 0004 — Inbox Bounded Context ✅

- `inbox` context with full domain/application/infrastructure layers ✅
- Status workflow: `new | read | addressed | escalated | archived` matches ADR ✅
- Event handlers for `review.created` and `feedback.submitted` ✅
- Inbox notes (not single text field) ✅
- Assignment: PM+ only via `canAssign` rule ✅
- Redis unread counter (new-counter.port.ts) ✅
- Cursor pagination implemented ✅

### ADR 0005 — GBP Review API Fix ⚠️

- Path enrichment: `accounts/{accountName}/` prefix in list-gbp-locations.ts ✅
- `recoverable` flag on `IntegrationError` ✅
- `integrationError` remains plain tagged object — ADR claims Error hybrid ❌ (BLOCKER)
- Two separate adapters (gbp-api.adapter.ts, google-review-api.adapter.ts) ✅

### ADR 0006 — Staff Bounded Context ✅

- `staff` context with own build.ts, domain/, application/, infrastructure/ ✅
- Identity retains auth/session/org membership only ✅
- Staff owns: staff assignments, property assignments, CRUD ✅
- Cross-context access via public-api.ts ports ✅
- Invitation acceptance hook creates staff assignments in composition.ts ✅

### ADR 0007 — Dashboard Read-Only Aggregation ✅

- `dashboard` context with no domain events, no write operations ✅
- Facade ports: ReviewStatsPort, MetricStatsPort, PortalMetricsPort, StaffPortalResolverPort ✅
- Adapters in dashboard/infrastructure/adapters/ encapsulate SQL ✅
- Dashboard build.ts takes ports as input, never queries other tables directly ✅
- No database tables owned by dashboard ✅

### ADR 0008 — Cross-Context Boundaries ✅

- All contexts expose `public-api.ts` ✅
- Cross-context imports go through public-api.ts or port interfaces ✅
- No domain/ or infrastructure/ cross-context imports found in production code ✅
- Infrastructure adapters encapsulate cross-context SQL ✅
- Events subscribed via `infrastructure/event-handlers/` ✅

### ADR 0009 — Permission Model ✅

- `can(role, permission)` pattern in shared/domain/permissions.ts ✅
- Centralized statement in shared/auth/permissions.ts ✅
- Permission type in shared/domain/permissions.ts with compile-time union ✅
- Three default roles defined via `createAccessControl` ✅
- O(1) Set-based lookup at runtime ✅
- hasRole() hierarchy misuse noted in finding above (MAJOR)

### ADR 0010 — Activity BullMQ Delivery ✅

- `insert-activity-log` BullMQ job present ✅
- Event handlers enqueue jobs to queue, not direct use-case calls ✅
- `insertActivityLog` use case called by worker ✅
- Worker job handler in activity/infrastructure/jobs/ ✅

### ADR 0011 — Notification BullMQ Delivery ✅

- `insert-notification` BullMQ job present ✅
- Event handlers subscribe to domain events and enqueue jobs ✅
- Idempotency via repository lookup ✅
- Additional jobs: `urgent-email`, `digest-notification` for email delivery ✅

### ADR 0012 — Nitro Dev-Mode Exclusion ✅

- vite.config.ts loads nitro only when `mode === 'production'` ✅
- Code matches ADR example exactly ✅

### ADR 0013 — Portal Groups Replace Team/Staff Scope ✅

- `EntityScope` type: `'property' | 'portal_group' | 'portal'` ✅
- No `teamId` or `staffId` on Goal type — replaced by `portalGroupId` ✅
- `deriveEntityScope()` has three branches: portal_group → portal → property ✅
- `VALID_SCOPE_METRIC_KEYS` has no `team`/`staff` entries ✅
- `portal_group` uses same metric keys as `portal` ✅
```
