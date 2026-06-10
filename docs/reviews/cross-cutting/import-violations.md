# Cross-Context Import Violations Review

**Date:** 2026-06-10
**Scope:** All files under `src/` — cross-context boundary enforcement
**Rule:** Cross-context calls go through `application/public-api.ts` only (standards.md §6, §3.1)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 7     |
| MINOR    | 2     |
| NIT      | 0     |

### Architecture Rule (standards.md §6)

> Cross-context: import ONLY from `application/public-api.ts`. Never from `domain/`, `infrastructure/`, `server/`.

### Composition Root Exception (standards.md §3.1)

> `composition.ts` may access `internal`. Other contexts may NOT import `internal`.

---

## BLOCKER

### B1. Integration test imports from review context's internal-ports

````
[BLOCKER] Cross-context import of review's internal-ports bypasses public-api
  File: src/contexts/integration/application/use-cases/handle-gbp-notification.test.ts:10
  Quote: ```import {
  AddSyncJobOptions,
} from '#/contexts/review/application/internal-ports'```
  Rule:  standards.md §3.1 — "Other contexts may NOT import `internal`"
         standards.md §6 — "Cross-context: import ONLY from `application/public-api.ts`"
  Fix:   Move `ReviewQueuePort`, `SyncPropertyReviewsJobData`, `AddSyncJobOptions` types
         to review's `application/public-api.ts` so integration can import them legally.
         The `internal-ports.ts` file comment itself says "external consumers should use
         application/public-api.ts".
````

---

## MAJOR

### M1. composition.ts — 12 direct infrastructure imports bypassing context public-api

The composition root has special privileges (§3.1: "composition.ts may access `internal`"),
but many imports reach into infrastructure factories directly instead of going through
each context's `build.ts` or `public-api.ts`. This creates hidden coupling.

````
[MAJOR] Direct infrastructure factory import bypasses context build/public-api
  File: src/composition.ts:20
  Quote: ```import { createBetterAuthIdentityAdapter } from '#/contexts/identity/infrastructure/adapters/auth-identity.adapter'```
  Rule:  standards.md §6
  Fix:   Re-export adapter factory from identity's build.ts or public-api.ts.
````

````
[MAJOR] Direct infrastructure schema import
  File: src/composition.ts:24
  Quote: ```import {
  betterAuthOrganizationSchema,
  parseBetterAuthResponse,
} from '#/contexts/identity/infrastructure/adapters/better-auth-schemas'```
  Rule:  standards.md §6
  Fix:   Re-export from identity's build.ts or public-api.ts.
````

````
[MAJOR] Direct repository factory import bypasses context build
  File: src/composition.ts:33
  Quote: ```import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'```
  Rule:  standards.md §6
  Fix:   Re-export from property's build.ts, or let buildPropertyContext create the repo internally.
````

````
[MAJOR] Direct infrastructure adapter imports (3 lines)
  File: src/composition.ts:45-47
  Quote: ```import { createReviewStatsAdapter } from '#/contexts/dashboard/infrastructure/adapters/review-stats.adapter'
import { createMetricStatsAdapter } from '#/contexts/dashboard/infrastructure/adapters/metric-stats.adapter'
import { createPortalMetricsAdapter } from '#/contexts/dashboard/infrastructure/adapters/portal-metrics.adapter'```
  Rule:  standards.md §6
  Fix:   Re-export from dashboard's build.ts.
````

````
[MAJOR] Direct repository factory import bypasses context build
  File: src/composition.ts:49
  Quote: ```import { createGoalRepository as _createGoalRepo } from '#/contexts/goal/infrastructure/repositories/goal.repository'```
  Rule:  standards.md §6
  Fix:   Let buildGoalContext create the repo internally, or re-export factory.
````

