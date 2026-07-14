# Phase 11 — Unified Inbox: Implementation Spec

> **Status:** Design complete, implementation pending.
> **Decisions documented in:** `docs/adr/0004-inbox-bounded-context.md`, `src/contexts/inbox/CONTEXT.md`.

## Goal

Managers see all reviews and all private feedback in a single unified list. They can filter, sort, mark as read, escalate, add internal notes, assign items, and open individual items to see details with a chat-like thread for notes and replies.

## Design Decisions Summary

| Decision        | Resolution                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| Bounded context | New `contexts/inbox/`                                                           |
| Data model      | Hybrid denormalization — filter/sort cols in `inbox_items`, detail via JOIN     |
| Status workflow | `new → read → addressed → archived`, `escalated` sidetrack, un-archive → `read` |
| Sources         | Reviews + feedback (with joined rating). No bare ratings.                       |
| Category        | Skip for Phase 11 (Arc 7)                                                       |
| Internal notes  | `inbox_notes` table (`id`, `inboxItemId`, `authorUserId`, `text`, `createdAt`)  |
| Assignment      | PM+ only, must have property access, reassignable, status unchanged on assign   |
| Sort            | Newest first, no default filter, unread badge (Redis-cached)                    |
| Pagination      | Forward-only cursor `(sourceDate DESC, id)`                                     |
| Route           | `/inbox` top-level                                                              |
| Events          | `inbox.item.created`, `inbox.status.changed`, `inbox.item.assigned`             |
| UI layout       | Email split (list \| detail), chat-like thread in detail panel                  |

## Scope (in)

### Database

