# Convergence Round 2: build.ts Shape + CONTEXT.md Drift

**Date:** 2026-06-10
**Scope:** All 14 contexts (13 originally + notification)
**Reviewer:** Convergence pass 2

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 3      |
| MAJOR     | 16     |
| MINOR     | 10     |
| NIT       | 4      |
| **Total** | **33** |

---

## 1. build.ts D4 Shape Violations

The D4 canonical shape is: `Readonly<{ publicApi, internal: { repos, useCases } }>`

### BLOCKER: Portal build.ts does not return D4 shape

````
[ARCH] BLOCKER Portal returns flat object instead of D4 { publicApi, internal: { repos, useCases } }
  File: src/contexts/portal/build.ts:187-197
  Quote: ```return {
    useCases,
    storage,
    portalRepo,
    portalLinkRepo,
    portalGroupRepo,
    linkResolver,
    publicApi,
    portalGroupPublicApi,
  } as const```
  Rule:  D4 build function contract — all contexts must return { publicApi, internal: { repos, useCases } }
  Fix:   Wrap repos/useCases under `internal`, move `storage`, `linkResolver`, `portalGroupPublicApi` under `internal.repos` or `internal`. Keep `publicApi` at top level.
````

### BLOCKER: Goal build.ts does not return D4 shape

````
[ARCH] BLOCKER Goal returns flat object with goalRepo/events at top level instead of D4 shape
  File: src/contexts/goal/build.ts:95-112
  Quote: ```return {
    useCases: { ... },
    goalRepo,
    events: input.events,
    publicApi: { ... },
  }```
  Rule:  D4 build function contract — all contexts must return { publicApi, internal: { repos, useCases } }
  Fix:   Wrap as `return { publicApi: { ... }, internal: { repos: { goalRepo }, useCases: { ... } } }`. Move `events` out of return (register handlers separately, already done at build time).
````

### BLOCKER: Root CONTEXT.md missing 2 contexts from bounded contexts table

````
[DOC] BLOCKER Root CONTEXT.md claims "Twelve bounded contexts" but there are 14; notification + activity missing
  File: CONTEXT.md:5-39
  Quote: ```Layered hexagonal (clean architecture). Twelve bounded contexts in `src/contexts/`...
  |     | Dashboard   | Read-only aggregation... | — |```
  Rule:  Root CONTEXT.md must enumerate all bounded contexts
  Fix:   Add Notification (user-facing in-app/email notifications) and Activity (immutable audit log) rows to the table. Update "Twelve" → "Fourteen".
````

---

## 2. CONTEXT.md ↔ Filesystem Drift

### Team CONTEXT.md missing documented file

````
[DOC] MAJOR Team CONTEXT.md omits assignment-check.port.ts from documented layer tree
  File: src/contexts/team/CONTEXT.md:43
  Quote: ```application/ports/   team.repository.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `assignment-check.port.ts` to `application/ports/` line.
````

### Staff CONTEXT.md missing documented file

````
[DOC] MAJOR Staff CONTEXT.md omits server/staff-portals-update.ts from layer tree
  File: src/contexts/staff/CONTEXT.md:50
  Quote: ```server/              staff-assignments.ts, staff-portals.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `staff-portals-update.ts` to `server/` line.
````

### Review CONTEXT.md missing files

````
[DOC] MAJOR Review CONTEXT.md omits internal-ports.ts from application layer
  File: src/contexts/review/CONTEXT.md:59
  Quote: ```application/public-api.ts      re-exports DTO types, port types, event types/constructors```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `internal-ports.ts` to `application/` section. Document its purpose (internal-only port re-exports).
````

````
[DOC] MAJOR Review CONTEXT.md omits server/reply-draft.ts and server/reply-read.ts
  File: src/contexts/review/CONTEXT.md:66
  Quote: ```server/              reply.ts, staff-recent-activity.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `reply-draft.ts`, `reply-read.ts` to `server/` line.
````

### Property CONTEXT.md missing file

````
[DOC] MAJOR Property CONTEXT.md omits server/property-read.ts from layer tree
  File: src/contexts/property/CONTEXT.md:48
  Quote: ```server/              properties.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `property-read.ts` to `server/` line.
````

### Portal CONTEXT.md missing files

