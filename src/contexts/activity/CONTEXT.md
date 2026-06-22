# Activity Context

**Audience:** AI agents and developers working in `src/contexts/activity/`.

## Bounded context

The Activity context records an immutable audit log of user-initiated actions across the application. It is a **pure subscriber context** — it has a single internal use case (`insertActivityLog`), no commands, no mutating server functions. Writes arrive via domain event subscriptions delivered through BullMQ; reads are served through query functions.

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
- **Cross-context** — Activity consumes events from inbox and review contexts. Uses `StaffPublicApi` (staff context) for permission filtering. Actor resolution in the BullMQ worker uses a DB-backed adapter (`db-user-lookup.adapter.ts`) that queries member/user tables directly.

## Invariants

- Activity records are **immutable** — no `updated_at` column, no update operations.
- **Idempotency**: BullMQ delivers at-least-once. A DB-level unique constraint on `(eventId, organizationId)` (`activity_log_event_id_org_uniq`) is the TOCTOU-safe guard. The repository insert catches Postgres error 23505 and treats it as a successful idempotent no-op. A pre-check `findDuplicate` provides a fast path to avoid constructing the domain object on retry.
- Actor identity is **denormalized** at write time: `actorId`, `actorName`, `actorAvatarUrl`, `actorRole` are stored on the activity record to avoid cross-context JOINs at query time.
- Events without a `userId` (truly system-driven) fall back to `actorId: 'system'`.
- Events without a `propertyId` (organization-level actions) carry `propertyId: null`.

## Events produced

None. Activity is a pure subscriber context — it only consumes events, never emits them.

## Events consumed

Events are delivered via **BullMQ**. Each event handler enqueues a job (name `insert-activity-log`) to the shared `default` queue. A BullMQ worker consumes jobs, runs the `insertActivityLog` use case with automatic retry and dead-letter queue.

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
application/     → public-api.ts, use-cases/insert-activity-log.ts
ports/           → activity-repository.port.ts, user-lookup.port.ts, inbox-item-lookup.port.ts
infrastructure/  → activity-repository.drizzle.ts, event-handlers/ (one per tag),
                    adapters/db-user-lookup.adapter.ts, adapters/db-inbox-item-lookup.adapter.ts,
                    jobs/insert-activity-log.job.ts
queries/         → get-activity-timeline.ts, get-org-activity.ts
server/          → activity.ts (server functions for timeline and org-wide fetching)
build.ts
```

## Use cases

| Name                | Input                                                                                     | Output | Permission           |
| ------------------- | ----------------------------------------------------------------------------------------- | ------ | -------------------- |
| `insertActivityLog` | flat fields (action, resourceType, etc.), `deps` (repo, userLookup, clock, logger, idGen) | `void` | system (worker-only) |

`insertActivityLog` is the single write-side use case. Runs inside the BullMQ worker. Handles idempotency (duplicate check), user resolution, domain construction, and persistence.

## Public API

Exported from `application/public-api.ts`:

- Re-exports: `ActivityLog`, `ActivityAction`, `ResourceType`, `ActivityPayload`
- Interface: `ActivityPublicApi` (with `getActivityTimeline`, `getOrgActivity` method signatures)

## Server functions

| Name                  | Method | Permission   | Description                                        |
| --------------------- | ------ | ------------ | -------------------------------------------------- |
| `getActivityTimeline` | GET    | `inbox.read` | Fetch activity timeline for a resource (paginated) |
| `getOrgActivity`      | GET    | `inbox.read` | Fetch organization-wide activity feed (paginated)  |

## Permissions

Mirrors existing inbox access:

- **Admin** (`can(role, 'inbox.manage')`): sees all activity for the organization.
- **PM / Staff**: scoped to properties they can access via `staffPublicApi.getAccessiblePropertyIds()`.
- Activity entries with `propertyId: null` (system-level actions) are visible to all roles.
- Permissions are enforced in the `getActivityTimeline` and `getOrgActivity` query functions.

## Testing

| Layer                  | Type                      | Coverage                                  |
| ---------------------- | ------------------------- | ----------------------------------------- |
| Domain constructor     | Pure unit                 | ✓ `constructors.test.ts`                  |
| Query functions        | Unit with in-memory fakes | ✓ `queries/get-activity-timeline.test.ts` |
| DB user lookup adapter | Unit with mock db         | Pending                                   |
| Event handlers         | Unit with mock repo       | Pending                                   |
| Drizzle repository     | Integration vs Postgres   | Pending                                   |
