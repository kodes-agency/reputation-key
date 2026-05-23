# Review 15: Tests

**Reviewer:** Automated architecture review
**Date:** 2026-05-23
**Branch:** feat/phase-15c-goal-ui

## Findings

### [MAJOR] Missing test files for 4 use cases

- `src/contexts/portal/application/use-cases/list-portal-links.ts` — no corresponding `list-portal-links.test.ts`
- `src/contexts/guest/application/use-cases/get-public-portal.ts` — no corresponding `get-public-portal.test.ts`
- `src/contexts/guest/application/use-cases/resolve-portal-context.ts` — no corresponding `resolve-portal-context.test.ts`
- `src/contexts/guest/application/use-cases/resolve-link-and-track.ts` — no corresponding `resolve-link-and-track.test.ts`

Rule: CONTEXT.md requires "Every use case tested for happy + error paths." The `integration/application/use-cases/index.ts` barrel is excluded — it re-exports only.
Fix: Add test files for each listed use case covering happy path and error cases.

### [MAJOR] `reply-operations.test.ts` uses `vi.fn()` mocks instead of in-memory fakes

File: src/contexts/review/application/use-cases/reply-operations.test.ts:83-97
Quote:

```
upsert: vi.fn(async (r: Reply) => r),
findById: vi.fn(async () => null),
findInternalByReviewId: vi.fn(async () => null),
deleteById: vi.fn(async () => {}),
...
emit: vi.fn(async () => {}),
on: vi.fn(),
```

Rule: CONTEXT.md requires "tests use in-memory fakes from `src/shared/testing/`, not mocks." This test creates partial mock objects inline with `vi.fn()` instead of using in-memory repository fakes.
Fix: Create an `in-memory-reply-repo.ts` and `in-memory-review-repo.ts` in `src/shared/testing/`, or at minimum extract the mock setup into shared test helpers. The current approach duplicates mock setup across 15+ test cases in this file.

### [MAJOR] `on-reply-published.test.ts` (inbox) uses `vi.fn()` mocks instead of in-memory fakes

File: src/contexts/inbox/infrastructure/event-handlers/on-reply-published.test.ts:61-62,80-81
Quote:

```
findBySource: vi.fn(async () => item),
updateStatus: vi.fn(async () => {}),
```

Rule: Same as above — in-memory fakes preferred over mocks.
Fix: Use `in-memory-inbox-repo.ts` from `src/shared/testing/` which already exists.

### [MINOR] Some tests use `as unknown as` for branded ID construction instead of branded constructors

File: src/contexts/team/application/use-cases/get-team.test.ts:71
Quote:

```
{ teamId: 'nonexistent' as unknown as import('#/shared/domain/ids').TeamId },
```

File: src/contexts/portal/application/use-cases/get-portal.test.ts:38
Quote:

```
const ctx = buildTestAuthContext({ organizationId: 'org-00000000-0000-0000-0000-000000000002' as unknown as import('#/shared/domain/ids').OrganizationId })
```

Rule: Tests should use the branded ID constructors from `#/shared/domain/ids` (e.g., `teamId('nonexistent')`).
Fix: Replace `as unknown as TeamId` with `teamId('nonexistent')` using the imported constructor.

### [MINOR] `on-reply-published.test.ts` uses `as unknown as InboxRepository` extensively

File: src/contexts/inbox/infrastructure/event-handlers/on-reply-published.test.ts:63,82,94,106,119
Quote:

```
} as unknown as InboxRepository
```

Rule: Tests should use proper in-memory fakes that fully implement the port interface, not partial objects force-cast.
Fix: Use the existing `in-memory-inbox-repo.ts` from `src/shared/testing/`.

### [NIT] Test files are colocated with source ✓

### [NIT] Test naming follows `<module>.test.ts` convention ✓

### [NIT] No tests depend on external services (DB, Redis, network) in unit tests ✓

### [NIT] `capturing-event-bus.ts` in `src/shared/testing/` is widely used for event assertion ✓

### [NIT] Shared testing fixtures (`buildTestAuthContext`) used consistently ✓

## Test Coverage Summary

| Context     | Use Cases | Tests | Coverage                |
| ----------- | --------- | ----- | ----------------------- |
| Goal        | 5         | 5     | 100%                    |
| Guest       | 8         | 5     | 63% (3 missing)         |
| Identity    | 12        | 10    | 83%                     |
| Inbox       | 9         | 9     | 100%                    |
| Integration | 11        | 10    | 91% (index.ts excluded) |
| Metric      | 1         | 1     | 100%                    |
| Portal      | 17        | 16    | 94% (1 missing)         |
| Property    | 5         | 5     | 100%                    |
| Review      | 2         | 2     | 100%                    |
| Staff       | 4         | 4     | 100%                    |
| Team        | 5         | 5     | 100%                    |
| Dashboard   | 1         | 1     | 100%                    |

## Summary

| Severity | Count       |
| -------- | ----------- |
| BLOCKER  | 0           |
| MAJOR    | 3           |
| MINOR    | 2           |
| NIT      | 5 (grouped) |

**Most important thing to fix first:** Add the 4 missing use case test files. `list-portal-links`, `get-public-portal`, `resolve-portal-context`, and `resolve-link-and-track` all lack tests. Guest context is at 63% use case coverage.
