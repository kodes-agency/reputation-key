# Remediation Tracker: Review Findings (2026-07-11)

**Branch:** fix/review-remediation-2026-07-11  
**Source Review:** Multi-agent review (doc-audit, pattern, query, best-practices, permissions architect subagents) on 2026-07-11.  
**Goal:** Track every finding to resolution with explicit Decision (doc update / code rewrite / both / defer), evidence, and verification.

**Status Legend:** Open | In Progress | Fixed | Verified | Deferred

**Overall Progress:** Phase 0 in progress. All findings from review to be listed here for 100% coverage.

---

## A. Documentation Issues

**Decision policy:** Primarily documentation updates to match `docs/standards.md` §4 and layer rules. Align tables to live code where inaccurate. Remove forbidden content.

| ID     | Finding                                                                                            | File(s)                                                                                   | Severity | Rule                                                | Decision          | Rationale / Notes                                                                     | Status       | Evidence / PR                                                                      |
| ------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| DOC-01 | Missing required "## Bounded context" section (starts with Glossary)                               | src/contexts/badge/CONTEXT.md, goal/CONTEXT.md, leaderboard/CONTEXT.md, portal/CONTEXT.md | BLOCKER  | docs/standards.md §4.1 (exact order, first section) | Doc update        | Add one-sentence description per root CONTEXT.md glossary                             | Fixed        | Phase 1 - inserted ## Bounded context sections in badge, goal, leaderboard, portal |
| DOC-02 | Inaccurate Events produced table (wrong/missing payloads, omitted event)                           | src/contexts/identity/CONTEXT.md                                                          | BLOCKER  | docs/standards.md §4.1 (tables must match code)     | Align doc to code | Update to actual types from domain/events.ts (no email, add canceled, correct fields) | Open         |                                                                                    |
| DOC-03 | Use cases / Server functions tables incomplete                                                     | src/contexts/identity/CONTEXT.md, goal/CONTEXT.md                                         | MAJOR    | docs/standards.md §4.1                              | Doc update        | Add missing wired use cases and server fns after confirming build.ts                  | Open         |                                                                                    |
| DOC-04 | Forbidden sections present ("Intentional deviations", "Flagged ambiguities", "Resolved decisions") | src/contexts/goal/CONTEXT.md, inbox/CONTEXT.md, notification/CONTEXT.md                   | MAJOR    | docs/standards.md §4.3                              | Doc cleanup       | Remove; move valuable rationale to ADR or GitHub issue                                | Fixed (goal) | Phase 1 - removed Intentional deviations and Flagged ambiguities from goal         |
| DOC-05 | Numbered headings instead of plain                                                                 | src/contexts/notification/CONTEXT.md                                                      | MAJOR    | docs/standards.md §4.1                              | Doc update        | Remove "1. ", "2. " etc. prefixes                                                     | Fixed        | Phase 1 - all ## N. headings cleaned to plain ##                                   |
| DOC-06 | Extra non-standard section                                                                         | src/contexts/portal/CONTEXT.md                                                            | MINOR    | docs/standards.md §4.1-4.2                          | Doc update        | Remove or merge "## Errors"                                                           | Open         |                                                                                    |

**Notes for Phase 1:** Prioritize DOC-01, DOC-02, DOC-04. After edits, re-verify with doc-audit subagent.

---

## B. Event & Domain Pattern Issues

**Decision policy:** Code rewrites to comply with `docs/standards.md` §§1, 8 and `src/contexts/CONTEXT.md`. Add tests where missing.

