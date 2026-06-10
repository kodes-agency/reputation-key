# Notification Context — CONTEXT.md

## Responsibility

Produces user-facing in-app and email notifications about domain events. Subscribes to events from other contexts, resolves recipients, creates notification rows, and manages email delivery (urgent: immediate, normal: daily digest).

## Layer structure

```
server/       → createServerFn wrappers (queries + mutations)
application/  → use cases, ports, public-api barrel
domain/       → types, constructors, errors, isUrgent
infrastructure/
  event-handlers/  → subscribe to domain events, enqueue BullMQ jobs
  jobs/            → BullMQ workers (insert-notification, digest, urgent-email)
  adapters/        → cross-context lookup adapters (user, property)
  repositories/    → Drizzle implementations of ports
queries/      → read-only queries (list, count)
```

## Key decisions

- **BullMQ delivery** (ADR 0011) — handlers enqueue jobs, workers insert rows
- **Two tables** — `notifications` (in-app) + `notification_email_queue` (email) with separate lifecycles
- **Title/body pre-rendered** at insertion time (Q19)
- **Three urgent types**: `reply.pending_approval`, `reply.publish_failed`, `inbox.escalated` (Q9)
- **No `goal.progress_updated` handler** — only `goal.completed` is notification-worthy (Q14)
- **Digest keyed by property timezone** (already on properties table), not org timezone (Q8)
- **Notification type names distinct from event tags** (Q4)

## Notification types (11)

| Type                     | Event tag                                         | Priority | Resource type |
| ------------------------ | ------------------------------------------------- | -------- | ------------- |
| `review.created`         | `review.created`                                  | normal   | `inbox_item`  |
| `feedback.created`       | `inbox.inbox_item.created` (filtered to feedback) | normal   | `inbox_item`  |
| `reply.pending_approval` | `review.reply.submitted`                          | urgent   | `reply`       |
| `reply.approved`         | `review.reply.approved`                           | normal   | `reply`       |
| `reply.rejected`         | `review.reply.rejected`                           | normal   | `reply`       |
| `reply.published`        | `review.reply.published`                          | normal   | `reply`       |
| `reply.publish_failed`   | `review.reply.publish_failed`                     | urgent   | `reply`       |
| `inbox.escalated`        | `inbox.inbox_item.escalated`                      | urgent   | `inbox_item`  |
| `inbox.assigned`         | `inbox.inbox_item.assigned`                       | normal   | `inbox_item`  |
| `inbox_note.added`       | `inbox.inbox_note.added`                          | normal   | `inbox_item`  |
| `goal.completed`         | `goal.completed`                                  | normal   | `goal`        |

## Cross-context dependencies

- **Identity** — user lookup (email, role) via `UserLookupPort`
- **Property** — property timezone for digest via existing property schema
- **Staff** — property assignments for recipient resolution via `UserLookupPort`
- **All event-producing contexts** — event type imports via `public-api.ts`

## Ports

- `NotificationRepositoryPort` — CRUD for notifications
- `NotificationEmailRepositoryPort` — email queue management
- `NotificationPreferenceRepositoryPort` — preference CRUD
- `UserLookupPort` — `findByRole()`, `findAssignedManagers()`, `getEmail()`
- `EmailSenderPort` — wraps Resend `sendEmail()`
