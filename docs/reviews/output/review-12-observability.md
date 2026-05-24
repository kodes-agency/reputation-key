# Review #12 — Observability: Tracing, Logging, Metrics

**Date:** 2025-05-23
**Reviewer:** Automated audit
**Scope:** `src/` — server functions, background jobs, external API adapters, event handlers, repositories, worker

---

## Findings

### BLOCKER

#### [BLOCKER] PII leaked in email logs — recipient address logged in plain text

**File:** `src/shared/auth/emails.ts:57`
**Quote:**

```ts
logger.error({ error, to }, `Failed to send email: ${subject}`)
```

**Rule:** No PII/secrets in logs — email addresses are PII.
**Fix:** Remove `to` from the structured fields. If needed for debugging, log a hashed or truncated identifier (e.g. `toPrefix: to.slice(0, 3) + '***'`).

#### [BLOCKER] PII leaked in email logs — recipient address on successful send

**File:** `src/shared/auth/emails.ts:64`
**Quote:**

```ts
logger.info({ to, subject }, 'Email sent')
```

**Rule:** No PII/secrets in logs — email addresses are PII.
**Fix:** Remove `to` from the structured fields. Use a non-PII correlation key or omit entirely.

---

### MAJOR

#### [MAJOR] All 3 external Google API adapters lack trace spans on fetch calls

**File:** `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts` (lines 27, 64, 95, 127)
**File:** `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts` (lines 23, 58, 83, 104)
**File:** `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts` (lines 121, 160)
**Quote:** (representative — google-oauth.adapter.ts:27)

```ts
const response = await fetch(GOOGLE_TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ... }),
})
```

**Rule:** New external call (GBP, DB, OAuth refresh) must be wrapped in span.
**Fix:** Wrap each `fetch` call in `trace('googleOAuth.exchangeCode', async () => ...)`, etc. Add attributes for `organizationId`, `operation`, and `peer.service`. None of the 7 adapter files import `trace` at all.

#### [MAJOR] S3 storage adapter lacks trace spans on AWS SDK calls

**File:** `src/contexts/portal/infrastructure/adapters/s3-storage.adapter.ts` (lines 59, 67, 72, 80)
**Quote:**

```ts
const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 })
```

**Rule:** New external call must be wrapped in span.
**Fix:** Wrap each S3 operation (`getSignedUrl`, `HeadObjectCommand`, `DeleteObjectCommand`, `PutObjectCommand`) in `trace('s3.createPresignedUploadUrl', ...)`, etc.

#### [MAJOR] All 9 background job handlers lack root trace spans

**Files:**

- `src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts`
- `src/contexts/review/infrastructure/jobs/publish-reply.job.ts`
- `src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.ts`
- `src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.ts`
- `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts`
- `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts`
- `src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts`
- `src/contexts/portal/infrastructure/jobs/process-image.job.ts`
- `src/contexts/integration/infrastructure/jobs/import-property.job.ts`

**Quote:** (representative — sync-property-reviews.job.ts:40)

```ts
return async (job: Job<SyncPropertyReviewsJobData>) => {
  const logger = getLogger()
  logger.info({ jobId: job.id, propertyId: job.data.propertyId }, 'Syncing property reviews')
```

**Rule:** Background job / Pub/Sub handler must create root span, link to originating event id.
**Fix:** Wrap the entire handler body in `trace('job.syncPropertyReviews', async () => ...)` with canonical attributes `{ organizationId, jobId, resource.type: 'property', resource.id }`. The import-property handler also has zero logging at all — no `getLogger()` call.

#### [MAJOR] Event handlers lack trace spans

**File:** `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts` (line 96+)
**File:** `src/contexts/inbox/infrastructure/event-handlers/index.ts` (line 19+)
**Quote:** (on-metric-recorded.ts:96)

```ts
const { goalRepo, eventBus, clock } = deps
```

**Rule:** Background job / Pub/Sub handler must create root span.
**Fix:** Wrap each event handler callback body in `trace('event.onMetricRecorded', ...)` with attributes `{ organizationId, eventType: 'metric.recorded', eventId }`.

#### [MAJOR] Worker entry point uses string concatenation in logger calls

**File:** `src/worker/index.ts:120`
**Quote:**

```ts
.then(() => logger.info(`${jobName} job scheduled (${label})`))
```

**Rule:** Logger called with string concatenation instead of structured fields.
**Fix:** Replace with `logger.info({ jobName, label }, 'Job scheduled')`. Same pattern at line 122 (warn) and line 139 (info).

#### [MAJOR] Span attributes missing canonical set across all server functions

**File:** `src/shared/observability/traced-server-fn.ts:32`
**Quote:**

