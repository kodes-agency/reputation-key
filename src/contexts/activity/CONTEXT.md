# Activity Context

**Audience:** AI agents and developers working in `src/contexts/activity/`.

## Bounded context

The Activity context records an immutable audit log of user-initiated actions across the application. It is a **pure subscriber context** — it has no use cases, no commands, no server functions that mutate state. Writes arrive via domain event subscriptions; reads are served through query functions.

Layer: **Thin (subscriber)**. Like the metric context, the activity context is event-driven, not request-driven.

Key entities: `ActivityLog`

## Architecture

```
domain/    → types.ts, constructors.ts, errors.ts (no events — doesn't emit)
application/ → event-to-activity.ts (mapping), public-api.ts
ports/       → activity-repository.port.ts, user-lookup.port.ts
infrastructure/ → drizzle repo, event-handlers/, adapters/
queries/    → get-activity-timeline.ts, get-org-activity.ts
server/     → activity.ts (server function for timeline fetching)
```

- **No `application/use-cases/`** — the activity context is write-only via event subscription, read-only via queries. This is deliberate, per Q16.
- **No `domain/events.ts`** — the activity context doesn't produce domain events. It only consumes them from other contexts.

## Glossary

| Term                  | Definition                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ActivityLog**       | An immutable record of a single user action. Stored in the `activity_log` table.                                                                                      |
| **ActivityAction**    | A verb from the fixed vocabulary: `created`, `changed`, `deleted`, `assigned`, `unassigned`, `published`, `rejected`, `approved`, `submitted`, `added`, `escalated`   |
| **Action Grammar**    | Uniform payload format: `{ subject, from, to, detail, bulkId? }`. All activity entries use this structure, regardless of entity type (GitHub/AWS CloudTrail pattern). |
| **Activity Timeline** | Chronological display of all activity for a specific resource (e.g., an inbox item). Sourced from activity log queries with permission filtering.                     |
| **ResourceType**      | The kind of entity an action affects: `inbox_item`, `review`, `reply`, `note`, `property`, `member`                                                                   |

## Event delivery

Events are consumed **in-process** via `eventBus.on()`. This is a deliberate trade-off:

- **Why in-process:** Simpler deployment, no BullMQ infrastructure needed, matches the metric context's subscriber pattern. The event bus already catches handler errors and logs them.
- **Risk:** If the process crashes during handler execution, the activity entry is lost. The original use case (e.g., status change) already committed — only the audit trail is affected.
- **Mitigation:** Handlers are idempotent (`findDuplicate` check before insert). If durability becomes a requirement, migrate to BullMQ-backed delivery per the original Q12 intent. The `CONTEXT.md` decision documents this path.

## Event mapping (Q14)

The `eventToActivity` function maps domain events to activity log entries:

| Event tag                   | action       | resourceType | Notes                                             |
| --------------------------- | ------------ | ------------ | ------------------------------------------------- |
| `inbox.item.created`        | `created`    | `inbox_item` | payload.detail = sourceType                       |
| `inbox.status.changed`      | `changed`    | `inbox_item` | payload.from/to = old/new status                  |
| `inbox.item.escalated`      | `escalated`  | `inbox_item` | Supplementary event alongside status.changed      |
| `inbox.item.assigned`       | `assigned`   | `inbox_item` | payload.to = assignee                             |
| `inbox.item.unassigned`     | `unassigned` | `inbox_item` | payload.from = previous assignee                  |
| `inbox.note.added`          | `added`      | `note`       | payload.detail = note text (truncated)            |
| `inbox.bulk.status.changed` | `changed`    | `inbox_item` | payload.bulkId links items in same bulk operation |
| `reply.published`           | `published`  | `reply`      |                                                   |
| `reply.submitted`           | `submitted`  | `reply`      |                                                   |
| `reply.approved`            | `approved`   | `reply`      |                                                   |
| `reply.rejected`            | `rejected`   | `reply`      | payload.detail = rejection reason                 |

**Excluded events:** `review.created`, `review.updated`, `review.expired`, `cache.invalidated`, `item.read`, `metric.recorded` — these are either system-internal or auto-generated and don't represent user-initiated actions.

## Permission model (Q11)

Mirrors existing inbox access:

- **Admin** (`can(role, 'inbox.manage')`): sees all activity for the organization
- **PM/Staff**: scoped to properties they can access via `staffPublicApi.getAccessiblePropertyIds()`
- Activity entries with `propertyId: null` (system-level actions) are visible to all roles

Implemented in `getActivityTimeline` and `getOrgActivity` query functions.

## Schema (Q13)

Table: `activity_log` (in `shared/db/schema/activity.schema.ts`)

Columns: `id` (UUID PK), `actor_id`, `actor_name`, `actor_avatar_url`, `actor_role`, `action`, `resource_type`, `resource_id`, `property_id` (nullable), `organization_id`, `payload` (JSONB), `source`, `created_at`

Indexes:

- `activity_log_resource_idx`: `(resource_type, resource_id, created_at)` — timeline lookups
- `activity_log_org_property_idx`: `(organization_id, property_id, created_at)` — org-wide feeds with property filtering
- `activity_log_actor_idx`: `(actor_id, created_at)` — user activity views

**Immutable** — no `updated_at` column. Activity records are never modified.

## Dependency rules

- `domain/` imports only from itself and `shared/domain/`
- `application/` imports from `domain/`, `shared/domain/`, `shared/events/` (for `DomainEvent` type)
- `infrastructure/` imports from `domain/`, `application/`, `shared/`, external libs
- `server/` imports from `application/`, `shared/`, TanStack Start
- Cross-context: imports from `staff/application/public-api` (for `StaffPublicApi`) and `identity/application/ports/identity.port` (for user lookup adapter)

## User name resolution (Q9)

Actor names and avatars are **denormalized** at write time. The `UserLookupPort` adapter resolves real user identity via the identity context's `getMember()` call. Falls back to `'System'` with `Staff` role on failure. This avoids cross-context JOINs at query time.

## Testing

| Layer              | Type                      | Coverage                                  |
| ------------------ | ------------------------- | ----------------------------------------- |
| Domain constructor | Pure unit                 | ✓ `constructors.test.ts`                  |
| Event mapping      | Pure unit                 | ✓ `application/event-to-activity.test.ts` |
| Query functions    | Unit with in-memory fakes | ✓ `queries/get-activity-timeline.test.ts` |
| Identity adapter   | Unit with mock port       | Pending                                   |
| Event handlers     | Unit with mock repo       | Pending                                   |
| Drizzle repository | Integration vs Postgres   | Pending                                   |

## Related docs

- Inbox context: `src/contexts/inbox/CONTEXT.md` (Q12-Q16 decisions)
- Root: `CONTEXT.md` (bounded contexts table)
- Layer guide: `src/contexts/CONTEXT.md` (four-layer architecture)
