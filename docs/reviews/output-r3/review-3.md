# Review 3 — Domain Layer Purity (per context)

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Findings

### [MINOR] Domain test file imports `crypto` directly

File: `src/contexts/staff/domain/referral-code.test.ts:1`
Quote:

```
import { randomBytes } from 'crypto'
```

Rule: Domain layer must not import infrastructure packages (`crypto`). Test files are colocated with domain and should use injected randomness.
Fix: Use a seeded/test random generator or inject `randomBytes` as a dependency in the test.

### Checks passed (no issues per context)

- **Infrastructure package imports** (`crypto`, `fs`, `child_process`, `http`, `https`, `drizzle-orm`, `pino`, `bullmq`, `ioredis`, `better-auth`, `@react-router`): None found in domain source files ✅
- **`throw` statements:** None found in any domain file ✅
- **`console.log` / `console.error`:** None found ✅
- **`Date.now()`:** None found — domain receives time via `clock` parameter ✅
- **Cross-context domain imports:** None found ✅

Contexts verified: identity, property, portal, guest, team, staff, integration, review, inbox, metric, goal, dashboard.

## Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 0     |
| MINOR    | 1     |
| NIT      | 0     |

**Most important thing to fix first:** The `crypto` import in `referral-code.test.ts` is a minor purity violation in a test file — low priority.
