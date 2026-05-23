# Round 1A — CONTEXT.md + ADR Adherence Review

**Reviewer:** automated (round-4)
**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-24

---

## CONTEXT.md Findings

### [MAJOR] Review CONTEXT.md is incomplete — missing Events, Use Cases, Layers, Public API, Server Functions sections

**File:** `src/contexts/review/CONTEXT.md`
**Rule:** CONTEXT.md must document events produced, events consumed, architecture layers, use cases, public API, and server functions (per root CONTEXT.md pattern)
**Issue:** Review CONTEXT.md has only 27 lines — it contains Glossary and Invariants but is missing Events produced/consumed, Architecture layers, Use cases, Public API, Server functions, and Permissions sections. Every other full context (inbox, identity, goal, staff, dashboard) documents all of these. The review domain has events (`review.created`, `review.updated`, `review.expired`, `reply.published`), use cases (`sync-reviews`, `reply-operations`), server functions (`reply.ts`), and a public API — none are documented.
**Fix:** Add the missing sections following the pattern in `inbox/CONTEXT.md` or `goal/CONTEXT.md`. Document: events produced (`review.created`, `review.updated`, `review.expired`, `reply.published`), events consumed (from property context via `on-property-created` handler), architecture layers, use cases, public API exports, server functions, and permissions.

### [MINOR] `review.expired` event exists in code but not documented in Review CONTEXT.md

**File:** `src/contexts/review/CONTEXT.md`
**Rule:** All domain events must be documented in CONTEXT.md
**Issue:** `domain/events.ts` defines `ReviewExpired` (`review.expired`) and has a constructor, but the CONTEXT.md has no Events section at all, so this event is undocumented.
**Fix:** Document `review.expired` in the Events produced section when adding the missing sections.

### [MINOR] Missing CONTEXT.md for 4 contexts: metric, portal, property, team

**File:** `src/contexts/metric/`, `src/contexts/portal/`, `src/contexts/property/`, `src/contexts/team/`
**Rule:** Per root `src/contexts/CONTEXT.md` architecture expectations, each bounded context should have a CONTEXT.md documenting its domain rules, events, use cases, layers, and public API
**Issue:** These four contexts lack a CONTEXT.md file entirely. They each have domain logic (events, types, rules, constructors), use cases, server functions, and public APIs — all undocumented.
**Fix:** Create CONTEXT.md for each context following the established pattern (see `goal/CONTEXT.md` as a template).

### [MINOR] Integration CONTEXT.md missing Architecture layers, Use cases, Public API, and Server functions sections

**File:** `src/contexts/integration/CONTEXT.md`
**Rule:** CONTEXT.md should document architecture layers, use cases, public API, and server functions
**Issue:** Integration CONTEXT.md has Glossary, Relationships, Domain Rules, Example dialogue, and Flagged ambiguities — but is missing Architecture layers, Use cases, Public API, Server functions, Events produced/consumed, and Permissions sections. The integration context has 13 use cases, 2 server files, 5 events, and a public API — all undocumented in CONTEXT.md.
**Fix:** Add the missing sections. Integration produces events: `google.account_connected`, `google.account_disconnected`, `google.connection_visibility_changed`, `property.import_completed`. It has use cases: `connect-google-account`, `disconnect-google-account`, `list-gbp-locations`, `start-property-import`, `import-property`, `get-import-status`, `list-google-connections`, `refresh-google-token`, `handle-gbp-notification`, `update-connection-visibility`.

### [MINOR] Guest CONTEXT.md missing Architecture layers, Use cases, Public API, Events, and Server functions sections

**File:** `src/contexts/guest/CONTEXT.md`
**Rule:** CONTEXT.md should document architecture layers, use cases, events, public API, and server functions
**Issue:** Guest CONTEXT.md has Language, Relationships, Example dialogue, and Flagged ambiguities but is missing Architecture layers, Use cases, Events produced, Public API, and Server functions sections. Guest context has 9 use cases, 4 events (`scan.recorded`, `rating.submitted`, `feedback.submitted`, `review-link.clicked`), and a public API.
**Fix:** Add missing sections following the established pattern.