- `shared/db/schema/inbox.schema.ts` — Drizzle schema for `inbox_items` and `inbox_notes` tables
- `inbox_items` columns:
  - `id` (uuid, PK)
  - `organizationId` (varchar, not null)
  - `propertyId` (varchar, not null)
  - `sourceType` (enum: `'review'` | `'feedback'`)
  - `sourceId` (uuid, not null)
  - `status` (enum: `'new'` | `'read'` | `'addressed'` | `'escalated'` | `'archived'`)
  - `rating` (integer, nullable — denormalized from review or feedback's linked rating)
  - `sourceDate` (timestamp, not null — denormalized `reviewedAt` or feedback `createdAt`)
  - `platform` (varchar, nullable — `'google'` for reviews, null for feedback)
  - `snippet` (text, nullable — first ~200 chars of review text or feedback comment)
  - `assignedTo` (varchar, nullable — user ID)
  - `readAt` (timestamp, nullable)
  - `escalatedAt` (timestamp, nullable)
  - `addressedAt` (timestamp, nullable)
  - `archivedAt` (timestamp, nullable)
  - `createdAt` (timestamp)
  - `updatedAt` (timestamp)
- Indexes: `(organizationId, status)`, `(organizationId, sourceDate DESC, id)`, `(propertyId)`, `(sourceType, sourceId)` unique
- `inbox_notes` columns:
  - `id` (uuid, PK)
  - `inboxItemId` (uuid, FK → inbox_items, cascade)
  - `organizationId` (varchar, not null)
  - `authorUserId` (varchar, not null)
  - `text` (text, not null)
  - `createdAt` (timestamp)

### Domain Layer

- `contexts/inbox/domain/types.ts` — `InboxItem`, `InboxNote`, `InboxStatus`, `SourceType`
- `contexts/inbox/domain/rules.ts` — status transition validation, assignment eligibility
- `contexts/inbox/domain/constructors.ts` — `createInboxItem`, `createInboxNote`
- `contexts/inbox/domain/events.ts` — `inbox.item.created`, `inbox.status.changed`, `inbox.item.assigned`
- `contexts/inbox/domain/errors.ts` — tagged errors for invalid transitions, assignment violations

### Application Layer

- `contexts/inbox/application/ports/inbox.repository.ts` — CRUD + filtered/paginated queries
- `contexts/inbox/application/ports/inbox-note.repository.ts` — notes CRUD
- `contexts/inbox/application/ports/unread-counter.port.ts` — Redis unread count operations
- `contexts/inbox/application/dto/inbox.dto.ts` — Zod schemas for filters, pagination, actions
- `contexts/inbox/application/use-cases/get-inbox-items.ts` — paginated filtered list
- `contexts/inbox/application/use-cases/get-inbox-item-detail.ts` — single item with source JOIN
- `contexts/inbox/application/use-cases/update-inbox-status.ts` — status transition
- `contexts/inbox/application/use-cases/bulk-update-status.ts` — bulk mark read / addressed / archived
- `contexts/inbox/application/use-cases/assign-inbox-item.ts` — assign / reassign
- `contexts/inbox/application/use-cases/add-inbox-note.ts` — add internal note
- `contexts/inbox/application/use-cases/get-unread-count.ts` — unread badge count

### Infrastructure Layer

- `contexts/inbox/infrastructure/repositories/inbox.repository.ts` — Drizzle implementation
- `contexts/inbox/infrastructure/repositories/inbox-note.repository.ts` — Drizzle implementation
- `contexts/inbox/infrastructure/mappers/inbox.mapper.ts` — row ↔ domain
- `contexts/inbox/infrastructure/mappers/inbox-note.mapper.ts` — row ↔ domain
- `contexts/inbox/infrastructure/adapters/redis-unread-counter.ts` — Redis unread count
- `contexts/inbox/infrastructure/event-handlers/handle-review-created.ts` — creates inbox item from `review.created`
- `contexts/inbox/infrastructure/event-handlers/handle-feedback-submitted.ts` — creates inbox item from `feedback.submitted`
- `contexts/inbox/infrastructure/event-handlers/handle-review-updated.ts` — syncs denormalized fields on `review.updated`
- `contexts/inbox/build.ts` — factory function

### Server Layer

- `contexts/inbox/server/inbox.ts` — server functions:
  - `getInboxItems` (GET, paginated, filtered)
  - `getInboxItemDetail` (GET, single item)
  - `updateInboxStatus` (POST)
  - `bulkUpdateStatus` (POST)
  - `assignInboxItem` (POST)
  - `addInboxNote` (POST)
  - `getUnreadCount` (GET)

### Frontend

- Route: `src/routes/_authenticated/inbox.tsx` — inbox layout route
- Route: `src/routes/_authenticated/inbox/index.tsx` — inbox list (redirect or inline)
- Components:
  - `src/components/features/inbox/inbox-list.tsx` — filterable, sortable list with checkboxes
  - `src/components/features/inbox/inbox-item-row.tsx` — single row in the list
  - `src/components/features/inbox/inbox-detail-panel.tsx` — right-side detail view
  - `src/components/features/inbox/inbox-note-thread.tsx` — chat-like notes thread
  - `src/components/features/inbox/inbox-filter-bar.tsx` — filters: property, rating, status, platform, date range, source type
  - `src/components/features/inbox/inbox-bulk-actions.tsx` — bulk action toolbar
  - `src/components/features/inbox/inbox-unread-badge.tsx` — nav badge component
- Layout: email split (list | detail panel), existing app sidebar on left
- Detail panel interior: chat-like thread for notes (newest at bottom, input at bottom)

### Tests

- Domain: status transition rules (all valid + invalid paths), assignment eligibility
- Use cases: happy + error for each use case
- Repositories: integration tests with real Postgres, tenant isolation test
- Event handlers: inbox item creation on `review.created` and `feedback.submitted`
- E2E: manager logs in → sees inbox → filters to 2-star reviews → marks one as read → escalates another

## Scope (out)

- Reply creation/approval/publishing (Phase 12)
- Sentiment badges (Arc 7)
- Priority score (Arc 7)
- Feedback category (Arc 7)
- Export to CSV (Arc 8)
- Notifications for escalation (Phase 19)

## Status Transition Graph

```
new ──────→ read ──────→ addressed ──→ archived
│            │                          ↑
│            └──→ escalated ───────────┤
│                   │                  │
└───────────────────┘                  │
                                       │
archived ──→ read (un-archive) ────────┘
```

Valid transitions:

| From      | To        | Trigger                                 |
| --------- | --------- | --------------------------------------- |
| new       | read      | Manager opens/views the item            |
| new       | archived  | Bulk archive untouched items            |
| new       | escalated | Direct escalate (urgent review)         |
| read      | addressed | Manual: manager marks as handled        |
| read      | escalated | Manager escalates                       |
| escalated | addressed | Handled (reply published or note added) |
| escalated | archived  | Manager archives                        |
| addressed | archived  | Manager archives                        |
| archived  | read      | Manager un-archives                     |

## Gate Criteria

- Manager can see all reviews and feedback in one list, sortable and filterable
- Status transitions enforced (invalid transitions rejected with clear error)
- Bulk actions work on multiple selected items
- Pagination handles 1000+ items with cursor-based pagination (tested)
- Tenant isolation: inbox only shows items from current organization
- Role check: Staff sees items for assigned properties; PM sees assigned properties; AccountAdmin sees all
- Assignment: PM+ only, assignee must have property access
- Internal notes save with correct author and timestamp
- Unread badge updates when items change status
- E2E test: manager logs in → sees inbox with test data → filters to 2-star reviews → marks one as read → escalates another → adds a note → verifies badge count updated

## Open questions for implementation

- Whether "addressed" auto-transitions when a reply is published (deferred to Phase 12)
- Bulk action semantics: atomic vs best-effort (recommend best-effort with partial success report)
- Redis key structure for unread count (recommend `inbox:unread:{organizationId}:{userId}`)