| ID     | Finding                                                                           | File(s)                                                                                                 | Severity         | Rule                                                      | Decision                     | Rationale / Notes                                                          | Status | Evidence / PR |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | ------ | ------------- |
| EVT-01 | Events do not auto-generate eventId inside constructor                            | src/contexts/property/domain/events.ts                                                                  | CRITICAL         | docs/standards.md §1.5                                    | Code rewrite                 | Implement newEventId(), adjust Omit and constructors. Update tests.        | Open   |               |
| EVT-02 | Event envelope field ordering violations (corrId/occurredAt before domain fields) | Multiple (badge, goal, portal, identity, property, review, inbox, etc.)                                 | MAJOR (systemic) | docs/standards.md §1.9 (ordered fields)                   | Code rewrite                 | Standardize to eventId, orgId, propertyId?, ..., occurredAt, correlationId | Open   | Batch fixes   |
| EVT-03 | Inline throw instead of assert() in constructors                                  | src/contexts/identity/domain/events.ts, inbox/, property/, metric/, staff/, integration/                | MAJOR (systemic) | docs/standards.md §1.4 (use assert for impossible states) | Code rewrite                 | Import from '#/shared/domain/assert', use assert(...)                      | Open   |               |
| EVT-04 | Infra factories use `export function` not arrow-const                             | src/contexts/badge/infrastructure/mappers/..., leaderboard/mappers/..., goal/event-handlers/..., inbox/ | MAJOR            | docs/standards.md §8.3                                    | Code rewrite                 | Convert to `export const xxx = (deps) => ({...})`                          | Open   |               |
| EVT-05 | Missing co-located events.test.ts                                                 | src/contexts/identity/domain/events.ts, inbox/, portal/, property/                                      | MAJOR            | docs/standards.md §8.2                                    | Add tests (code)             | Follow patterns from review/ or goal/                                      | Open   |               |
| EVT-06 | build.ts adds extra keys to internal                                              | src/contexts/goal/build.ts, portal/build.ts                                                             | MINOR            | docs/standards.md §3.1 (only repos, useCases)             | Code (or doc if intentional) | Remove extras or update standards + CONTEXT.md                             | Open   |               |

---

## C. Query Unification Issues

**Decision policy:** Code changes to complete unification per current branch intent and `src/routes/CONTEXT.md`.

| ID     | Finding                                                             | File(s)                                                                       | Severity | Rule                                                 | Decision      | Rationale / Notes                                               | Status | Evidence / PR |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------- | ------------- | --------------------------------------------------------------- | ------ | ------------- |
| QRY-01 | Manual useState + useEffect + useServerFn bypassing Query           | src/components/features/portal/portal-analytics/portal-analytics-tab.tsx      | MAJOR    | routes/CONTEXT.md (no manual fetching)               | Code rewrite  | Migrate to useQuery/useSuspenseQuery + query key + invalidation | Open   |               |
| QRY-02 | useQuery + enabled instead of useSuspenseQuery after loader priming | src/routes/\_authenticated/home.tsx, progress.tsx, leaderboard.tsx            | MAJOR    | routes/CONTEXT.md (useSuspenseQuery on primed cache) | Code rewrite  | Switch to useSuspenseQuery with same queryOptions               | Open   |               |
| QRY-03 | Missing explicit staleTime on queryOptions                          | Multiple (home, progress, leaderboard, goals/new, etc.)                       | MAJOR    | routes/CONTEXT.md (documented staleTime strategy)    | Code          | Add staleTime values                                            | Open   |               |
| QRY-04 | Mutations defined inside components (not route files)               | src/components/features/property/people/people-page.tsx, portal/link-tree/... | MINOR    | routes/CONTEXT.md (define in route, pass as prop)    | Code refactor | Move to route files, pass wrapped actions                       | Open   |               |
| QRY-05 | Raw server fns passed to components                                 | Various routes (e.g. properties portals, people)                              | MINOR    | routes/CONTEXT.md                                    | Code          | Wrap in routes                                                  | Open   |               |

---

## D. Permissions / Authz / Boundary Issues

**Key upfront decision (Phase 0/3):** Add gates at server-fn HTTP boundary (follow existing contract) vs update docs/ADRs to allow use-case only.

**Current decision:** Follow contract — add `canForContext` at server fns (Option A).

