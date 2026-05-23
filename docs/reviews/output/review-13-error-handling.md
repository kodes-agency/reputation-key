# Review #13: Error Handling & Result Types

**Date:** 2026-05-23
**Scope:** `src/` — all layers across contexts and shared

---

## Findings

### BLOCKER

[B1] `throw new Error(...)` in domain layer — `progress-strategy.ts`
File: src/contexts/goal/domain/progress-strategy.ts:70
Quote:

```
throw new Error('buildProgressQueryForInstance only applies to recurring goals')
```

Rule: Domain layer must never throw. Domain functions return `Result<T, DomainError>`.
Fix: Return `Result<ProgressQuery, ProgressQueryError>` using the already-defined `ProgressQueryError` union type. The `ProgressQueryError` type exists in the same file but is unused.

[B2] `throw new Error(...)` in domain layer — `progress-strategy.ts`
File: src/contexts/goal/domain/progress-strategy.ts:115
Quote:

```
throw new Error(
  'Cannot build progress query for recurring template without instance period. ' +
  'Use buildProgressQueryForInstance() with explicit dates.',
)
```

Rule: Domain layer must never throw. Domain functions return `Result<T, DomainError>`.
Fix: Return `Err<ProgressQueryError>` with a `{ tag: 'recurring_template_without_instance_period' }` variant (already defined but unused).

[B3] `GbpApiError` stores HTTP status code in domain layer
File: src/contexts/integration/domain/gbp-api-error.ts:8
Quote:

```
export type GbpApiError = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  status: number    // ← HTTP status from GBP API
  body: string
  message: string
}>
```

Rule: HTTP status codes must not leak into domain layer.
Fix: Replace `status: number` with a domain-meaningful classification (e.g., `retryable: boolean` or a tagged union like `'rate_limited' | 'server_error' | 'client_error'`). The adapter in infrastructure should map the HTTP status to this domain concept.

[B4] API route catches all errors and returns 404, masking real failures
File: src/routes/api/public/click/$linkId.ts:31
Quote:

```
} catch (e) {
  logger.error({ err: e, linkId: params.linkId }, '[handler] /api/public/click/:linkId')
  return new Response('Link not found', { status: 404 }) as Response
}
```

Rule: Bare catch that maps every error to the same response. DB errors, null pointers, etc. all surface as 404, hiding real issues.
Fix: Distinguish `GuestError`/`PortalError` (typed) from unexpected errors. Return 500 for untyped errors instead of masking them as 404.

---

### MAJOR

[M1] `DuplicateKeyError` defined in application port file instead of domain
File: src/contexts/integration/application/ports/property-import-repo.port.ts:6
Quote:

```
export type DuplicateKeyError = Readonly<{
  _tag: 'DuplicateKeyError'
  code: 'duplicate_key'
  message: string
}>
```

Rule: Domain error types should live in `domain/errors.ts`. Application layer defines ports, not error types. This error also does not follow the context's `IntegrationError` pattern — it uses a separate `_tag` value, breaking instanceof discrimination via the context's `isIntegrationError` guard.
Fix: Move `DuplicateKeyError` to `integration/domain/errors.ts` as an error code under `IntegrationError` (e.g., `code: 'duplicate_key'`), or keep as a distinct domain error in `domain/`.

[M2] Inconsistent error envelope at webhook route boundary
File: src/routes/api/webhooks/gbp/notifications.ts:27-33
Quote:

```
return Response.json(
  { error: 'Unauthorized', message: 'Missing or invalid Authorization header' },
  { status: 401 },
)
```

Rule: The server function pattern uses `{ code, message, details? }` via `ServerFunctionError`. This webhook route uses `{ error, message }` — a different shape.
Fix: Standardize webhook error responses to `{ code: string, message: string }` to match the server function envelope, or document the exemption for webhook routes.

[M3] `throw new Error(...)` in infrastructure repositories — untyped errors at the application boundary
File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:28
Quote:

```
throw new Error('Goal insert failed — no row returned')
```

