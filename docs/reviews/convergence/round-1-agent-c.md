# Convergence Pass — Agent C: Cross-cutting, wiring, dead code, CONTEXT.md drift

**Date:** 2026-06-10
**Scope:** All 14 bounded contexts

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 2      |
| MAJOR     | 6      |
| MINOR     | 4      |
| NIT       | 1      |
| **Total** | **13** |

---

## 1. Build return shape vs D4

### BLOCKER — Portal `build.ts` returns flat object, not D4 shape

File: src/contexts/portal/build.ts:187-196
Quote: ```
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

````
Rule:  src/contexts/CONTEXT.md — "Build functions wire ports → adapters, deps → use cases." Return shape is `{ publicApi, internal: { repos, useCases } }` per D4 convention (followed by 13/14 contexts).
Fix:   Wrap in `{ publicApi, portalGroupPublicApi, internal: { repos: { portalRepo, portalLinkRepo, portalGroupRepo, linkResolver, storage }, useCases } }`. Update `composition.ts` to destructure from `internal`.

### MAJOR — Notification `build.ts` missing explicit return type annotation
File: src/contexts/notification/build.ts:76-82
Quote: ```
return {
  publicApi,
  internal: {
    repos: { notificationRepo, emailRepo, prefRepo },
    useCases,
  },
} as const
````

Rule: src/contexts/CONTEXT.md — "Factory functions returning records of functions." Other typed contexts (metric, dashboard, inbox, goal, review) export a named `XxxContextApi` type. Notification does not.
Fix: Add `type NotificationContextApi = Readonly<{ publicApi: ..., internal: ... }>` and annotate the return type.

---

## 2. Dead exports / dead files

### MAJOR — `review/application/internal-ports.ts` is a cross-context leak

File: src/contexts/review/application/internal-ports.ts
Quote: ```
/\*\*

- Internal barrel for review context port types.
- Used by infrastructure within the review context and by tightly-coupled
- integration context adapters.
  \*/
  export type { ReviewQueuePort, SyncPropertyReviewsJobData, AddSyncJobOptions } from './ports/review-queue.port'
  export type { GoogleReviewApiPort } from './ports/google-review-api.port'

````
Rule:  src/contexts/CONTEXT.md — "Cross-context: import from `application/public-api.ts` only. Never from `domain/`, `infrastructure/`, `server/`, or non-public-api `application/`."
Fix:   Move these type re-exports into `review/application/public-api.ts` (already exports `GoogleReviewApiPort`). Remove `internal-ports.ts`.

### MINOR — `review/application/dto/sync-reviews.dto.ts` not documented in CONTEXT.md
File: src/contexts/review/application/dto/sync-reviews.dto.ts
Quote: ```
// Used by Phase 11 manual sync trigger server function.
export const syncReviewsInputSchema = z.object({ ... })
````

Rule: CONTEXT.md `Architecture layers` section lists `dto/ sync-reviews.dto.ts`.
Fix: Already listed in CONTEXT.md — confirmed present. No action needed.

---

## 3. CONTEXT.md drift — bounded contexts table

### BLOCKER — Notification context missing from top-level CONTEXT.md table

File: src/contexts/CONTEXT.md:7-21
Quote: ```
| Context | Description | ...
| Identity | Users, organizations, members, invitations | ...
... (12 more rows, no Notification)

````
Rule:  All bounded contexts must be listed in the master table.
Fix:   Add row: `| Notification | In-app and email notifications, digest delivery, event subscriptions | Notification, NotificationEmail | Standard |`

---

## 4. CONTEXT.md drift — architecture layer trees

### MAJOR — Inbox CONTEXT.md missing `build-use-cases.ts`
File: src/contexts/inbox/CONTEXT.md:64-87
Quote: ```
inbox/
  ...
  build.ts             composition root
````

Actual filesystem also has `build-use-cases.ts` (extracted wiring module).
Rule: CONTEXT.md layer tree should list all source files.
Fix: Add `build-use-cases.ts` to the architecture layer tree.

### MAJOR — Review CONTEXT.md missing 2 server files and `internal-ports.ts`

File: src/contexts/review/CONTEXT.md:49-68
Quote: ```
server/ reply.ts, staff-recent-activity.ts

````
Actual: `reply.ts`, `reply-draft.ts`, `reply-read.ts`, `staff-recent-activity.ts`. Also missing `application/internal-ports.ts`.
Rule:  CONTEXT.md layer tree should list all source files.
Fix:   Update server layer to `reply.ts, reply-draft.ts, reply-read.ts, staff-recent-activity.ts`. Add `internal-ports.ts` to application layer or remove the file (see finding 2).

### MAJOR — Identity CONTEXT.md lists only 2 server files; actual has 10+
File: src/contexts/identity/CONTEXT.md:52-68
Quote: ```
server/              organizations.ts, auth-settings.ts
````

Actual: `organizations.ts`, `organizations.invitations.ts`, `organizations.members.ts`, `organizations.query.ts`, `organizations.registration.ts`, `organizations.shared.ts`, `organizations.update.ts`, `organizations.upload.ts`, `auth-settings.ts`, `auth-settings.helpers.ts`, `auth-settings.org.ts`.
Rule: CONTEXT.md layer tree should list all source files.
Fix: Update server layer listing to include all server files.

### MINOR — Dashboard CONTEXT.md missing `application/utils.ts`

File: src/contexts/dashboard/CONTEXT.md:49-61
Quote: ```
application/
...
public-api.ts re-exports domain types

````
Actual also has `application/utils.ts` (MS_PER_DAY, TimeRangePreset, timeRangeToDates, computeTrend).
Rule:  CONTEXT.md layer tree should list all source files.
Fix:   Add `utils.ts` to application layer listing.

### MINOR — Notification CONTEXT.md uses non-standard layer format
File: src/contexts/notification/CONTEXT.md:9-18
Quote: ```
## Layer structure

````

server/ → createServerFn wrappers (queries + mutations)
application/ → use cases, ports, public-api barrel
...

```

```

All other contexts use the standard 4-layer code block format per src/contexts/CONTEXT.md.
Rule: Consistency — all CONTEXT.md files should use the standard layer tree format.
Fix: Reformat to match the standard `context/ domain/ application/ infrastructure/ server/ build.ts` tree.

---

## 5. Notification leakage into other contexts

### NIT — Integration context has "notification" in GBP Pub/Sub handler names

File: src/contexts/integration/application/use-cases/handle-gbp-notification.ts
File: src/contexts/integration/infrastructure/handlers/gbp-notification-handler.ts
Quote: These handle Google Business Profile Pub/Sub push notifications (webhooks), not user-facing in-app notifications.
Rule: Not a leak — "notification" here refers to Google Pub/Sub push notifications, a different domain concept.
Fix: No action needed. Naming is accurate for the GBP domain.

---

## 6. Additional cross-cutting observations

### MINOR — Activity context `ports/` at root level, not under `application/`

File: src/contexts/activity/ports/ (directory)
Quote: CONTEXT.md says `ports/ → activity-repository.port.ts, user-lookup.port.ts` and the actual filesystem matches.
Rule: Parent CONTEXT.md defines standard as `application/ports/`. Activity's CONTEXT.md documents this as intentional (flat structure for thin subscriber context).
Fix: Acceptable deviation — CONTEXT.md documents the actual layout. No action needed unless team wants to enforce strict alignment.
