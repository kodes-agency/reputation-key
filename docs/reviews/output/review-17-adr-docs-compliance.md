# Review #17 — ADR & Documentation Compliance

**Date:** 2026-05-23
**Reviewer:** Automated Audit
**Scope:** All `docs/adr/`, root `CONTEXT.md`, every layer `CONTEXT.md`, cross-referenced against code in `src/`

---

## Findings

### MAJOR — `goal` bounded context missing from root CONTEXT.md and contexts/CONTEXT.md

The `goal` bounded context exists as a full implementation at `src/contexts/goal/` (41 files including domain, application, infrastructure, server, and ui layers), is wired in `src/composition.ts` (line 43, 241, 310, 323), and has events registered in `src/shared/events/events.ts` — yet it is absent from both the bounded-contexts table in root `CONTEXT.md` (which lists 11 contexts: Identity through Dashboard) and the bounded-contexts table in `src/contexts/CONTEXT.md` (which also lists 11 contexts).

```
File: CONTEXT.md:26-38
Quote:
```

| Identity | ... |
| Property | ... |
| ...
| Dashboard | ... |

```
(12th context `Goal` is missing)
```

```
File: src/contexts/CONTEXT.md:7-19
Quote:
```

| Identity | ... |
| ...
| Dashboard | ... |

```
(12th context `Goal` is missing)
```

**Rule:** Root CONTEXT.md bounded-contexts table must list every bounded context in code (and vice versa). A bounded context exists in code but is missing from the table.

**Fix:** Add `Goal` row to both `CONTEXT.md` and `src/contexts/CONTEXT.md` bounded-contexts tables. E.g.:
`| Goal | Property-scoped goals with progress tracking | Goal, GoalInstance | Thick |`

---

### MAJOR — ADRs 0006 and 0007 on disk but not indexed in root CONTEXT.md

Root CONTEXT.md "Architecture Decisions" table (lines 107-113) lists ADRs 0001 through 0005 only. ADRs 0006 (Staff as a Separate Bounded Context) and 0007 (Dashboard as a Read-Only Aggregation Context) exist on disk at `docs/adr/` but are not indexed in the root CONTEXT.md ADR table.

```
File: CONTEXT.md:107-113
Quote:
```

| 0001 | Dynamic Access Control via Better-auth | Identity & Authorization |
| 0002 | Section-Based Navigation | Navigation Architecture |
| 0003 | Review as a Separate Bounded Context | Reviews, Google Integration |
| 0004 | Inbox as a Separate Bounded Context | Unified Inbox, Reviews, Feedback |
| 0005 | GBP Review API Path and Error Model Fix | Google Integration, Error Model |

```
(0006 and 0007 missing)
```

**Rule:** An ADR on disk should be indexed in CONTEXT.md. The table stops at 0005 despite 0006 and 0007 existing.

**Fix:** Append two rows to the ADR table in root CONTEXT.md:

```
| 0006 | Staff as a Separate Bounded Context     | Identity, Staff Management       |
| 0007 | Dashboard as a Read-Only Aggregation    | Dashboard, Read Models           |
```

---

### MAJOR — `goal` context routes exist but routes/CONTEXT.md does not document them

The route `src/routes/_authenticated/properties/$propertyId/goals.tsx` and nested routes `goals/new.tsx`, `goals/$goalId.tsx` exist on disk but `src/routes/CONTEXT.md` does not mention goals in its route tree.

```
File: src/routes/CONTEXT.md:9-50
Quote:
```

properties/
$propertyId/
index.tsx property detail
metrics.tsx
reviews.tsx
people.tsx
portals/
...
teams/
...

```
(goals/ sub-routes missing)
```

**Rule:** Route structure documentation must reflect actual routes.

**Fix:** Add `goals/` section to routes/CONTEXT.md under `properties/$propertyId/`:

```
    goals/
      index.tsx, new.tsx, $goalId.tsx
```

---

### MINOR — `review.received` event name in contexts/CONTEXT.md is stale; actual event tag is `review.created`

```
File: src/contexts/CONTEXT.md:135
Quote:
```

- Past-tense: `portal.created`, `review.received`. Never commands.

```

**Rule:** Doc examples must match code. The actual event tag in `src/contexts/review/domain/events.ts:15` is `review.created`, not `review.received`.

**Fix:** Change `review.received` to `review.created` in the event naming example at `src/contexts/CONTEXT.md:135`.

---

### MINOR — Stale TODOs without issue links

```

File: src/shared/events/event-bus.ts:11
Quote:

```
// TODO: Evaluate BullMQ-based event persistence for critical events in Phase 4+.
```

**Rule:** Stale TODOs older than N months should have an issue link.

**Fix:** Add an issue reference: `// TODO(#XXX): Evaluate BullMQ-based event persistence...` or remove if no longer relevant.

---

```
File: src/contexts/metric/infrastructure/repositories/metric.repository.ts:102
Quote:
```

// TODO: staffId filter added in Phase 14.5 — uncomment after merge

```

**Rule:** Stale TODOs without issue links.

**Fix:** Add issue reference or resolve the TODO if Phase 14.5 has been merged.

---

```

File: src/shared/auth/auth.ts:19
Quote:

```
// import { sendVerificationEmail } from './emails' // TODO: re-enable with email verification
```

```
File: src/shared/auth/auth.ts:54
Quote:
```

      // TODO: Enable email verification in production