### [MINOR] Staff CONTEXT.md documents no `build.ts` but one exists

**File:** `src/contexts/staff/CONTEXT.md`
**Rule:** Architecture layers section must accurately reflect actual file structure
**Issue:** The Staff CONTEXT.md Architecture layers section does not list a `build.ts` composition root, but `src/contexts/staff/build.ts` exists. This is an omission in the documentation.
**Fix:** Add `build.ts composition root` to the Architecture layers section.

### [NIT] Dashboard CONTEXT.md lists `build.ts` in architecture layers — correct

**File:** `src/contexts/dashboard/CONTEXT.md`
**Rule:** N/A — verified correct
**Issue:** No issue. Confirming that Dashboard CONTEXT.md correctly documents all layers: domain (types.ts, errors.ts), application ports/dto/use-cases/public-api, infrastructure adapters/repositories, server, and build.ts. All files exist as documented.
**Fix:** N/A

## ADR Findings

### [MAJOR] ADR-0001 documents `goal.write` permission but actual code uses `goal.create`/`goal.update`/`goal.cancel`

**File:** `docs/adr/0001-dynamic-access-control.md` (line 80)
**Rule:** ADR implementation notes must reflect actual code
**Issue:** ADR-0001 line 80 states: "Phase 15C added `goal.read`, `goal.write` permissions for the Goal bounded context." However, the actual permission statement in `src/shared/auth/permissions.ts` defines `goal: ['read', 'create', 'update', 'cancel']` — four separate permissions, not `goal.read` + `goal.write`. The ADR says `goal.write` is "granted to AccountAdmin and PropertyManager" but the code gives them `goal.create`, `goal.update`, and `goal.cancel` separately. Staff gets `goal: ['read', 'create']` (not just `goal.read`).
**Fix:** Update ADR-0001 line 80 to read: "Phase 15C added `goal.read`, `goal.create`, `goal.update`, `goal.cancel` permissions. AccountAdmin and PropertyManager get all four; Staff gets `goal.read` and `goal.create`."

### [MINOR] ADR-0003 key decision 10 states `gbp_cache` data_type narrowed to `['location']` — verify compliance

**File:** `docs/adr/0003-review-bounded-context.md`
**Rule:** ADR decisions must be followed in code
**Issue:** ADR-0003 decision #10 states "`gbp_cache` for locations only. Reviews are normalized in the `reviews` table. No raw review blobs in cache. `data_type` enum narrowed to `['location']`." This was verified — the `gbp_cache` repository exists in integration context and reviews live in review context tables. The decision appears to be followed.
**Fix:** N/A — verified compliant.

### [MINOR] ADR-0007 Dashboard read-only invariant — verified correct

**File:** `docs/adr/0007-dashboard-read-only-aggregation.md`
**Rule:** Dashboard must be read-only — no writes, no events, no domain rules
**Issue:** Verified: `dashboard/domain/` contains only `errors.ts` and `types.ts` (no rules, no events, no constructors). No event handlers, no jobs. `build.ts` wires adapters to ports. The invariant holds.
**Fix:** N/A — verified compliant.

### [NIT] ADR-0008 cross-context boundary compliance — all imports go through public-api.ts

**File:** `docs/adr/0008-cross-context-boundaries.md`
**Rule:** All cross-context imports must go through `public-api.ts` or dedicated lookup ports
**Issue:** Verified all cross-context imports in infrastructure layers. Every cross-context import (event handlers, adapters, jobs) correctly imports from the producing context's `application/public-api.ts`. No domain layer imports from other contexts. No application layer imports from other contexts' internals. The only cross-context imports are in `infrastructure/` layers (event handlers, adapters, jobs) and all go through `public-api.ts`. Compliant.
**Fix:** N/A — verified compliant.

### [NIT] ADR-0009 permission model — `can()` usage verified