````
[DOC] MAJOR Portal CONTEXT.md omits 3 server files from layer tree
  File: src/contexts/portal/CONTEXT.md:84
  Quote: ```server/              portals.ts, portal-links.ts, portal-groups.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `portal-uploads.ts`, `portal-read.ts`, `portal-link-categories.ts` to `server/` line.
````

### Integration CONTEXT.md missing files

````
[DOC] MAJOR Integration CONTEXT.md omits server/google-auth-url.ts and application/constants.ts
  File: src/contexts/integration/CONTEXT.md:78-79
  Quote: ```server/              google-connections.ts, gbp-import.ts, error-helpers.ts
  build.ts             composition root```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `google-auth-url.ts` to `server/` line. Add `constants.ts` to `application/` section.
````

### Inbox CONTEXT.md missing files

````
[DOC] MAJOR Inbox CONTEXT.md omits 5 server files and build-use-cases.ts
  File: src/contexts/inbox/CONTEXT.md:85-86
  Quote: ```server/              inbox.ts
  build.ts             composition root```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `inbox-shared.ts`, `inbox-status.ts`, `inbox-item-actions.ts`, `inbox-item-queries.ts`, `inbox-queries.ts` to `server/`. Add `build-use-cases.ts` at root level.
````

````
[DOC] MINOR Inbox CONTEXT.md omits on-reply-submitted.ts from event-handlers
  File: src/contexts/inbox/CONTEXT.md:83
  Quote: ```event-handlers/    on-review-created.ts, on-review-updated.ts, on-feedback-submitted.ts,
                     on-reply-published.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `on-reply-submitted.ts` to `event-handlers/` line.
````

### Identity CONTEXT.md missing files

````
[DOC] MAJOR Identity CONTEXT.md omits many split server files
  File: src/contexts/identity/CONTEXT.md:67
  Quote: ```server/              organizations.ts, auth-settings.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `organizations.upload.ts`, `organizations.query.ts`, `organizations.registration.ts`, `organizations.shared.ts`, `organizations.update.ts`, `organizations.invitations.ts`, `organizations.members.ts`, `auth-settings.helpers.ts`, `auth-settings.org.ts` to `server/` line.
````

### Guest CONTEXT.md missing file

````
[DOC] MINOR Guest CONTEXT.md omits server/guest-scans.ts from layer tree
  File: src/contexts/guest/CONTEXT.md:66
  Quote: ```server/              public.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `guest-scans.ts` to `server/` line.
````

### Dashboard CONTEXT.md missing file

````
[DOC] MINOR Dashboard CONTEXT.md omits application/utils.ts from layer tree
  File: src/contexts/dashboard/CONTEXT.md:54
  Quote: ```application/use-cases/         get-dashboard-data.ts, get-portal-analytics.ts, get-staff-dashboard-data.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `utils.ts` to `application/` section.
````

### Activity CONTEXT.md missing files

````
[DOC] MAJOR Activity CONTEXT.md omits inbox-item-lookup.port.ts and db-inbox-item-lookup.adapter.ts
  File: src/contexts/activity/CONTEXT.md:93-95
  Quote: ```ports/           → activity-repository.port.ts, user-lookup.port.ts
  infrastructure/  → activity-repository.drizzle.ts, event-handlers/ (one per tag),
                       adapters/db-user-lookup.adapter.ts, jobs/insert-activity-log.job.ts```
  Rule:  CONTEXT.md layer tree must list all files in the directory
  Fix:   Add `inbox-item-lookup.port.ts` to `ports/` line. Add `db-inbox-item-lookup.adapter.ts` to `infrastructure/adapters/` line.
````

### Notification CONTEXT.md layer description drift

````
[DOC] MINOR Notification CONTEXT.md says adapters "(user, property)" but actual adapters are db-user-lookup and resend-email (no property adapter)
  File: src/contexts/notification/CONTEXT.md:16
  Quote: ```adapters/        → cross-context lookup adapters (user, property)```
  Rule:  CONTEXT.md must match actual filesystem
  Fix:   Update to `(user lookup, Resend email sender)`. Remove "property" reference.
````

### Notification CONTEXT.md missing domain files

````
[DOC] MINOR Notification CONTEXT.md omits constructors-email.ts, constructors-preference.ts, constructors-transitions.ts from domain layer
  File: src/contexts/notification/CONTEXT.md:12
  Quote: ```domain/       → types, constructors, errors, isUrgent```
  Rule:  CONTEXT.md must document all domain files
  Fix:   Update to `types, constructors, constructors-email, constructors-preference, constructors-transitions, errors`.
````

### Empty event-handlers dirs not documented

```
[DOC] NIT Guest and integration have empty infrastructure/event-handlers/ dirs with only README.md
  File: src/contexts/guest/infrastructure/event-handlers/README.md, src/contexts/integration/infrastructure/event-handlers/README.md
  Rule:  Filesystem should not contain empty placeholder directories
  Fix:   Remove empty event-handlers/ dirs if they serve no purpose, or document their intent in CONTEXT.md.