```

```

File: src/shared/auth/auth.ts:66
Quote:

```
    // TODO: Re-enable email verification once email sending is set up
```

**Rule:** Stale TODOs without issue links.

**Fix:** Add issue references to all three TODOs in `auth.ts`, or create a tracking issue and reference it.

---

## NIT

### NIT — `goal` context lacks a per-context `CONTEXT.md`

Every other bounded context that has substantial code (`review`, `integration`, `inbox`, `guest`) has a per-context `CONTEXT.md`. The `goal` context (41 files) does not have one. Similarly, `staff`, `dashboard`, `identity`, `property`, `portal`, `team`, and `metric` also lack per-context `CONTEXT.md` files, but `goal` is the most significant omission given its size.

**Fix:** Create `src/contexts/goal/CONTEXT.md` with glossary, relationships, and invariants per the established pattern.

---

### NIT — `goal` context has a non-standard `ui/` layer

The `goal` context has a `ui/` folder (`src/contexts/goal/ui/helpers.ts`) containing pure UI helper functions. The standard four-layer architecture defined in `src/contexts/CONTEXT.md` lists `domain/`, `application/`, `infrastructure/`, and `server/` — no `ui/` layer is documented. While the helpers are pure functions (no DOM), this folder doesn't match the documented architecture.

**Fix:** Either document the `ui/` layer as an allowed extension in `src/contexts/CONTEXT.md`, or move `helpers.ts` to `src/components/features/goal/` (following the components structure).

---

## ADR Compliance Summary

| ADR  | Title                                        | Status      | Compliance    | Notes                                                                                                                                                                                                                            |
| ---- | -------------------------------------------- | ----------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | Dynamic Access Control via Better-auth       | Implemented | **Compliant** | `dynamicAccessControl` enabled in auth.ts. `can()`/`usePermissions()` used correctly. No `canEdit` prop drilling. Double-mapping bug fixed.                                                                                      |
| 0002 | Section-Based Navigation                     | Implemented | **Compliant** | Route structure matches: `/dashboard`, `/inbox`, `/settings`, `/leaderboard`, `/progress`, `/team`. Property-scoped sections under `properties/$propertyId/`. Goals route added as extension.                                    |
| 0003 | Review as a Separate Bounded Context         | Implemented | **Compliant** | `review` context exists with all described layers. `GoogleReviewApiPort` facade in `integration/infrastructure/adapters/`. Events `review.created`, `review.updated` emitted.                                                    |
| 0004 | Inbox as a Separate Bounded Context          | Implemented | **Compliant** | `inbox` context exists with status workflow, notes, assignment. Events subscribed: `review.created`, `feedback.submitted`, `reply.published`. Cursor pagination implemented.                                                     |
| 0005 | GBP Review API Path and Error Model Fix      | Accepted    | **Drift**     | Status is "Accepted" not "Implemented". The error model fix (integrationError inheriting from Error) and path enrichment appear partially in code but ADR still shows "Accepted". Verify if fully implemented and update status. |
| 0006 | Staff as a Separate Bounded Context          | Implemented | **Compliant** | `staff` context exists with `build.ts`, domain, application, infrastructure, server layers. Wired in composition.ts. Not indexed in root CONTEXT.md (see MAJOR finding above).                                                   |
| 0007 | Dashboard as a Read-Only Aggregation Context | Implemented | **Compliant** | `dashboard` context has no domain events, no writes, reads via ports. Matches "no tables, no events" decision. Not indexed in root CONTEXT.md (see MAJOR finding above).                                                         |

---

## Required Doc Edits

| #   | File                                                                   | Edit                                                                                 |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `CONTEXT.md`                                                           | Add `Goal` row to bounded-contexts table                                             |
| 2   | `CONTEXT.md`                                                           | Add ADR 0006 and ADR 0007 rows to Architecture Decisions table                       |
| 3   | `src/contexts/CONTEXT.md`                                              | Add `Goal` row to bounded-contexts table                                             |
| 4   | `src/contexts/CONTEXT.md`                                              | Fix event name example: `review.received` → `review.created`                         |
| 5   | `src/routes/CONTEXT.md`                                                | Add `goals/` sub-routes to the route tree under `properties/$propertyId/`            |
| 6   | `docs/adr/0005-*.md`                                                   | Verify implementation status and update from "Accepted" to "Implemented" if complete |
| 7   | `src/shared/events/event-bus.ts`                                       | Add issue reference to TODO at line 11                                               |
| 8   | `src/contexts/metric/infrastructure/repositories/metric.repository.ts` | Add issue reference to TODO at line 102 or resolve                                   |
| 9   | `src/shared/auth/auth.ts`                                              | Add issue references to TODOs at lines 19, 54, 66                                    |
| 10  | `src/contexts/goal/`                                                   | Create per-context `CONTEXT.md`                                                      |
| 11  | `src/contexts/CONTEXT.md`                                              | Optionally document `ui/` as a valid context layer extension                         |

---

**Summary:** 0 BLOCKER, 3 MAJOR, 1 MINOR (with 4 sub-instances), 2 NIT. The most significant issue is the undocumented `goal` bounded context (41 files, fully wired) missing from all architecture documentation. ADRs 0006 and 0007 are implemented but not indexed in root CONTEXT.md. ADR 0005 is marked "Accepted" but may be implemented — status verification needed.
