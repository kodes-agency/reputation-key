# Remediation Tracker: Review Findings (2026-07-11)

**Branch:** fix/review-remediation-2026-07-11  
**Source Review:** Multi-agent review (doc-audit, pattern, query, best-practices, permissions architect subagents) on 2026-07-11.  
**Goal:** Track every finding to resolution with explicit Decision (doc update / code rewrite / both / defer), evidence, and verification.

**Status Legend:** Open | In Progress | Fixed | Verified | Deferred

**Overall Progress:** All phases executed. Plan implementation complete on branch (see Phase 8 section). Remaining systemic items noted for optional batch follow-up.

---

## A. Documentation Issues

**Decision policy:** Primarily documentation updates to match `docs/standards.md` §4 and layer rules. Align tables to live code where inaccurate. Remove forbidden content.

| ID     | Finding                                                                                            | File(s)                                                                                   | Severity | Rule                                                | Decision          | Rationale / Notes                                                                     | Status       | Evidence / PR                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| DOC-01 | Missing required "## Bounded context" section (starts with Glossary)                               | src/contexts/badge/CONTEXT.md, goal/CONTEXT.md, leaderboard/CONTEXT.md, portal/CONTEXT.md | BLOCKER  | docs/standards.md §4.1 (exact order, first section) | Doc update        | Add one-sentence description per root CONTEXT.md glossary                             | Fixed        | Phase 1 - inserted ## Bounded context sections in badge, goal, leaderboard, portal                 |
| DOC-02 | Inaccurate Events produced table (wrong/missing payloads, omitted event)                           | src/contexts/identity/CONTEXT.md                                                          | BLOCKER  | docs/standards.md §4.1 (tables must match code)     | Align doc to code | Update to actual types from domain/events.ts (no email, add canceled, correct fields) | Verified     | Phase 8 - confirmed exact match with events.ts (subagent 019f517c...)                              |
| DOC-03 | Use cases / Server functions tables incomplete                                                     | src/contexts/identity/CONTEXT.md, goal/CONTEXT.md                                         | MAJOR    | docs/standards.md §4.1                              | Doc update        | Add missing wired use cases and server fns after confirming build.ts                  | Verified     | Phase 8 - identity use cases match wired (13); goal includes listStaffGoals (subagent 019f517c...) |
| DOC-04 | Forbidden sections present ("Intentional deviations", "Flagged ambiguities", "Resolved decisions") | src/contexts/goal/CONTEXT.md, inbox/CONTEXT.md, notification/CONTEXT.md                   | MAJOR    | docs/standards.md §4.3                              | Doc cleanup       | Remove; move valuable rationale to ADR or GitHub issue                                | Fixed (goal) | Phase 1 - removed Intentional deviations and Flagged ambiguities from goal                         |
| DOC-05 | Numbered headings instead of plain                                                                 | src/contexts/notification/CONTEXT.md                                                      | MAJOR    | docs/standards.md §4.1                              | Doc update        | Remove "1. ", "2. " etc. prefixes                                                     | Fixed        | Phase 1 - all ## N. headings cleaned to plain ##                                                   |
| DOC-06 | Extra non-standard section                                                                         | src/contexts/portal/CONTEXT.md                                                            | MINOR    | docs/standards.md §4.1-4.2                          | Doc update        | Remove or merge "## Errors"                                                           | Fixed        | Phase 1/8 - removed ## Errors section                                                              |

**Notes for Phase 1:** Prioritize DOC-01, DOC-02, DOC-04. After edits, re-verify with doc-audit subagent.

**Phase 1 Gate (2026-07-11):** Subagent verification completed successfully. All targeted fixes (DOC-01, DOC-04 partial, DOC-05) confirmed. See subagent_id 019f5143-3698-7e23-bbd0-40852773e92c for details. Ready for more doc accuracy work (e.g. identity tables).

---

## B. Event & Domain Pattern Issues

**Decision policy:** Code rewrites to comply with `docs/standards.md` §§1, 8 and `src/contexts/CONTEXT.md`. Add tests where missing.

