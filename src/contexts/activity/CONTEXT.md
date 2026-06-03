# Activity Context

**Audience:** AI agents and developers working in `src/contexts/activity/`.

## Bounded context

The Activity context records an immutable audit log of user-initiated actions across the application. It is a **pure subscriber context** — it has no use cases, no commands, no server functions that mutate state. Writes arrive via domain event subscriptions via BullMQ; reads are served through query functions.

Layer: **Thin (subscriber)**. Like the metric context, the activity context is event-driven, not request-driven.

Key entity: `ActivityLog`

## Glossary

| Term                  | Definition                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ActivityLog**       | An immutable record of a single user action. Stored in the `activity_log` table.                                                                                      |
| **ActivityAction**    | A verb from the fixed vocabulary: `created`, `changed`, `deleted`, `assigned`, `unassigned`, `published`, `rejected`, `approved`, `submitted`, `added`, `escalated`.  |
| **Action Grammar**    | Uniform payload format: `{ subject, from, to, detail, bulkId? }`. All activity entries use this structure, regardless of entity type (GitHub/AWS CloudTrail pattern). |
| **Activity Timeline** | Chronological display of all activity for a specific resource (e.g., an inbox item). Sourced from activity log queries with permission filtering.                     |
| **ResourceType**      | The kind of entity an action affects: `inbox_item`, `review`, `reply`, `note`, `property`, `member`.                                                                  |

## Relationships

- **ActivityLog → Organization** (N:1 via `organizationId`) — Every activity entry is scoped to an organization.
- **ActivityLog → Property** (N:1 via `propertyId`, nullable) — Property-scoped actions carry a property reference. Organization-level actions use `null`.
- **Cross-context** — Activity consumes events from inbox and review contexts. Uses `StaffPublicApi` (staff context) for permission filtering and `IdentityPort` (identity context) for actor name/avatar resolution.

## Invariants

- Activity records are **immutable** — no `updated_at` column, no update operations.
- **Idempotency**: BullMQ delivers at-least-once. The `insertActivityLog` use case includes a `findDuplicate` check matching `(resourceType, resourceId, action, organizationId, payload)` to prevent duplicate entries on job retry.
- Actor identity is **denormalized** at write time: `actorId`, `actorName`, `actorAvatarUrl`, `actorRole` are stored on the activity record to avoid cross-context JOINs at query time.
- Events without a `userId` (truly system-driven) fall back to `actorId: 'system'`.
- Events without a `propertyId` (organization-level actions) carry `propertyId: null`.

## Events produced

None. Activity is a pure subscriber context — it only consumes events, never emits them.

## Events consumed

Events are delivered via **BullMQ**. Each event handler enqueues a job to a shared `activity-log` queue. A BullMQ worker consumes jobs, runs the `insertActivityLog` use case with automatic retry and dead-letter queue.

Handlers live in `infrastructure/event-handlers/` — one file per event tag:

```
infrastructure/event-handlers/
  on-inbox-item-created.ts
  on-inbox-status-changed.ts
  on-inbox-item-escalated.ts
  on-inbox-item-assigned.ts
  on-inbox-item-unassigned.ts
  on-inbox-note-added.ts
  on-inbox-bulk-status-changed.ts
  on-reply-published.ts
  on-reply-submitted.ts
  on-reply-approved.ts
  on-reply-rejected.ts
  index.ts                         (registerActivityHandlers)
```

Each handler:

- Is typed to its specific event (no `DomainEvent` union import, no switch)
- Maps event fields directly to a job payload
- Enqueues the job via `deps.queue.add('insert-activity-log', payload)`
- Is registered individually in `index.ts` via `deps.events.on(tag, handler)`

| Tag                                    | Source Context | Action       | ResourceType |
| -------------------------------------- | -------------- | ------------ | ------------ |
| `inbox.inbox_item.created`             | inbox          | `created`    | `inbox_item` |
| `inbox.inbox_item.status_changed`      | inbox          | `changed`    | `inbox_item` |
| `inbox.inbox_item.escalated`           | inbox          | `escalated`  | `inbox_item` |
| `inbox.inbox_item.assigned`            | inbox          | `assigned`   | `inbox_item` |
| `inbox.inbox_item.unassigned`          | inbox          | `unassigned` | `inbox_item` |
| `inbox.inbox_note.added`               | inbox          | `added`      | `note`       |
| `inbox.inbox_item.bulk_status_changed` | inbox          | `changed`    | `inbox_item` |
| `review.reply.published`               | review         | `published`  | `reply`      |
| `review.reply.submitted`               | review         | `submitted`  | `reply`      |
| `review.reply.approved`                | review         | `approved`   | `reply`      |
| `review.reply.rejected`                | review         | `rejected`   | `reply`      |

