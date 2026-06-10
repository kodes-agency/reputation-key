# Composition Root & Public API Barrel Review

**Date:** 2026-06-10
**Scope:** All 14 context `public-api.ts` files, `src/composition.ts`, `src/bootstrap.ts`, cross-context boundary enforcement
**References:** `docs/standards.md` §3, `src/contexts/CONTEXT.md` §Dependency rules, `src/routes/CONTEXT.md`

---

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 0      |
| MAJOR     | 5      |
| MINOR     | 7      |
| NIT       | 3      |
| **Total** | **15** |

---

## Findings

### MAJOR-01 — Portal `build.ts` returns non-standard shape (missing `internal`)

**File:** `src/contexts/portal/build.ts:187-196`
**Quote:**

```ts
return {
  useCases,
  storage,
  portalRepo,
  portalLinkRepo,
  portalGroupRepo,
  linkResolver,
  publicApi,
  portalGroupPublicApi,
} as const
```

**Rule:** `docs/standards.md` §3.1 — build functions MUST return `{ publicApi, internal: { repos, useCases } }`.
**Fix:** Wrap `useCases`, `storage`, repos, `linkResolver`, and `portalGroupPublicApi` under `internal`. Move `useCases` to `internal.useCases`. This forces composition.ts to access them via `.internal.` like all other contexts.

---

### MAJOR-02 — Goal `build.ts` returns non-standard shape (`useCases` and `goalRepo` at top level)

**File:** `src/contexts/goal/build.ts:36-53`
**Quote:**

```ts
export type GoalContextApi = Readonly<{
  useCases: { ... }
  goalRepo: GoalRepository
  events: EventBus
  publicApi: Readonly<{ ... }>
}>
```