````
[MAJOR] Direct use-case import bypasses public-api and build
  File: src/composition.ts:50
  Quote: ```import { cancelGoal as _cancelGoalFn } from '#/contexts/goal/application/use-cases/cancel-goal'```
  Rule:  standards.md §6 — "import ONLY from application/public-api.ts"
  Fix:   Re-export cancelGoal from goal's public-api.ts, or expose via build return.
````

````
[MAJOR] Direct repository factory import
  File: src/composition.ts:51
  Quote: ```import { createStaffAssignmentRepository } from '#/contexts/staff/infrastructure/repositories/staff-assignment.repository'```
  Rule:  standards.md §6
  Fix:   Re-export from staff's build.ts.
````

````
[MAJOR] Direct infrastructure adapter imports (4 lines)
  File: src/composition.ts:52-57
  Quote: ```import { createGoogleReviewApiAdapter } from '#/contexts/integration/infrastructure/adapters/google-review-api.adapter'
...
import { createReviewLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/review-lookup.adapter'
import { createFeedbackLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/feedback-lookup.adapter'
import { createPropertyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/property-lookup.adapter'```
  Rule:  standards.md §6
  Fix:   Re-export adapter factories from each context's build.ts.
````

### M2. bootstrap.ts — 7 direct infrastructure/jobs imports

````
[MAJOR] Direct infrastructure job imports bypass context public-api
  File: src/bootstrap.ts:16,20,24,28,32,36,40
  Quote: ```import { createProcessImageJob, ... } from '#/contexts/portal/infrastructure/jobs/process-image.job'
import { createImportPropertyHandler, ... } from '#/contexts/integration/infrastructure/jobs/import-property.job'
import { createSyncPropertyReviewsHandler, ... } from '#/contexts/review/infrastructure/jobs/sync-property-reviews.job'
import { createRefreshExpiringReviewsHandler, ... } from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import { createPurgeExpiredReviewsHandler, ... } from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import { createRefreshMatViewHandler, ... } from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import { createPublishReplyHandler, ... } from '#/contexts/review/infrastructure/jobs/publish-reply.job'```
  Rule:  standards.md §6
  Fix:   Each context should export its job handlers and JOB_NAMEs through public-api.ts
         or a dedicated `jobs.ts` barrel. bootstrap.ts would then import from the barrel.
````

bootstrap.ts also has dynamic imports (lines 180, 197, 214-246, 272, 290) from:

- `#/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job`
- `#/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job`
- `#/contexts/activity/infrastructure/jobs/insert-activity-log.job`
- `#/contexts/activity/infrastructure/adapters/db-user-lookup.adapter`
- `#/contexts/notification/infrastructure/jobs/insert-notification.job`
- `#/contexts/notification/infrastructure/adapters/db-user-lookup.adapter`
- `#/contexts/notification/infrastructure/adapters/resend-email.adapter`
- `#/contexts/notification/infrastructure/jobs/urgent-email.job`
- `#/contexts/notification/infrastructure/jobs/digest-notification.job`

### M3. worker/index.ts — 4 direct infrastructure/jobs imports

````
[MAJOR] Worker imports JOB_NAMEs directly from infrastructure
  File: src/worker/index.ts:10,12-15
  Quote: ```import { JOB_NAMES } from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import { JOB_NAME as REFRESH_EXPIRING_JOB_NAME } from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import { JOB_NAME as PURGE_EXPIRED_JOB_NAME } from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import { RECONCILE_GOAL_JOB_NAME ... } from '#/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job'
import { SPAWN_RECURRING_JOB_NAME ... } from '#/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job'```
  Rule:  standards.md §6
  Fix:   Re-export job name constants from each context's public-api.ts.
````

### M4. shared/testing/fixtures.ts — 6 domain type imports from contexts