```ts
const span = startRequestSpan(requestId, method, name ?? 'serverFn')
```

**Rule:** Span attributes missing canonical set: organizationId, userId, role, useCase, resource.type, resource.id.
**Fix:** `startRequestSpan` only records `requestId`, `method`, `path`/`name`. After auth context is resolved, attach `organizationId`, `userId`, `role` to the span. This requires either passing the auth context into `tracedHandler` or enriching the span mid-flight via the request context.

#### [MAJOR] Auth identity adapter has no trace spans on better-auth API calls

**File:** `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts` (lines 67, 84, 97, 116, 137, 141, 146, 169, 199, 210, 219, 239)
**Quote:**

```ts
const result = await auth.api.signUpEmail({ body: { name, email, password } })
```

**Rule:** New external call must be wrapped in span.
**Fix:** Wrap each `auth.api.*` call in `trace('identity.signUp', ...)` etc. These are network calls to better-auth's internal API and should be traced.

---

### MINOR

#### [MINOR] Worker scheduling logs lack stable greppable prefix

**File:** `src/worker/index.ts:45`
**Quote:**

```ts
logger.info('BullMQ worker started, processing jobs from default queue')
```

**Rule:** Log messages should have stable, greppable prefix or event name.
**Fix:** Use a structured format like `logger.info({ event: 'worker.started' }, 'Worker started')`. This applies to lines 45, 59, 76, 92, 145, 154, 162 as well — they all use free-form strings.

#### [MINOR] import-property.job.ts has zero logging

**File:** `src/contexts/integration/infrastructure/jobs/import-property.job.ts`
**Quote:**

```ts
return async (job: Job<ImportPropertyJobData>) => {
  const { jobId, organizationId, connectionId, locations } = job.data
  await deps.importPropertyUseCase({ ... })
}
```

**Rule:** Background job should log on failure (and at least info on start).
**Fix:** Add `getLogger()` and log at handler entry and on error. Consider wrapping the use case call in try/catch with error logging.

---

## Coverage Table

| Code path                                 | Has span?               | Attrs complete?                         | Log on failure?                           |
| ----------------------------------------- | ----------------------- | --------------------------------------- | ----------------------------------------- |
| Server functions (16 files, ~50 handlers) | ✅ `tracedHandler`      | ❌ — no orgId/userId/role               | ✅ via `catchUntagged`                    |
| Repositories (18 infra files)             | ✅ `trace()` per method | ⚠️ — span name only, no canonical attrs | ✅ re-throws                              |
| Google OAuth adapter (3 fetch calls)      | ❌                      | —                                       | ✅ throws typed error                     |
| GBP API adapter (4 fetch calls)           | ❌                      | —                                       | ✅ throws `createGbpApiError`             |
| Google Review API adapter (2 fetch calls) | ❌                      | —                                       | ✅ throws `integrationError`              |
| S3 storage adapter (4 operations)         | ❌                      | —                                       | ⚠️ throws `portalError` but no logging    |
| Auth identity adapter (12 API calls)      | ❌                      | —                                       | ✅ throws typed error                     |
| Background jobs (9 handlers)              | ❌                      | —                                       | ✅ (8/9 — import-property has no logging) |
| Event handlers (goal + inbox)             | ❌                      | —                                       | ⚠️ — no span, limited logging             |
| GBP webhook route                         | ✅ `trace()`            | ❌ — no canonical attrs                 | ✅                                        |
| Google OAuth callback route               | ✅ `trace()`            | ❌ — no canonical attrs                 | ✅                                        |
| Worker entry / scheduler                  | ❌ (N/A — setup code)   | —                                       | ✅                                        |

---

## Summary

The codebase has strong foundational observability: `tracedHandler` is universally adopted across all server functions, all 18 infrastructure repositories wrap every method in `trace()`, and there are zero `console.*` calls in production code. However, the coverage gap is significant in two areas: (1) **no external API adapter** (Google OAuth, GBP API, Google Review API, S3, better-auth identity) uses `trace()` — these are the highest-risk calls for latency and failures, yet they are completely invisible in trace output; (2) **all 9 background job handlers and all event handlers** operate without trace spans, meaning BullMQ jobs run as opaque work units with no timing or error span linkage. Additionally, `tracedHandler`'s root span only captures `requestId`/`method`/`name` — the canonical attributes (`organizationId`, `userId`, `role`, `resource.type`, `resource.id`) are never attached. Two BLOCKER PII violations exist in `emails.ts` where the recipient email address is logged in both error and info paths. The string-concatenation logger calls in `worker/index.ts` should be converted to structured fields for consistency.