**Rule:** `docs/standards.md` §3.1 — build functions MUST return `{ publicApi, internal: { repos, useCases } }`.
**Fix:** Move `useCases` under `internal.useCases` and `goalRepo` under `internal.repos`. Remove top-level `events` (composition.ts doesn't need it back).

---

### MAJOR-03 — Notification `build.ts` `publicApi` not typed against a `NotificationPublicApi` interface

**File:** `src/contexts/notification/build.ts:53-74`
**Quote:**

```ts
const publicApi = {
  insertNotification: useCases.insertNotification,
  findById: (id: string, orgId: string) => notificationRepo.findById(id, orgId),
  getUnreadCount: ...
  getNotifications: ...
  markRead: ...
  markAllRead: ...
} as const
```

**Rule:** All other contexts define a typed `{Context}PublicApi` interface in `application/public-api.ts` and annotate the build's `publicApi` against it. Notification skips this.
**Fix:** Define `NotificationPublicApi` in `application/public-api.ts` and type-annotate the `publicApi` const in `build.ts`. This catches accidental signature drift.

---

### MAJOR-04 — DTO imports bypassing public-api in routes/components (6 files)

**Files (representative):**

- `src/routes/_authenticated/properties/$propertyId/index.tsx:5` — imports `TimeRangePreset` from `dashboard/application/dto/dashboard.dto`
- `src/routes/_authenticated/properties/$propertyId/goals/index.tsx:12` — imports `goalTypeSchema` from `goal/application/dto/goal.dto`
- `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx:10` — imports from `dashboard/application/dto/dashboard.dto`
- `src/components/features/identity/security-settings-form.tsx:15` — imports from `identity/application/dto/change-password.dto`
- `src/components/features/identity/login/login-form.tsx:11` — imports from `identity/application/dto/invitation.dto`
- `src/components/features/property/property-dashboard.tsx:7-8` — imports `TIME_RANGE_OPTIONS` value from `dashboard/application/dto/dashboard.dto`

**Rule:** `src/contexts/CONTEXT.md` — "Cross-context: import ONLY from `application/public-api.ts`. Never from `domain/`, `infrastructure/`, `server/`." Also `src/routes/CONTEXT.md` §160 — "type-only imports from `application/dto/` are allowed for loader return types."
**Fix:** Re-export needed DTOs through each context's `public-api.ts`. Value exports (e.g., `TIME_RANGE_OPTIONS`, Zod schemas used in forms) require value re-exports, not just types. ~21 imports across ~15 files need migration.

---

### MAJOR-05 — GBP webhook route imports infrastructure handler directly

**File:** `src/routes/api/webhooks/gbp/notifications.ts:13`
**Quote:**

```ts
// eslint-disable-next-line boundaries/dependencies -- webhook routes delegate directly to context handlers
import { handleGbpNotification } from '#/contexts/integration/infrastructure/handlers/gbp-notification-handler'
```

**Rule:** Cross-context imports must go through `public-api.ts`. While `src/routes/CONTEXT.md` §176 documents this as an explicit exception, the handler import bypasses the composition root entirely (the `handleGbpNotification` in the container is a partially-applied version, but the webhook uses the raw handler).
**Fix:** The route should use `getContainer().useCases.handleGbpNotification` instead of importing the raw handler. This keeps all wiring in composition.ts. The eslint-disable and exception doc can then be removed.

---

### MINOR-01 — Portal `build.ts` accesses `getEnv()` internally

**File:** `src/contexts/portal/build.ts:55`
**Quote:**

```ts
const env = getEnv()
```

**Rule:** Per the architecture, build functions receive all deps via arguments. Other contexts (identity, integration) receive env values through their deps. Portal reaches for `getEnv()` directly.
**Fix:** Add S3 config values to `PortalContextDeps` and pass them from composition.ts.

---

### MINOR-02 — Activity `build.ts` lacks explicit return type annotation

**File:** `src/contexts/activity/build.ts:25`
**Quote:**

```ts
export const buildActivityContext = (input: BuildInput) => {
```

**Rule:** Other contexts (dashboard, inbox, integration, metric, review, goal) annotate their return type as `{Context}ContextApi`. Activity and notification omit the explicit return type.
**Fix:** Add `ActivityContextApi` type export and annotate the return.

---

### MINOR-03 — Notification `build.ts` lacks explicit return type annotation

**File:** `src/contexts/notification/build.ts:25`
**Quote:**

```ts
export const buildNotificationContext = (input: BuildInput) => {
```

**Fix:** Same as MINOR-02 — add explicit `NotificationContextApi` type.

---

### MINOR-04 — Team `public-api.ts` exports `TeamId` from `domain/types` but `TeamId` is a shared branded ID

**File:** `src/contexts/team/application/public-api.ts:5`
**Quote:**

```ts
export type { Team, TeamId } from '../domain/types'
```

**Rule:** `TeamId` is defined in `shared/domain/ids.ts`. Re-exporting it from `team/domain/types` creates a duplicate import path.
**Fix:** Consumers should import `TeamId` from `#/shared/domain/ids`. Remove the re-export from team's public-api unless team's `domain/types` re-exports it from shared.

---

### MINOR-05 — Goal `build.ts` registers event handlers at build time, bypassing bootstrap.ts

**File:** `src/contexts/goal/build.ts:84-93` (elided) + `src/bootstrap.ts:174-176`
**Quote:**

```
// NOTE: Goal event handlers are now registered inside buildGoalContext
// (composition.ts) so they're available in both web server and worker.
// No separate registration needed here.
```

**Rule:** `src/bootstrap.ts` exists to separate registration from construction. Other contexts (review, activity, notification) register handlers inside their `build.ts` too, making the separation inconsistent.
**Fix:** Either move all event handler registration to `bootstrap.ts` (original intent), or document that build-time registration is the canonical pattern and simplify `bootstrap.ts` to only handle jobs.

---

### MINOR-06 — `composition.ts` creates `goalRepo` early via `_createGoalRepo` to avoid circular refs

**File:** `src/composition.ts:282-283`
**Quote:**

```ts
const goalRepoEarly = _createGoalRepo(db)
const goalCancelFn = _cancelGoalFn({ goalRepo: goalRepoEarly, clock })
```

**Rule:** Per architecture, the composition root should call `buildXxxContext()` and consume the result. Creating a repo separately and importing a use case directly (`cancelGoal` from `cancel-goal.ts`) bypasses the context boundary.
**Fix:** Restructure `buildGoalContext` to accept a `cancelGoalFn` dependency (already does) but produce it internally. The circular-ref issue (goal event handlers need `cancelGoal`, which needs `goalRepo`, which is part of the context) can be resolved with lazy initialization or a two-phase build.

---

### MINOR-07 — `composition.ts` container exposes raw repo objects from 6 contexts

**File:** `src/composition.ts:398-416`
**Quote:**

```ts
storage: portal.storage,
portalRepo: portal.portalRepo,
reviewRepo: review.internal.repos.reviewRepo,
replyRepo: review.internal.repos.replyRepo,
inboxRepo: inbox.internal.repos.inboxRepo,
goalRepo: goal.goalRepo,
activityRepo: activity.internal.repos.activityRepo,
notificationRepo: notification.internal.repos.notificationRepo,
...
```

**Rule:** The container exists to serve server functions and job handlers. Exposing repos directly means bootstrap.ts and server functions can bypass use cases.
**Fix:** Where possible, replace direct repo access in bootstrap.ts with use-case or public-api calls. Where repos are needed for job handlers (review sync, activity log), this is acceptable but should be documented with a comment.

---

### NIT-01 — 14 contexts exist, not 13 as stated in `docs/standards.md`

**File:** `docs/standards.md:19`
**Rule:** The `context` segment column lists 11 context names. The actual codebase has 14: identity, property, portal, guest, team, staff, integration, review, inbox, metric, goal, dashboard, activity, notification.
**Fix:** Update the standards doc to list all 14 context names.

---

### NIT-02 — `staff/application/public-api.ts` uses `import('#/shared/domain/ids').TeamId` inline

**File:** `src/contexts/staff/application/public-api.ts:36`
**Quote:**

```ts
countAssignmentsByTeam: (
  orgId: OrganizationId,
  teamId: import('#/shared/domain/ids').TeamId,
) => Promise<number>
```

**Rule:** Code style — inline `import()` types are harder to read than a top-level import.
**Fix:** Add `TeamId` to the existing `import type { ... } from '#/shared/domain/ids'` at the top of the file.

---

### NIT-03 — Identity `public-api.ts` exports port types (`IdentityPort`, etc.) that are only consumed by composition.ts

**File:** `src/contexts/identity/application/public-api.ts:21-26`
**Quote:**

```ts
export type {
  IdentityPort,
  MemberRecord,
  InvitationRecord,
  OrganizationRecord,
} from './ports/identity.port'
```

**Rule:** public-api should export only what cross-context consumers need. `IdentityPort` is consumed by identity's own infrastructure adapter, not by other contexts.
**Fix:** Verify external consumers of `MemberRecord`, `InvitationRecord`, `OrganizationRecord`. If none, move to an internal barrel. `IdentityPort` can stay for adapter wiring documentation.

---

## Context Wiring Completeness

All 14 contexts are wired in `src/composition.ts`:

| Context      | Built | Container exports                    | public-api.ts exists | Standard shape     |
| ------------ | ----- | ------------------------------------ | -------------------- | ------------------ |
| identity     | ✅    | `...identity.internal.useCases`      | ✅                   | ✅                 |
| property     | ✅    | `...property.internal.useCases`      | ✅                   | ✅                 |
| staff        | ✅    | `...staff.internal.useCases`         | ✅                   | ✅                 |
| team         | ✅    | `...team.internal.useCases`          | ✅                   | ✅                 |
| portal       | ✅    | `...portal.useCases`                 | ✅                   | ❌ (no `internal`) |
| guest        | ✅    | `...guest.internal.useCases`         | ✅                   | ✅                 |
| integration  | ✅    | `...integration.internal.useCases`   | ✅                   | ✅                 |
| review       | ✅    | explicit use-case spread             | ✅                   | ✅                 |
| inbox        | ✅    | `...inbox.internal.useCases`         | ✅                   | ✅                 |
| metric       | ✅    | `metricApi.publicApi`                | ✅                   | ✅                 |
| goal         | ✅    | `...goal.useCases`                   | ✅                   | ❌ (no `internal`) |
| dashboard    | ✅    | `dashboard.publicApi.*`              | ✅                   | ✅                 |
| activity     | ✅    | `activity.publicApi`, `activityRepo` | ✅                   | ✅                 |
| notification | ✅    | `notification.publicApi`, repos      | ✅                   | ⚠️ (no typed API)  |

**No orphaned ports detected** — all ports defined in `application/ports/` are either wired in composition.ts or consumed internally.

## Bootstrap Startup Order

`src/bootstrap.ts` registers all background job handlers in a single `bootstrap()` function. The order is:

1. Health check
2. Portal image processing
3. GBP property import
4. Review sync + retention (3 jobs)
5. Reply publish
6. Metric materialized view refresh (3 jobs)
7. Goal reconciliation + recurring spawner (2 jobs)
8. Activity log insertion
9. Notification insert + urgent email + digest (3 jobs)

Order is not dependency-sensitive (jobs are independent handlers). Event handlers are registered at build time inside their respective `build.ts` functions. This is a design deviation from the stated "separate registration from construction" architecture comment but is consistently applied.

## Cross-Context Import Hygiene

- **No `internal.ts` files** found — contexts use `build.ts` return objects instead.
- **No `domain/` imports from routes/components** — clean.
- **No `infrastructure/` imports from components** — clean.
- **One `infrastructure/` import from routes** — GBP webhook (documented exception with eslint-disable).
- **`application/dto/` imports from routes/components** — ~21 occurrences across ~15 files. Per `routes/CONTEXT.md`, type-only dto imports are allowed for loader return types, but many import values (Zod schemas, `TIME_RANGE_OPTIONS`). These should be re-exported through `public-api.ts`.