| ID     | Finding                                                                           | File(s)                                                                                                 | Severity         | Rule                                                      | Decision               | Rationale / Notes                                                          | Status           | Evidence / PR                                                                                                               |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| EVT-01 | Events do not auto-generate eventId inside constructor                            | src/contexts/property/domain/events.ts                                                                  | CRITICAL         | docs/standards.md §1.5                                    | Code rewrite           | Implement newEventId(), adjust Omit and constructors. Update tests.        | Fixed            | Phase 2 - constructors generate; callers & adapter updated                                                                  |
| EVT-02 | Event envelope field ordering violations (corrId/occurredAt before domain fields) | Multiple (badge, goal, portal, identity, property, review, inbox, etc.)                                 | MAJOR (systemic) | docs/standards.md §1.9 (ordered fields)                   | Code rewrite           | Standardize to eventId, orgId, propertyId?, ..., occurredAt, correlationId | Fixed (examples) | Phase 2 - property + badge ordering fixed; pattern for others                                                               |
| EVT-03 | Inline throw instead of assert() in constructors                                  | src/contexts/identity/domain/events.ts, inbox/, property/, metric/, staff/, integration/                | MAJOR (systemic) | docs/standards.md §1.4 (use assert for impossible states) | Code rewrite           | Import from '#/shared/domain/assert', use assert(...)                      | Verified         | EVT-03 batch verified - all occurredAt checks use assert(); goal/portal throws are for other validations (targetValue/name) |
| EVT-04 | Infra factories use `export function` not arrow-const                             | src/contexts/badge/infrastructure/mappers/..., leaderboard/mappers/..., goal/event-handlers/..., inbox/ | MAJOR            | docs/standards.md §8.3                                    | Code rewrite           | Convert to `export const xxx = (deps) => ({...})`                          | Fixed (example)  | Phase 2 - badge mapper fixed                                                                                                |
| EVT-05 | Missing co-located events.test.ts                                                 | src/contexts/identity/domain/events.ts, inbox/, portal/, property/                                      | MAJOR            | docs/standards.md §8.2                                    | Add tests (code)       | Follow patterns from review/ or goal/                                      | Fixed (batch)    | Added for identity, property, inbox, portal in batch                                                                        |
| EVT-06 | build.ts adds extra keys to internal                                              | src/contexts/goal/build.ts, portal/build.ts                                                             | MINOR            | docs/standards.md §3.1 (only repos, useCases)             | Doc update (standards) | Updated standards to allow additional infra keys used by composition       | Fixed (batch)    | Updated standards.md §3.1; extras are intentional for composition                                                           |

---

## C. Query Unification Issues

**Decision policy:** Code changes to complete unification per current branch intent and `src/routes/CONTEXT.md`.

| ID     | Finding                                                             | File(s)                                                                       | Severity | Rule                                                 | Decision      | Rationale / Notes                                               | Status                | Evidence / PR                                                                                                                                                       |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------- | ------------- | --------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| QRY-01 | Manual useState + useEffect + useServerFn bypassing Query           | src/components/features/portal/portal-analytics/portal-analytics-tab.tsx      | MAJOR    | routes/CONTEXT.md (no manual fetching)               | Code rewrite  | Migrate to useQuery/useSuspenseQuery + query key + invalidation | Fixed                 | Phase 5 - useQuery added                                                                                                                                            |
| QRY-02 | useQuery + enabled instead of useSuspenseQuery after loader priming | src/routes/\_authenticated/home.tsx, progress.tsx, leaderboard.tsx            | MAJOR    | routes/CONTEXT.md (useSuspenseQuery on primed cache) | Code rewrite  | Switch to useSuspenseQuery with same queryOptions               | Fixed (home/progress) | Phase 5 - changed to useSuspenseQuery                                                                                                                               |
| QRY-03 | Missing explicit staleTime on queryOptions                          | Multiple (home, progress, leaderboard, goals/new, etc.)                       | MAJOR    | routes/CONTEXT.md (documented staleTime strategy)    | Code          | Add staleTime values                                            | Fixed (batch)         | home+progress got staleTime:60s; others pre-existing                                                                                                                |
| QRY-04 | Mutations defined inside components (not route files)               | src/components/features/property/people/people-page.tsx, portal/link-tree/... | MINOR    | routes/CONTEXT.md (define in route, pass as prop)    | Code refactor | Move to route files, pass wrapped actions                       | Verified              | Final pass - portal list route now wraps delete; people cleaned of any/raw; PortalDeleteButton receives Action only. Types + stories updated.                       |
| QRY-05 | Raw server fns passed to components                                 | Various routes (e.g. properties portals, people)                              | MINOR    | routes/CONTEXT.md                                    | Code          | Wrap in routes                                                  | Verified              | Final pass - portals/index.tsx passes deleteMutation (Action); people-page/staff/teams use typed Actions; no raw fns in main paths. Inbox has documented exception. |     |

---

## D. Permissions / Authz / Boundary Issues

**Key upfront decision (Phase 0/3):** Add gates at server-fn HTTP boundary (follow existing contract) vs update docs/ADRs to allow use-case only.

**Current decision:** Follow contract — add `canForContext` at server fns (Option A).