Rule: Infrastructure should catch library errors and translate to tagged errors. Plain `Error` objects propagate as untyped to the server function catch, which `tracedHandler` will wrap as a generic 500 — losing context.
Fix: Throw a typed `GoalError` (or a shared infrastructure error like `RepositoryError` with context). The same pattern repeats at lines 109, 230, 252, 276, 296 of this file.

[M4] Same untyped repository errors in inbox context
File: src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:164
Quote:

```
throw new Error('Inbox item insert failed — no row returned')
```

Rule: Same as M3. Also at line 189 (`Inbox item status update failed`).
Fix: Throw typed `InboxError` instead.

[M5] Same untyped repository errors in inbox-note repository
File: src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts:40
Quote:

```
throw new Error('Inbox note insert failed — no row returned')
```

Rule: Same as M3.
Fix: Throw typed `InboxError` instead.

[M6] `throw new Error(...)` in infrastructure mapper
File: src/contexts/goal/infrastructure/mappers/goal.mapper.ts:54
Quote:

```
throw new Error(`Invalid ${label}: ${value}`)
```

Rule: Mappers are pure functions in infrastructure. Throwing untyped errors from `assertLiteral` means a corrupt DB row becomes an untyped 500 instead of a meaningful domain error.
Fix: Return `Result<T, GoalError>` from the mapper, or throw a typed `GoalError` with `code: 'validation_error'`.

[M7] `throw new Error(...)` in build.ts composition root — untyped queue fallback
File: src/contexts/review/build.ts:70
Quote:

```
throw new Error('Job queue not available — Redis not configured')
```

Rule: The build/composition layer should produce typed errors. This plain Error is thrown at the use-case level and will surface as a generic 500.
Fix: Throw a typed `ReviewError` with an appropriate code (e.g., `'queue_unavailable'`), or return a Result from the queue port so the use case can handle it.

[M8] `IntegrationError` has extra `recoverable` field not present in other error types
File: src/contexts/integration/domain/errors.ts:23
Quote:

```
export type IntegrationError = Readonly<{
  _tag: 'IntegrationError'
  code: IntegrationErrorCode
  message: string
  recoverable: boolean
  context?: Readonly<Record<string, unknown>>
}>
```

Rule: Inconsistent error shape. All other contexts use `{ _tag, code, message, context? }`. Only `IntegrationError` adds `recoverable: boolean`. This breaks the uniform `TaggedError` contract from `shared/domain/errors.ts`.
Fix: Either add `recoverable` to the base `TaggedError` type in shared, or encode retryability in the error code (e.g., `'gbp_api_rate_limited'` is retryable, `'oauth_denied'` is not). The code already has distinct codes for these cases.

---

### MINOR

[m1] `GbpApiError` does not follow `TaggedError` base shape
File: src/contexts/integration/domain/gbp-api-error.ts:5
Quote:

```
export type GbpApiError = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  status: number
  body: string
  message: string
}>
```

Rule: All domain errors should follow `{ _tag, code, message, context? }`. This type has `operation`, `status`, `body` instead of `code`.
Fix: Align with the `TaggedError` shape. Keep domain-relevant fields in `context`.

[m2] `GoalError` uses manual factory instead of `createErrorFactory` from shared
File: src/contexts/goal/domain/errors.ts:19
Quote:

```
export const goalError = (
  code: GoalErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): GoalError => ({
  _tag: 'GoalError',
  code,
  message,
  ...(context ? { context } : {}),
})
```

Rule: Inconsistent — `ReviewError`, `InboxError`, `DashboardError` use `createErrorFactory` from `shared/domain/errors.ts`, while `GoalError`, `StaffError`, `PropertyError`, `PortalError`, `GuestError`, `IdentityError`, `TeamError`, `MetricError` use hand-rolled factories.
Fix: Use `createErrorFactory('GoalError')` for consistency. Same applies to all hand-rolled factories listed above.