**File:** `docs/adr/0009-permission-model.md`
**Rule:** Every server function must call `can(ctx.role, '<resource>.<action>')` before invoking the use case
**Issue:** Verified in goal server functions: `can(ctx.role, 'goal.create')`, `can(ctx.role, 'goal.update')`, `can(ctx.role, 'goal.cancel')`, `can(ctx.role, 'goal.read')` are all called. Review reply server functions use `can(ctx.role, 'reply.manage')` and `can(ctx.role, 'review.read')`. The centralized permission table in `shared/auth/permissions.ts` defines the statement and three roles. Compliant.
**Fix:** N/A — verified compliant.

### [MINOR] ADR-0004 Inbox CONTEXT.md documents `createInboxItem` use case as "internal only" — no server function

**File:** `src/contexts/inbox/CONTEXT.md`
**Rule:** Documented use cases should match actual code structure
**Issue:** Inbox CONTEXT.md documents `createInboxItem` as a use case with permission "internal only" — correctly noting it's called by event handlers, not server functions. The file exists at `src/contexts/inbox/application/use-cases/create-inbox-item.ts` and is called from event handlers. This is correct behavior, just noting the pattern is well-documented.
**Fix:** N/A — verified correct.

### [MINOR] Staff CONTEXT.md does not document `StaffPublicApi` event re-exports that exist in code

**File:** `src/contexts/staff/CONTEXT.md`
**Rule:** Public API documentation must match actual exports
**Issue:** Staff CONTEXT.md documents Public API as `StaffPublicApi` type with two methods (`getAccessiblePropertyIds`, `findByReferralCode`). However, the actual `src/contexts/staff/application/public-api.ts` also re-exports event types (`StaffUnassigned`, `StaffAssigned`, `StaffEvent`) and constructors (`staffUnassigned`, `staffAssigned`). These event re-exports are not mentioned in the CONTEXT.md Public API section.
**Fix:** Add event type re-exports to the Staff CONTEXT.md Public API section: "Event types: `StaffAssigned`, `StaffUnassigned`, `StaffEvent`. Event constructors: `staffAssigned`, `staffUnassigned`."

### [MINOR] Goal CONTEXT.md Public API section lists `deriveEntityScope` as a function export — verified present

**File:** `src/contexts/goal/CONTEXT.md`
**Rule:** Documented public API must match actual exports
**Issue:** No issue. Verified that `deriveEntityScope` is exported from `goal/application/public-api.ts` (re-exported from `dto/goal.dto`). Also verified `GoalRepository`, `GoalListFilter` port types, event types, and constructors are all exported as documented. Compliant.
**Fix:** N/A — verified compliant.

### [NIT] Goal CONTEXT.md architecture lists `ui/helpers.ts` — non-standard layer

**File:** `src/contexts/goal/CONTEXT.md`
**Rule:** Architecture layers must follow the four-layer pattern from root CONTEXT.md
**Issue:** Goal CONTEXT.md includes a `ui/helpers.ts` entry in its architecture layers, which is not one of the standard four layers (domain, application, infrastructure, server). The file exists and contains pure UI helper functions. This is a minor deviation — the root CONTEXT.md doesn't explicitly prohibit additional layers, but the four-layer pattern is strongly implied.
**Fix:** Consider noting this as an intentional deviation in the CONTEXT.md (similar to how Identity documents "Intentional deviations").

---

## Summary

**BLOCKER:** 0
**MAJOR:** 2

- Review CONTEXT.md incomplete (missing major sections)
- ADR-0001 `goal.write` vs actual `goal.create`/`goal.update`/`goal.cancel` mismatch

**MINOR:** 7

- 4 contexts missing CONTEXT.md (metric, portal, property, team)
- Integration CONTEXT.md missing sections
- Guest CONTEXT.md missing sections
- Staff CONTEXT.md missing event re-exports in Public API
- Staff CONTEXT.md missing `build.ts` in architecture layers
- `review.expired` event not documented
- Goal `ui/` layer is non-standard (noted as deviation)

**NIT:** 3

- Dashboard CONTEXT.md verified correct
- ADR-0008 cross-context boundaries verified compliant
- ADR-0009 permission model verified compliant
