# Review 13: Error Handling & Result Types

**Reviewer:** Automated architecture review
**Date:** 2026-05-23
**Branch:** feat/phase-15c-goal-ui

## Findings

### [MAJOR] Goal server functions use `switch` instead of exhaustive `match().exhaustive()` on error codes

File: src/contexts/goal/server/goals.ts:90-105
Quote:

```
switch (error.tag) {
  case 'construction_error':
    throwContextError(...)
    break
  case 'instance_construction_error':
    throwContextError(...)
    break
}
```

Rule: CONTEXT.md server function pattern requires `match().exhaustive()` for error dispatch. Using `switch` without a `default` means new error variants are silently swallowed instead of caught at compile time.
Fix: Replace `switch` with `match(error.tag).with('construction_error', ...).with('instance_construction_error', ...).exhaustive()`.

### [MAJOR] Goal `updateGoal` and `cancelGoal` server functions use non-exhaustive `switch` on error tags

File: src/contexts/goal/server/goals.ts:150-175, 218-233
Quote:

```
switch (error.tag) {
  case 'goal_not_found':
    ...
    break
  case 'goal_not_active':
    ...
    break
  case 'recurrence_rule_not_allowed':
    ...
    break
}
```

Rule: CONTEXT.md server function pattern requires `match().exhaustive()`. New error tags from `updateGoal`/`cancelGoal` use cases would be silently ignored.
Fix: Replace with `match(error.tag).with(...).exhaustive()`.

### [MAJOR] `auth-settings.ts` server functions catch all errors as generic `AuthError` without distinguishing error types

File: src/contexts/identity/server/auth-settings.ts:48-56, 85-93, 119-127, 160-168
Quote:

```
} catch (e) {
  handleAuthError(
    e,
    'AuthError',
    'password_change_failed',
    'Failed to change password. Please check your current password.',
    400,
  )
}
```

Rule: CONTEXT.md error pattern requires server functions to pattern-match on `_tag`/`code` and throw with HTTP-appropriate status. All errors are caught uniformly and mapped to 400, losing distinction between auth errors (401), not found (404), and validation errors (400).
Fix: Parse the better-auth error to distinguish error types before calling `handleAuthError`. At minimum, check for status codes from the better-auth API response.

### [MINOR] `staff-goals.ts` server function has no catch handler at all

File: src/contexts/goal/server/staff-goals.ts:19-40
Quote:

```
export const listStaffGoals = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = headersFromContext()
      const ctx = await resolveTenantContext(headers)
      ...
      return { goals: [] as GoalWithProgress[] }
    },
    ...
  ),
)
```

Rule: CONTEXT.md server function pattern requires error handling via `catchUntagged` or type-guard catches. Currently stubbed but missing any error boundary.
Fix: Add a `try/catch` block with `catchUntagged(e)` or a proper error handler. The stub nature doesn't excuse skipping the error boundary.

### [MINOR] `catch (e) {}` empty catch block in composition.ts `setActiveOrg`

File: src/composition.ts:109-114
Quote:

```
} catch (e) {
  // If headers don't carry a valid session (e.g., during registration
  // where cookies aren't yet available), this is non-fatal — the user
  // will set their active org on first login.
  logger.warn({ err: e, orgId }, 'Failed to set active organization during setup')
}
```

Rule: Empty catch blocks swallow errors. This catch does log, so it's not truly empty, but it silently swallows errors that could indicate a real problem during org setup.
Fix: This is acceptable as-is since it logs the error. The comment explains the rationale. No action required — noting for completeness.

### [MINOR] `as unknown as` in production code (portal.repository.ts)

File: src/contexts/portal/infrastructure/repositories/portal.repository.ts:157
Quote:

```
const rows = result.rows as unknown as ReadonlyArray<{
  portal_slug: string
  property_slug: string
}>
```

Rule: Architecture guidelines discourage `as unknown as` force-casts. This one is justified (Drizzle raw SQL return type) and has a comment explaining why.
Fix: Acceptable — the comment documents the rationale. Consider extracting a helper function that validates the row shape at runtime.

### [NIT] ~50 occurrences of `as unknown as` in test files

Used primarily for:

- Mocking Redis/Job/Repository interfaces in tests (`as unknown as Redis`, `as unknown as ReplyRepository`)
- Error assertion inspection (`as unknown as Record<string, unknown>`)
- Branded ID conversion in test inputs (`'nonexistent' as unknown as TeamId`)

These are acceptable in test code. Not enumerated individually per NIT grouping rules.

## Summary

| Severity | Count       |
| -------- | ----------- |
| BLOCKER  | 0           |
| MAJOR    | 3           |
| MINOR    | 3           |
| NIT      | 1 (grouped) |

**Most important thing to fix first:** Replace the `switch` statements in `src/contexts/goal/server/goals.ts` with `match().exhaustive()` to catch new error variants at compile time. This is the most impactful fix because the goal use cases are actively being developed (Phase 15C) and new error tags are likely to be added.
