---
status: accepted
date: 2026-09-14
---

# 0057 — Inbox queues

## Context

The Inbox sidebar exposed storage-oriented folders while the working list also
needed reply workflow, assignment, and escalation views. Reply state is owned
by Review and is not denormalized onto `inbox_items`, so neither list membership
nor counts can safely infer it from Inbox columns. Counts must also remain equal
to the list total under tenant, Property, and source-permission scoping.

## Decision

1. Inbox exposes eight queue keys: `reply`, `approval`, `waiting`, `feedback`,
   `escalated`, `mine`, `closed`, and `open`.
2. Reply-capable callers use `reply` for open Reviews outside an awaiting or
   waiting stage, `approval` for open Reviews pending approval, and `waiting`
   for open approved or published Replies. Callers without `reply.manage`, or
   callers for whom the independent `property.publish_reply` capability is
   unavailable, use `open`; the three reply-stage queues are unavailable and
   their counts are returned as `null`. The optional projection uses a
   non-throwing `ExecutionPolicy` decision so permission, capability, and
   Property scope remain one decision without making the base Inbox fail.
3. `feedback`, `mine`, and `closed` select open private feedback, open items
   assigned to the viewer, and closed items respectively. `escalated` is
   cross-cutting and selects every active unresolved escalation. `open` selects
   every open visible item.
4. The URL contract is `queue=`. Legacy folder URLs are translated at the
   client boundary during the workspace migration.
5. Review supplies content-free effective Reply stage candidates through an
   Inbox-owned lookup port. Internal Reply state takes precedence over a
   `google_sync` mirror for the same Review. Inbox turns the resulting Review
   ID sets into positive or negative repository predicates.
6. `countFiltered` and `findFilteredPaginated` resolve the same governed
   predicates. Queue counts are therefore the list's own `totalCount`, not a
   separately interpreted aggregate.

## Consequences

- A manager request performs one content-free Review stage lookup and eight
  Inbox counts. The existing Review organization and Review-ID indexes are used;
  a Reply organization/status index is deferred until measured query plans show
  it is needed.
- Inbox adds an organization/assignee index for the `mine` predicate.
- Reply workflow transitions invalidate both list and queue-count caches.
- Disabling reply publication cannot make the Inbox unavailable: reply-stage
  navigation falls back to `open`, while non-reply queues and counts continue
  to work.
- The first list page returns the caller's last successful Inbox-view timestamp
  so the client can hold a stable new-item watermark for the page session.

## Rejected alternatives

- **Denormalize Reply stage onto Inbox items** — adds an eventually consistent
  cross-context projection before query measurements justify it.
- **Count queues with separate bespoke predicates** — permits badges and list
  totals to drift.
- **Show reply queues to read-only staff** — would present a classification the
  server deliberately withholds from that caller.
