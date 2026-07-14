# Segment 2 — Shared Infrastructure Findings

## CLEAN CHECKS (all passed)

| Check                                              | Context                | Result                                                               |
| -------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| React imports in shared (excluding usePermissions) | shared/CONTEXT.md rule | Only framework helpers (`createServerFn`, `getRequest`) — acceptable |
| Business logic in shared                           | shared/CONTEXT.md rule | **ZERO** — clean                                                     |
| Cross-context imports into shared                  | shared/CONTEXT.md rule | **ZERO** — clean                                                     |
| Console.log/warn/error in shared                   | Slop check             | **ZERO** — clean                                                     |
| Raw `throw e` without catchUntagged                | Error pattern check    | **ZERO** — clean                                                     |

## S2-1 NIT: `class` usage in shared/domain

**File:** `src/shared/domain/assert.ts:4`
**Category:** pattern-violation
**Tag:** [needs-decision]

**What:** `class UnreachableError extends Error` — the functional style rules state "No class, no this, no enum." This is in the shared domain layer.
**Why it matters:** Inconsistent with the codebase's functional-first stance. However, Error subclassing is required by JavaScript runtime for proper `instanceof` checks, and `shared/auth/server-errors.ts` does the same (`class ServerFunctionError`).
**DOCS SAY:** "No class, no this, no enum. Factory functions returning records of functions."
**CODE DOES:** Two legitimate Error subclasses in shared.
**Fix direction:** Either accept `class Error` as an exception to the functional style rule (Error subclassing is a JS runtime requirement), or document the exception in CONTEXT.md. Recommend: document the exception.