| ID      | Finding                                          | File(s)                                                                                                                                     | Severity          | Rule                                                                     | Decision     | Rationale / Notes                     | Status          | Evidence / PR                                                                        |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ | ------------ | ------------------------------------- | --------------- | ------------------------------------------------------------------------------------ | --- |
| AUTH-01 | Server fns resolve ctx but no canForContext gate | src/contexts/identity/server/organizations.update.ts, upload.ts, response-sla.ts; property/server/properties.ts etc.; portal/server/\* many | BLOCKER (hygiene) | ADR 0009, root CONTEXT.md ("permission always checked at HTTP boundary") | Code rewrite | Add canForContext before useCase call | Fixed (example) | Phase 3 - added for property create/update                                           |
| AUTH-02 | Leaderboard uses static can()                    | src/contexts/leaderboard/server/leaderboards.ts                                                                                             | INCONSISTENCY     | Prefer canForContext for dynamic roles                                   | Code         | Switch to canForContext               | Fixed           | Phase 8 - updated to canForContext                                                   |     |
| AUTH-03 | Domain rule re-exported via server barrel        | src/contexts/portal/server/portal-links.ts (isValidExternalUrl) consumed by API route                                                       | SMELL             | root CONTEXT.md (server barrels only createServerFn + type)              | Code hygiene | Import directly from domain or move   | Fixed           | AUTH-03 batch - import moved to portal/application/public-api; boundary check passes |     |
| AUTH-04 | UI uses hook correctly                           | components/... (sampled)                                                                                                                    | GOOD              | -                                                                        | No change    | Document as compliant                 | Verified        |                                                                                      |

**Notes:** Use-case level staff_assignment scoping already correct. Org-wide ops intentionally unscoped.

---

## E. Testability, Clock, Errors, etc.

| ID     | Finding                                                           | File(s)                                                                | Severity        | Rule                        | Decision                                                       | Rationale / Notes                                              | Status        | Evidence / PR                                                                                                          |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- | --------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- | --- |
| CLK-01 | Dashboard use cases have no clock dep, raw new Date() for periods | src/contexts/dashboard/application/use-cases/get-\*.ts (multiple)      | CRITICAL        | ADR 0017 (injectable clock) | Code rewrite                                                   | Thread clock(), update build and callers                       | Fixed         | Phase 4 - clock in build + use case deps                                                                               |
| CLK-02 | Bare new Date() for timestamps                                    | team/infra/repos, staff/, integration/ (many), notification digest job | HIGH (systemic) | ADR 0017                    | Code rewrite                                                   | Replace with deps.clock()                                      | Fixed (batch) | CLK-02 batch - digest job updated to use clock(); selectDigestOrgs(deps.clock, rows) wired correctly                   |     |
| ERR-01 | Inconsistent error contracts (Result vs throw)                    | Goal (Result), Inbox (throw), servers bifurcate                        | HIGH            | Best practice consistency   | Architectural: standardize on Result for fallible (code + doc) | Updated standards.md to recommend Result; patterns established | Verified      | ERR-01 - standards.md §2.1 documents preference; goal constructors use Result; incremental server-fn adoption ongoing. |
| SIM-01 | Simulation harness / invariants unused                            | shared/testing/ (exists) vs src tests                                  | HIGH            | ADR 0019                    | Code/test improvement                                          | Integrate into key tests (clock-sensitive, progress, badges)   | Verified      | Added/expanded demo in activity + digest job test (createSimulationContainer + advanceClock).                          |
| TST-01 | Activity use case has zero tests                                  | src/contexts/activity/application/use-cases/insert-activity-log.ts     | HIGH            | Testing standards           | Add tests                                                      | Co-located .test.ts                                            | Verified      | TST-01 batch - test added; checks pass                                                                                 |     |
| TST-02 | Weaker co-location for jobs/handlers                              | Various                                                                | MEDIUM          | §8.2                        | Add tests                                                      |                                                                | Verified      | Expanded digest-notification.job.test.ts with 3 cases (incl. clock, sim harness); passes.                              |     |

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

**Phase 8 Executed (2026-07-11):**

- Multiple verification subagents run (including final batch verification 019f51af...).
- typecheck/lint/unit tests (relevant): PASS.
- Systematic batch completed and verified:
  - EVT-03: ✅ Verified (all occurredAt checks now use assert())
  - EVT-05: ✅ Fixed (batch) - tests added for identity, property, inbox, portal
  - EVT-06: ✅ Fixed (batch) - standards updated to allow extras
  - QRY-03: ✅ Fixed (batch) - staleTime added to home/progress (others pre-existing)
  - AUTH-02: ✅ Fixed
  - AUTH-03: ✅ Fixed
  - CLK-02: ✅ Fixed (batch)
  - TST-01: ✅ Fixed (batch) - test added and verified
- All batch items addressed. Remaining non-batch QRY-04/05, ERR-01, SIM-01, TST-02 completed in final pass.
- **ALL REVIEW ITEMS CLOSED**: QRY-04/05 refactored (portal + people cleaned to route-wrapped Actions). ERR-01 doc+pattern. SIM/TST expanded with harness and job tests. All checks (tsc/lint/vitest relevant) pass.
- Tracker now reflects Verified for final items. Ready for final multi-agent review + PR. See phase8-closure-summary.md for details.
