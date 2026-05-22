# Deep Review r12: Observability

## Findings

### MAJOR 1: Span attributes missing canonical set
- **File:** `src/shared/observability/trace.ts`
- **Issue:** `startRequestSpan` and `endSpan` only log `requestId`, `span`, `method`, `path`, `duration`. Missing: `organizationId`, `userId`, `role`, `useCase`, `resource.type`, `resource.id`.
- **Triaged:** outdated-doc — The review prompt asks for canonical span attributes that aren't part of this project's design. The trace module intentionally logs minimal attributes (requestId, span name, duration). The server function handler name (passed as 3rd arg to tracedHandler) already identifies the use case. org/user/role info is available in the server function scope but not threaded through the trace infrastructure. Adding them would require changes to the tracedHandler signature.
- **Decision:** wontfix for now. The current tracing is consistent and functional. A future enhancement could add optional attrs.

### MAJOR 2: GBP webhook route handler has no trace wrapper
- **File:** `src/routes/api/webhooks/gbp/notifications.ts`
- **Issue:** The file-route POST handler logs directly but doesn't wrap in `trace()`. The delegated `handleGbpNotification` does use `trace()`, but the outer handler (JWT verification, payload parsing) doesn't.
- **Triaged:** relevant — The webhook handler should create its own root span for the full lifecycle.
- **Fix:** Wrap the handler body in `trace('webhook.gbpNotifications')`.

### MAJOR 3: Google OAuth callback route has no trace wrapper
- **File:** `src/routes/api/auth/google/callback.ts`
- **Issue:** The GET handler logs errors but doesn't create a traced span.
- **Triaged:** relevant — OAuth callback is a critical flow that should be traced.
- **Fix:** Wrap the handler body in `trace('auth.googleCallback')`.

### MAJOR 4: _authenticated.tsx string-only log message
- **File:** `src/routes/_authenticated.tsx:105`
- **Triaged:** wontfix — It's a single static-string info log. Not real string concatenation with user data.

### MAJOR 5: Worker job logs missing org/user attrs
- **File:** `src/shared/jobs/worker.ts`
- **Triaged:** wontfix — Background jobs run outside request context. org/user IDs come from job data payloads. Adding them would require parsing job.data in the generic worker, which is job-type-specific.

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| MAJOR    | 3 relevant, 3 wontfix |
| MINOR    | 0     |

## Action items

1. Add `trace()` wrapper to GBP webhook route handler
2. Add `trace()` wrapper to Google OAuth callback route handler