````
[MAJOR] Test fixtures import domain types directly, bypassing public-api
  File: src/shared/testing/fixtures.ts:12-13,14,19,21,27
  Quote: ```import type { Property } from '#/contexts/property/domain/types'
import type { Team } from '#/contexts/team/domain/types'
import type { StaffAssignment } from '#/contexts/staff/domain/types'
import type { Portal, PortalLinkCategory, PortalLink } from '#/contexts/portal/domain/types'
import type { ScanEvent, Rating, Feedback } from '#/contexts/guest/domain/types'
import type { GoogleConnection, GbpImportJob, GbpLocation } from '#/contexts/integration/domain/types'```
  Rule:  standards.md §6 — "import ONLY from application/public-api.ts"
  Fix:   Re-export domain types from each context's public-api.ts. Test infrastructure
         should consume the same public surface as production code.
````

### M5. shared/testing/in-memory repos — 11 files importing domain types

Each in-memory test double imports domain types directly from context `domain/` layers:

| File                                  | Context imported from                                          |
| ------------------------------------- | -------------------------------------------------------------- |
| `in-memory-dashboard-repo.ts`         | `dashboard/domain/types`                                       |
| `in-memory-gbp-api-port.ts`           | `integration/domain/types`, `integration/domain/gbp-api-error` |
| `in-memory-gbp-cache-repo.ts`         | `integration/domain/types`                                     |
| `in-memory-gbp-import-repo.ts`        | `integration/domain/types`                                     |
| `in-memory-google-connection-repo.ts` | `integration/domain/types`                                     |
| `in-memory-inbox-repo.ts`             | `inbox/domain/types`                                           |
| `in-memory-portal-link-repo.ts`       | `portal/domain/types`                                          |
| `in-memory-portal-repo.ts`            | `portal/domain/types`                                          |
| `in-memory-property-repo.ts`          | `property/domain/types`                                        |
| `in-memory-staff-assignment-repo.ts`  | `staff/domain/types`                                           |
| `in-memory-team-repo.ts`              | `team/domain/types`                                            |

````
[MAJOR] Test doubles import domain types bypassing public-api (11 files)
  File: src/shared/testing/in-memory-*.ts
  Quote: ```import type { X } from '#/contexts/<ctx>/domain/types'```
  Rule:  standards.md §6
  Fix:   Re-export all domain types through each context's public-api.ts.
         In-memory repos should import from the same surface as production.
````

### M6. Webhook route imports from infrastructure handlers

````
[MAJOR] Route imports from context infrastructure/handlers (documented exception)
  File: src/routes/api/webhooks/gbp/notifications.ts:13
  Quote: ```import { handleGbpNotification } from '#/contexts/integration/infrastructure/handlers/gbp-notification-handler'```
  Rule:  standards.md §6, routes/CONTEXT.md §Dependency rules
         Exception documented in routes/CONTEXT.md §Webhook route exception
  Fix:   Move handler to integration's server/ layer, or expose through public-api.
         The documented exception is pragmatic but should be revisited.
````

### M7. composition.ts accesses internal.repos of other contexts at runtime

````
[MAJOR] Composition accesses review/guest internal repos for adapter wiring
  File: src/composition.ts:244-254
  Quote: ```const reviewLookup = createReviewLookupAdapter({
    findReviewById: (id, orgId) => review.internal.repos.reviewRepo.findById(id, orgId),
    findReviewsByIds: (ids, orgId) => review.internal.repos.reviewRepo.findByIds(ids, orgId),
  })
  const feedbackLookup = createFeedbackLookupAdapter({
    findFeedbackById: (id, orgId) => guest.internal.repos.guestRepo.findFeedbackById(id, orgId),
    findRatingById: (id, orgId) => guest.internal.repos.guestRepo.findRatingById(id, orgId),
  })```
  Rule:  standards.md §3.1 — "composition.ts may access internal" (allowed but fragile)
  Fix:   Expose dedicated port-fulfilling functions on public-api instead of leaking
         repo internals. E.g., review.publicApi.findById(id, orgId) instead of
         review.internal.repos.reviewRepo.findById(id, orgId).
````

---

## MINOR

### Mn1. Routes import types from application/public-api instead of application/dto