**Required event fields:** Every consumed event must carry `propertyId`, `userId`, and `source` (`'web'` | `'import'`). Mapping is done inline in each handler — no shared mapper function.

**Excluded events:** `review.created`, `review.updated`, `review.expired`, `cache.invalidated`, `metric.recorded`. These are system-internal or auto-generated.

## Architecture layers

```
domain/          → types.ts, constructors.ts, errors.ts (no events — doesn't emit)
application/     → public-api.ts, event-to-activity.ts
ports/           → activity-repository.port.ts, user-lookup.port.ts
infrastructure/  → activity-repository.drizzle.ts, event-handlers/ (one per tag),
                    adapters/identity-user-lookup.adapter.ts, jobs/ (BullMQ worker)
queries/         → get-activity-timeline.ts, get-org-activity.ts
server/          → activity.ts (server function for timeline fetching)
build.ts
```

## Use cases

| Name                | Input                                      | Output | Permission           |
| ------------------- | ------------------------------------------ | ------ | -------------------- |
| `insertActivityLog` | `event`, `deps` (repo, userLookup, logger) | `void` | system (worker-only) |

`insertActivityLog` is the single write-side use case. Runs inside the BullMQ worker. Handles idempotency (duplicate check), user resolution, domain construction, and persistence.

## Public API

Exported from `application/public-api.ts`:

- Types: `ActivityLog`, `ActivityAction`, `ResourceType`, `ActivityPayload`
- Query: `ActivityTimelineQuery`, `OrgActivityQuery`

## Server functions

| Name                  | Method | Permission      | Description                                        |
| --------------------- | ------ | --------------- | -------------------------------------------------- |
| `getActivityTimeline` | GET    | `activity:read` | Fetch activity timeline for a resource (paginated) |
| `getOrgActivity`      | GET    | `activity:read` | Fetch organization-wide activity feed (paginated)  |

## Permissions

Mirrors existing inbox access:

- **Admin** (`can(role, 'inbox.manage')`): sees all activity for the organization.
- **PM / Staff**: scoped to properties they can access via `staffPublicApi.getAccessiblePropertyIds()`.
- Activity entries with `propertyId: null` (system-level actions) are visible to all roles.
- Permissions are enforced in the `getActivityTimeline` and `getOrgActivity` query functions.

## Schema

Table: `activity_log` (in `shared/db/schema/activity.schema.ts`)

| Column             | Type            | Notes                                                    |
| ------------------ | --------------- | -------------------------------------------------------- |
| `id`               | UUID PK         | Generated by use case                                    |
| `actor_id`         | text            | User ID or `'system'`                                    |
| `actor_name`       | text            | Denormalized at write time                               |
| `actor_avatar_url` | text            | Denormalized at write time                               |
| `actor_role`       | text            | Denormalized at write time                               |
| `action`           | text            | From `ActivityAction` vocabulary                         |
| `resource_type`    | text            | From `ResourceType` vocabulary                           |
| `resource_id`      | text            | ID of the affected entity                                |
| `property_id`      | text (nullable) | Property scope; null for org-level actions               |
| `organization_id`  | text            | Tenant scope                                             |
| `payload`          | JSONB           | Action grammar: `{ subject, from, to, detail, bulkId? }` |
| `source`           | text            | `'web'` or `'import'`                                    |
| `created_at`       | timestamp       | Immutable — no `updated_at` column                       |

Indexes:

- `activity_log_resource_idx`: `(resource_type, resource_id, created_at)` — timeline lookups
- `activity_log_org_property_idx`: `(organization_id, property_id, created_at)` — org-wide feeds
- `activity_log_actor_idx`: `(actor_id, created_at)` — user activity views

## Dependencies

- `domain/` imports only from itself and `shared/domain/`
- `application/` imports from `domain/`, `shared/domain/`, `shared/events/`
- `infrastructure/` imports from `domain/`, `application/`, `shared/`, external libs
- `server/` imports from `application/`, `shared/`, TanStack Start
- Cross-context: imports `StaffPublicApi` from `staff/application/public-api` and `IdentityPort` from `identity/application/ports/identity.port`

## Testing

| Layer              | Type                      | Coverage                                  |
| ------------------ | ------------------------- | ----------------------------------------- |
| Domain constructor | Pure unit                 | ✓ `constructors.test.ts`                  |
| Query functions    | Unit with in-memory fakes | ✓ `queries/get-activity-timeline.test.ts` |
| Identity adapter   | Unit with mock port       | Pending                                   |
| Event handlers     | Unit with mock repo       | Pending                                   |
| Drizzle repository | Integration vs Postgres   | Pending                                   |
