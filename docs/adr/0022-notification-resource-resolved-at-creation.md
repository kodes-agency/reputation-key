# 0022 — Notification resource resolved to the inbox item at creation

**Status:** accepted

## Context

Clicking a reply-lifecycle (`reply.pending_approval` / `rejected` / …) or new-review notification did nothing useful: it built `/inbox?itemId=<id>` where `<id>` was a `replyId` or `reviewId`, not an inbox-item id, so no item matched. The `resourceId` column was a polymorphic FK that stored a different id type per handler, and `resourceType` was sometimes dishonest (`review.created` stamped `resourceType: 'inbox_item'` with a `reviewId`).

## Decision

Every action-oriented notification resolves to its **inbox item at creation time** and stores `resourceType: 'inbox_item'` / `resourceId: <inboxItemId>`, uniformly. Reviews achieve this by subscribing the review notification to `inbox.inbox_item.created` (which carries the `inboxItemId` and fires _after_ the item exists — no race), enriched with `rating`/`snippet` so the body derives fully. Replies resolve `reviewId → inboxItemId` through a new `InboxItemLookupPort` (the inbox item always exists by reply time). `getNotificationUrl` collapses to one branch: `/inbox?itemId=<id>`. Notifications whose inbox item cannot be resolved (hard-deleted) are skipped.

## Why

Honest, race-free, and zero click-time lookup — the deep link is a trivial one-liner and the notification _type_ tells you what happened while the _resource_ tells you where to go.

## Considered options

- **Resolve at click time** (keep storing natural ids, look up on click) — rejected: adds a click-time server call, fights the TanStack Query cache (stale `reply:null`-style bugs), and offers no upside.
- **Enrich the `reply.*` events with `inboxItemId`** — rejected: leaks the inbox concept into the review context, violating context boundaries (ADR 0008).
- **Store a precomputed route (`href`) on the notification** — rejected: routes are a UI concern; would leak presentation into the domain row and break when routes change.

## Consequences

- The notification context gains one cross-context read port (`InboxItemLookupPort`) — consistent with the existing `UserLookupPort` convention.
- The `inbox.inbox_item.created` event payload widens (additive `rating`/`snippet`); other consumers (activity log) can use them.
- Legacy rows created before this change keep their broken ids; `getNotificationUrl` falls back to `/inbox` for them rather than matching nothing. No backfill (notifications are transient; users clear them).
