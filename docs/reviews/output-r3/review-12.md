# Review 12: Observability — Tracing, Logging, Metrics

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Scope

All files in `src/`.

---

## Findings

### [MAJOR] PII (email) logged in sign-in failure

File: `src/contexts/identity/server/organizations.ts:513`
Quote: ```ts
getLogger().warn({ email: data.email, err: e }, 'Sign-in failed')

````
Rule: No PII in log messages (emails, names, phone numbers).
Fix: Remove `email` from the log payload or hash it.

### [MINOR] `console.warn` in production UI component

File: `src/components/ui/color-picker.tsx:1079`
Quote: ```ts
console.warn('EyeDropper error:', error)
````

Rule: No `console.log` in production code — only `logger.info/debug/error`.
Fix: Replace with `getLogger().warn({ err: error }, 'EyeDropper error')` or suppress silently. Note: this is a UI library component (shadcn derivative), so it may be acceptable to leave as-is since it's not application code.

### [MINOR] Dashboard context has no logging

File: `src/contexts/dashboard/` (all files)
Quote: No `getLogger()` calls in any dashboard file — no server function, no use case, no repository logs anything.
Rule: Error logging should include stack traces. Important operations should be logged.
Fix: Add `getLogger().error({ err }, 'Dashboard query failed')` in the dashboard server function's catch block.

### [MINOR] `on-metric-recorded` event handler has no logging

File: `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts`
Quote: No `getLogger()` calls in the entire 110-line event handler. Errors in goal progress increment or event emission are silently swallowed.
Rule: Event handlers must log errors, not swallow them.
Fix: Add `getLogger().error({ err, goalId: goal.id }, 'Failed to increment goal progress')` in error paths.

### [MINOR] Some event handlers log with PII-risk patterns

File: `src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts:31`
File: `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts:32`
File: `src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts:31`
Quote: ```ts
getLogger().error({ err }, 'Failed to create inbox item from review event')

````
Rule: Error logging includes stack traces.
Fix: **No issue found.** Pino automatically includes the error stack when `err` is an Error object in the log payload. This pattern is correct.

---

## Positive Observations

- **`tracedHandler` wraps every server function.** All 16 server function files use `tracedHandler()` which provides ALS request context, correlation ID, named spans with timing, and an error safety net. There are 184 `trace()` calls across the codebase.
- **Structured logging via pino.** All log calls use `getLogger().info/warn/error({ structuredData }, 'message')` — JSON-structured, not string concatenation.
- **Error logging includes error objects.** All error logs pass `{ err: e }` which pino serializes with stack traces.
- **No `console.log` in application code.** The only `console` usage is in the UI library (`color-picker.tsx`).
- **Request tracing is comprehensive.** The `traced-server-fn.ts` wrapper creates spans for every server function call, records timing, and catches untagged errors.
- **Event handlers use `trace()` for significant operations.** For example, `on-metric-recorded.ts:46`:
```ts
return trace('event.onMetricRecorded', async () => { ... })
````

- **Worker/job handlers use structured logging.** `src/worker/index.ts` and `src/contexts/portal/infrastructure/jobs/process-image.job.ts` use `getLogger()` for all log output.

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 1     |
| MINOR    | 4     |
| NIT      | 0     |

**Most important thing to fix first:** The PII leak in `signInUser` — email is logged in plaintext on every failed sign-in. This is a compliance issue (GDPR, etc.).