[m3] `isMetricError` uses `'_tag' in e` check while most others don't
File: src/contexts/metric/domain/errors.ts:28
Quote:

```
typeof e === 'object' &&
e !== null &&
'_tag' in e &&
(e as { _tag: string })._tag === 'MetricError'
```

Rule: Inconsistent type guard style. Most contexts use `(e as { _tag?: string })._tag === 'XxxError'` without `'_tag' in e`.
Fix: Use the same guard pattern as other contexts for consistency. The `'_tag' in e` is actually safer but should be standardized.

[m4] `throw new Error(...)` in portal image processing job
File: src/contexts/portal/infrastructure/jobs/process-image.job.ts:38
Quote:

```
throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
```

Rule: Infrastructure jobs should throw typed errors. The `${response.status}` also embeds HTTP status in the error message.
Fix: Throw a typed `PortalError` with `code: 'upload_failed'`.

---

### NIT

[N1] Client-side catch blocks in React components silently set error state without logging
Files: Multiple components in `src/components/features/guest/public-portal/`
Example: `feedback-form.tsx:60`, `star-rating.tsx:35`
Quote:

```
} catch (e) {
  const message = e && typeof e === 'object' && 'message' in e
    ? String(e.message)
    : 'Failed to submit feedback'
```

Rule: Style preference — client-side catches in React UI components are acceptable for user-facing error display, but could benefit from `console.error` or logger call for debugging.

[N2] `composition.ts:104` catch block silently swallows `setActiveOrg` failures
File: src/composition.ts:104
Quote:

```
} catch (e) {
  logger.warn({ err: e, orgId }, 'Failed to set active organization during setup')
}
```

Rule: This is correctly documented as non-fatal. The catch logs and continues — acceptable pattern with the existing comment explaining the rationale.

---

## Error Type Catalogue

### Domain Layer (`domain/errors.ts`)

| Context     | \_tag              | Factory              | Error Codes                                                                                                                                                                                                                                                                |
| ----------- | ------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `IdentityError`    | Hand-rolled          | `forbidden`, `invalid_slug`, `invalid_name`, `validation_error`, `member_not_found`, `invitation_not_found`, `registration_failed`, `org_setup_failed`                                                                                                                     |
| Property    | `PropertyError`    | Hand-rolled          | `forbidden`, `invalid_slug`, `invalid_name`, `invalid_timezone`, `slug_taken`, `property_not_found`                                                                                                                                                                        |
| Portal      | `PortalError`      | Hand-rolled          | `forbidden`, `invalid_slug`, `invalid_name`, `invalid_description`, `invalid_theme`, `invalid_threshold`, `invalid_url`, `invalid_label`, `invalid_title`, `slug_taken`, `portal_not_found`, `category_not_found`, `link_not_found`, `property_not_found`, `upload_failed` |
| Guest       | `GuestError`       | Hand-rolled          | `invalid_rating`, `duplicate_rating`, `feedback_too_long`, `feedback_empty`, `portal_not_found`, `portal_inactive`, `rate_limit_exceeded`, `invalid_source`, `invalid_session`                                                                                             |
| Team        | `TeamError`        | Hand-rolled          | `forbidden`, `invalid_name`, `name_taken`, `team_not_found`, `property_not_found`                                                                                                                                                                                          |
| Staff       | `StaffError`       | Hand-rolled          | `forbidden`, `invalid_input`, `assignment_not_found`, `already_assigned`, `property_not_found`, `team_not_found`, `referral_code_collision`                                                                                                                                |
| Integration | `IntegrationError` | Hand-rolled          | `forbidden`, `connection_not_found`, `connection_inactive`, `connection_disconnected`, `oauth_failed`, `oauth_denied`, `token_refresh_failed`, `gbp_api_error`, `gbp_api_rate_limited`, `import_not_found`, `invalid_visibility`, `encryption_error`                       |
| Integration | `GbpApiError`      | Hand-rolled          | _(uses `operation`, `status`, `body` instead of `code`)_                                                                                                                                                                                                                   |
| Review      | `ReviewError`      | `createErrorFactory` | `unauthorized`, `property_not_found`, `connection_not_found`, `connection_inactive`, `sync_failed`, `invalid_rating`, `invalid_reply`, `review_not_found`, `reply_not_found`, `reply_already_exists`, `invalid_transition`, `reply_publish_failed`                         |
| Inbox       | `InboxError`       | `createErrorFactory` | `invalid_transition`, `invalid_input`, `forbidden`, `not_found`, `assignment_not_allowed`, `already_exists`, `bulk_partial_failure`                                                                                                                                        |
| Metric      | `MetricError`      | Hand-rolled          | `unknown_metric_key`                                                                                                                                                                                                                                                       |
| Dashboard   | `DashboardError`   | `createErrorFactory` | `forbidden`, `not_found`, `invalid_input`                                                                                                                                                                                                                                  |
| Goal        | `GoalError`        | Hand-rolled          | `forbidden`, `not_found`, `validation_error`, `immutable_goal`                                                                                                                                                                                                             |

