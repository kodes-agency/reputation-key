---
status: accepted
date: 2026-07-15
---

# 0046 — Notification Policy: Categories, Channels, and Preferences

## Context

Notification preferences, coalescing, delivery timing, and durable routing need
one policy. The old schema mixed event identity with unread-resource identity
and treated missing preferences as approval for both channels.

## Decision

The four categories are `mandatory`, `urgent_operational`,
`workflow_collaboration`, and `recognition`. A daily digest is an optional
cadence, not a fifth category. Mandatory account/security/legal notices are
Organization policy and never create Property preference rows.

| Category               | In-app              | Email                                      |
| ---------------------- | ------------------- | ------------------------------------------ |
| Mandatory              | Required            | Required when the notice requires it       |
| Urgent operational     | Responsible users   | Explicitly responsible; bounded quiet-hour |
| Workflow collaboration | Default on          | Opt-in                                     |
| Recognition            | Private, default on | Opt-in                                     |

Rules:

1. Missing rows resolve through versioned defaults, never “both on.”
2. Coalesce one unread item per `(user, type, resource)` while retaining
   delivery/event evidence; event ID is not the uniqueness key.
3. Use the user IANA timezone with Organization fallback and test DST.
4. A multi-Property user receives one digest in their chosen timezone.
5. Application idempotency outlives the provider's 24-hour dedupe window.
6. Delivery moves through `pending → accepted →
delivered|delayed|bounced|complained|failed|suppressed|cancelled`.
7. Optional mail links to preferences; operational mail has no marketing.
8. Payload parsing admits only Property/resource/status metadata and excludes
   Review text, Guest text/media, sensitive scores, and other employees' data.

The unsubscribe guard takes `MailClass = 'mandatory' | 'optional'`; a digest is
always optional. Copy renders from `type` plus the closed payload at read time,
so template corrections reach every channel and historical row.

## Merged from ADR 0011

Notification jobs are bounded inserts (`insert-notification`) or single sends
(`urgent-email`) on the shared `default` BullMQ queue. They use its concurrency,
rate limiting, retry, and durable outbox authority; no dedicated queue exists.

## Merged from ADR 0022

Every action notification resolves to its Inbox item at creation and stores
`resourceType: 'inbox_item'` / `resourceId: <inboxItemId>`. Review notification
subscribes to `inbox.inbox_item.created`, after the item exists. Reply routing
resolves `reviewId → inboxItemId` through `InboxItemLookupPort`. The only action
URL is `/inbox?itemId=<id>`; a hard-deleted unresolved item is skipped.

## Amended 2026-09-21 — imported Google history does not notify

A Review whose Inbox Item's first Handling Cycle was observed as
`historical_onboarding`, Google history an import brought in (ADR 0055,
`docs/operations/inbox-response-targets.md`), produces no `review.created`
notification. A single import once announced 260 past reviews as new for one
Property; history is not news, and ADR 0058 paces its AI work for the same
reason. Only the history an import takes over is `historical_onboarding`: what
a relink finds from while the Property was disconnected, and a review Google
lists only after the import's history was listed in full, are `legacy_unknown`.
Reviews observed as ongoing (`measured`) or `legacy_unknown` notify as before, a
later material revision still notifies as `review.updated`, and private
feedback is unaffected. The shared fan-out reads the fact through
`InboxItemLookupPort`, and missing-notification repair applies the same
predicate: such an item is never a gap, so the sweep does not re-create its
notification and `notification.missing_for_inbox_item` does not count it.

## Amended 2026-09-22 — repair replays unsettled deliveries

A durable delivery is settled when its materialization receipt is claimed in
the transaction that decides it: a row, preferences that asked for none, or a
recipient who no longer qualifies (obsolete). The missing-notification repair
works from that evidence for every beta route, not from inbox items without a
row: a delivery whose enqueue receipt has no materialization receipt five
minutes on is replayed through its route's own consumer, under the source
fact's event id and delivery marker, and only deliveries still unsettled are
queued, each under an id of its own. A recipient who muted a type is settled,
so the repair never re-announces the review, and
`notification.missing_for_inbox_item` counts only items whose delivery is not
yet decided. The previous sweep minted an event id no outbox row carried, so
its receipts and settlements could never be written.

## Consequences

- Missing preferences cannot silently enable email.
- Resource coalescing and durable idempotency prevent duplicate delivery.
- Recognition email requires explicit opt-in.
- Provider/capability admission remains the outbound activation authority.

## Rejected alternatives

- Default-on optional email sends without deliberate consent.
- Event-ID uniqueness defeats resource-level coalescing.