````
[MINOR] Route uses type import from application/public-api (should be application/dto per convention)
  File: src/routes/_authenticated/home.tsx:15-18
  Quote: ```import type { KPIs } from '#/contexts/dashboard/application/public-api'
import type { StaffGoalEntry } from '#/contexts/goal/application/public-api'
import type { StaffPortalEntry } from '#/contexts/staff/application/public-api'
import type { StaffRecentReview } from '#/contexts/review/application/public-api'```
  Rule:  routes/CONTEXT.md — "type-only imports from application/dto/ are allowed"
  Fix:   Re-export these types from each context's application/dto/ barrel.
````

````
[MINOR] Route uses type import from application/public-api
  File: src/routes/_authenticated/progress.tsx:9
  Quote: ```import type { StaffGoalEntry } from '#/contexts/goal/application/public-api'```
  Rule:  routes/CONTEXT.md
  Fix:   Re-export StaffGoalEntry from goal's application/dto/.
````

---

## Compliant Patterns Observed

The following cross-context interactions correctly go through `application/public-api.ts`:

1. **Event handler subscriptions** — All event handlers across contexts import event types from the source context's `application/public-api.ts`. Examples:
   - `activity/infrastructure/event-handlers/on-reply-approved.ts` → `review/application/public-api`
   - `notification/infrastructure/event-handlers/on-goal-completed.ts` → `goal/application/public-api`
   - `inbox/infrastructure/event-handlers/on-feedback-submitted.ts` → `guest/application/public-api`
   - `metric/infrastructure/event-handlers/on-review-created.ts` → `review/application/public-api`
   - All 30+ event handler files follow this pattern correctly.

2. **Context build dependencies** — All `build.ts` files import port types from other contexts' `application/public-api.ts`. Examples:
   - `inbox/build.ts` → `staff/application/public-api`
   - `team/build.ts` → `property/application/public-api`, `staff/application/public-api`
   - `portal/build.ts` → `property/application/public-api`
   - `guest/build.ts` → `portal/application/public-api`

3. **Use case dependencies** — Use cases import port types from other contexts' `application/public-api.ts`. Examples:
   - `inbox/application/use-cases/*.ts` → `staff/application/public-api`
   - `team/application/use-cases/*.ts` → `property/application/public-api`, `staff/application/public-api`
   - `portal/application/use-cases/create-portal.ts` → `property/application/public-api`
   - `identity/application/use-cases/finalize-*.ts` → `portal/application/public-api`

4. **Route server function imports** — All route files correctly import from `contexts/<ctx>/server/` only.

5. **No cross-context server-to-server imports** — No server file imports from another context's server layer.

6. **No cross-context domain imports** — No context imports from another context's `domain/` layer.

7. **No component imports from context internals** — `src/components/` has zero imports from context `domain/` or `infrastructure/`.

---

## Recommendations

1. **P0 — Fix B1:** Move `ReviewQueuePort`, `SyncPropertyReviewsJobData`, `AddSyncJobOptions` from `review/application/internal-ports.ts` to `review/application/public-api.ts`. Delete `internal-ports.ts`.

2. **P1 — Create context job barrels:** Each context should export its job factories and `JOB_NAME` constants from `application/public-api.ts` (or a dedicated `application/jobs.ts` barrel). This fixes M2, M3.

3. **P1 — Re-export domain types:** Each context should re-export all domain types from `application/public-api.ts`. This fixes M4, M5.

4. **P2 — Composition root refactoring:** Either:
   - (a) Have each context's `build.ts` create its own repos internally and accept `db` as a parameter, or
   - (b) Re-export repo/adapter factories from each context's `build.ts`

   This reduces the number of direct infrastructure imports in composition.ts from 12 to 0.

5. **P2 — Move webhook handler:** Move `gbp-notification-handler.ts` from `integration/infrastructure/handlers/` to `integration/server/` so the webhook route imports from the conventional layer.