### Application Layer

| Location                                                     | \_tag               | Note                                                                                   |
| ------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| `integration/application/ports/property-import-repo.port.ts` | `DuplicateKeyError` | Error type defined in application port file, not domain. Uses `code: 'duplicate_key'`. |

### Shared Layer

| Location                       | Type                     | Note                                                                    |
| ------------------------------ | ------------------------ | ----------------------------------------------------------------------- |
| `shared/domain/errors.ts`      | `TaggedError<Tag, Code>` | Base type + `createErrorFactory`                                        |
| `shared/auth/server-errors.ts` | `ServerFunctionError`    | Thrown by server functions with `.name`, `.message`, `.code`, `.status` |

### Layers with Untyped `throw new Error(...)` (non-test, non-client)

| Layer                             | Files                                                        | Count                                |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| **Domain**                        | `goal/domain/progress-strategy.ts`                           | 2 throws — **BLOCKER**               |
| **Infrastructure / Repositories** | `goal/infrastructure/repositories/goal.repository.ts`        | 6 throws                             |
| **Infrastructure / Repositories** | `inbox/infrastructure/repositories/inbox.repository.ts`      | 2 throws                             |
| **Infrastructure / Repositories** | `inbox/infrastructure/repositories/inbox-note.repository.ts` | 1 throw                              |
| **Infrastructure / Mappers**      | `goal/infrastructure/mappers/goal.mapper.ts`                 | 1 throw                              |
| **Infrastructure / Jobs**         | `portal/infrastructure/jobs/process-image.job.ts`            | 1 throw                              |
| **Composition / Build**           | `review/build.ts`                                            | 2 throws                             |
| **Shared**                        | `shared/domain/roles.ts`, `shared/domain/permissions.ts`     | 2 throws (startup-time — acceptable) |

---

## Summary

The codebase follows a solid tagged-error architecture: each context defines its own `XxxError` type with a closed union of error codes, smart constructors, and type guards. Server functions consistently use `throwContextError` to map tagged errors to HTTP statuses, and `tracedHandler` provides a safety net via `catchUntagged` for untyped errors. However, two **blocker** violations exist in `goal/domain/progress-strategy.ts`, where the domain layer throws plain `Error` instead of returning `Result`. The `GbpApiError` type leaks HTTP status codes into the domain layer. At the infrastructure layer, eight `throw new Error(...)` sites across repositories, mappers, and jobs produce untyped errors that lose diagnostic context by the time they reach the server boundary. Two structural issues stand out: `DuplicateKeyError` lives in an application port file rather than domain, and `IntegrationError` adds a non-standard `recoverable` field that breaks the uniform `TaggedError` contract. The error factory pattern is inconsistent — only 3 of 13 contexts use `createErrorFactory` from shared. None of the findings suggest leaked secrets or collapsed validation/authorization errors. The event bus correctly swallows handler errors with logging, and client-side catches in React components appropriately display user-facing error states.