```

---

## 3. Dead Exports

### Team public-api.ts — entire surface is dead for cross-context consumption

````
[ARCH] MAJOR Team public-api.ts exports 10 symbols (Team, TeamId, TeamPublicApi, events) never imported outside team context
  File: src/contexts/team/application/public-api.ts:1-15
  Quote: ```export type { Team, TeamId } from '../domain/types'
  export { teamCreated, teamUpdated, teamDeleted } from '../domain/events'
  export type { TeamCreated, TeamUpdated, TeamDeleted, TeamEvent } from '../domain/events'
  export type TeamPublicApi = Readonly<Record<string, never>>```
  Rule:  Public API surface must have at least one cross-context consumer or be removed
  Fix:   Either remove unused exports or keep only `TeamPublicApi` (already an empty Record). External consumers import `Team` directly from `domain/types`.
````

### Notification public-api.ts — port/constructor/error re-exports have zero external consumers

````
[ARCH] MAJOR Notification public-api.ts re-exports 10+ types (ports, constructors, errors, isUrgent, URGENT_TYPES) with zero cross-context imports
  File: src/contexts/notification/application/public-api.ts:17-33
  Quote: ```export { isUrgent, URGENT_TYPES } from '../domain/types'
  export type { CreateNotificationInput } from '../domain/constructors'
  export type { NotificationRepositoryPort } from './ports/notification-repository.port'
  export type { UserLookupPort } from './ports/user-lookup.port'
  export type { EmailSenderPort } from './ports/email-sender.port'```
  Rule:  Only export what is consumed across context boundaries
  Fix:   Remove re-exports that have no external consumers. All notification internals import ports via relative paths already.
````

### Dashboard public-api.ts — StaffDashboardData not consumed externally

````
[ARCH] MINOR Dashboard public-api.ts exports StaffDashboardData but no external file imports it (only internal use)
  File: src/contexts/dashboard/application/public-api.ts:13
  Quote: ```PortalAnalyticsData,
  } from '../domain/types'```
  Rule:  Only export what is consumed across context boundaries
  Fix:   Keep StaffDashboardData exported since it's part of the documented public API surface and could be consumed by future components.
````

### Review public-api.ts — ReviewReplyPublishFailed exported but not consumed

````
[ARCH] MINOR Review public-api.ts exports ReviewReplyPublishFailed and reviewReplyPublishFailed but no external file imports them
  File: src/contexts/review/application/public-api.ts:21,33
  Quote: ```ReviewReplyPublishFailed,
  ...
  reviewReplyPublishFailed,```
  Rule:  Only export what is consumed across context boundaries
  Fix:   Verify notification context handles `review.reply.publish_failed` events via internal handler — if consumed, keep. Otherwise remove from public-api.
````

---

## 4. Context-by-Context Build Shape Audit

| Context      | D4 Shape | Notes                                                                   |
| ------------ | -------- | ----------------------------------------------------------------------- |
| notification | ✅       | `{ publicApi, internal: { repos, useCases } }`                          |
| team         | ✅       | `{ publicApi: {}, internal: { repos: {}, useCases } }`                  |
| staff        | ✅       | `{ publicApi, internal: { repos: { staffAssignmentRepo }, useCases } }` |
| review       | ✅       | `{ publicApi: {}, internal: { repos, useCases } }`                      |
| property     | ✅       | `{ publicApi, internal: { repos: {}, useCases } }`                      |
| **portal**   | ❌       | **Flat return with 8 top-level keys** — needs D4 wrapping               |
| metric       | ✅       | `{ publicApi, internal: { repos: {}, useCases } }`                      |
| integration  | ✅       | `{ publicApi, internal: { repos, useCases } }`                          |
| inbox        | ✅       | `{ publicApi: {}, internal: { repos, useCases } }`                      |
| identity     | ✅       | `{ publicApi: {}, internal: { repos: {}, useCases } }`                  |
| guest        | ✅       | `{ publicApi, internal: { repos, useCases } }`                          |
| **goal**     | ❌       | **Flat return with goalRepo/events at top level** — needs D4 wrapping   |
| dashboard    | ✅       | `{ publicApi, internal: { repos, useCases } }`                          |
| activity     | ✅       | `{ publicApi, internal: { repos, useCases } }`                          |

---

## 5. Root CONTEXT.md Notification Context Verification

Root CONTEXT.md bounded contexts table (lines 26-39) lists 12 contexts:
Identity, Property, Portal, Guest, Team, Staff, Integration, Review, Inbox, Metric, Goal, Dashboard.

**Missing from table:**

- **Notification** — active context with build.ts, CONTEXT.md, server functions, event handlers
- **Activity** — active context with build.ts, CONTEXT.md, server functions, event handlers

Both have full context structure and are wired in `src/composition.ts`. Their omission from the root document is a BLOCKER documentation gap.

---

## 6. NIT findings

`````
[DOC] NIT Root CONTEXT.md says "Twelve bounded contexts" — update to "Fourteen"
  File: CONTEXT.md:5
  Quote: ```Twelve bounded contexts in `src/contexts/````
  Fix:   Update count to 14 after adding Notification and Activity rows.
`````

````
[DOC] NIT Staff CONTEXT.md missing build.test.ts mention
  File: src/contexts/staff/CONTEXT.md:51
  Quote: ```build.ts```
  Fix:   Consider noting `build.test.ts` exists alongside build.ts.
````

````
[DOC] NIT Property CONTEXT.md missing build.test.ts mention
  File: src/contexts/property/CONTEXT.md:49
  Quote: ```build.ts             composition root```
  Fix:   Consider noting `build.test.ts` exists alongside build.ts.
````