| ID      | Finding                                          | File(s)                                                                                                                                     | Severity          | Rule                                                                     | Decision     | Rationale / Notes                     | Status   | Evidence / PR |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ | ------------ | ------------------------------------- | -------- | ------------- |
| AUTH-01 | Server fns resolve ctx but no canForContext gate | src/contexts/identity/server/organizations.update.ts, upload.ts, response-sla.ts; property/server/properties.ts etc.; portal/server/\* many | BLOCKER (hygiene) | ADR 0009, root CONTEXT.md ("permission always checked at HTTP boundary") | Code rewrite | Add canForContext before useCase call | Open     |               |
| AUTH-02 | Leaderboard uses static can()                    | src/contexts/leaderboard/server/leaderboards.ts                                                                                             | INCONSISTENCY     | Prefer canForContext for dynamic roles                                   | Code         | Switch to canForContext               | Open     |               |
| AUTH-03 | Domain rule re-exported via server barrel        | src/contexts/portal/server/portal-links.ts (isValidExternalUrl) consumed by API route                                                       | SMELL             | root CONTEXT.md (server barrels only createServerFn + type)              | Code hygiene | Import directly from domain or move   | Open     |               |
| AUTH-04 | UI uses hook correctly                           | components/... (sampled)                                                                                                                    | GOOD              | -                                                                        | No change    | Document as compliant                 | Verified |               |

**Notes:** Use-case level staff_assignment scoping already correct. Org-wide ops intentionally unscoped.

---

## E. Testability, Clock, Errors, etc.

| ID     | Finding                                                           | File(s)                                                                | Severity        | Rule                        | Decision                                                       | Rationale / Notes                                            | Status                 | Evidence / PR |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- | --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------- | ------------- |
| CLK-01 | Dashboard use cases have no clock dep, raw new Date() for periods | src/contexts/dashboard/application/use-cases/get-\*.ts (multiple)      | CRITICAL        | ADR 0017 (injectable clock) | Code rewrite                                                   | Thread clock(), update build and callers                     | Open                   |               |
| CLK-02 | Bare new Date() for timestamps                                    | team/infra/repos, staff/, integration/ (many), notification digest job | HIGH (systemic) | ADR 0017                    | Code rewrite                                                   | Replace with deps.clock()                                    | Open                   |               |
| ERR-01 | Inconsistent error contracts (Result vs throw)                    | Goal (Result), Inbox (throw), servers bifurcate                        | HIGH            | Best practice consistency   | Architectural: standardize on Result for fallible (code + doc) | Recommend in standards.md; align gradually                   | Open (decision needed) |               |
| SIM-01 | Simulation harness / invariants unused                            | shared/testing/ (exists) vs src tests                                  | HIGH            | ADR 0019                    | Code/test improvement                                          | Integrate into key tests (clock-sensitive, progress, badges) | Open                   |               |
| TST-01 | Activity use case has zero tests                                  | src/contexts/activity/application/use-cases/insert-activity-log.ts     | HIGH            | Testing standards           | Add tests                                                      | Co-located .test.ts                                          | Open                   |               |
| TST-02 | Weaker co-location for jobs/handlers                              | Various                                                                | MEDIUM          | §8.2                        | Add tests                                                      |                                                              | Open                   |               |

**Good areas:** tracedHandler everywhere, Readonly<> discipline, no domain mutation, narrow wiring.

---

## Tracking Notes

- All original review findings from 2026-07-11 subagents must appear here.
- For each: link back to subagent output or specific File:line from review.
- After fix: update Status, add link to commit, mark Verified after Phase 8 gate.
- New issues discovered during fixes: add with "Discovered during remediation".

**Phase 0 Gate:** This tracker must list (or reference) 100% of BLOCKER/MAJOR from the review before proceeding to implementation phases.

**Baseline snapshot (to be filled on Phase 0):**

- Date:
- git describe:
- `pnpm typecheck` exit:
- `pnpm lint` summary:

---

_This tracker is the single source of truth for the remediation on this branch. Update it as work progresses._
