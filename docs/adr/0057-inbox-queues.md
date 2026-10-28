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

## Amendment 2026-10-28 — sections by kind, closed folders by kind, seven counts

The rail was one flat list. Reviews and private feedback sat in it side by side
and, below the first four rows, mixed (Mine, Escalated, Closed and Open each
hold both kinds), so a manager could not tell which work was which. This amends
decisions 1 and 3 and the count cost under Consequences; decisions 2, 4, 5 and
6 stand.

1. **The rail has two titled sections and the shared views.** "Reviews" holds
   Needs reply, Awaiting approval, Waiting for Google and Replied. "Private
   feedback" holds To handle and Handled. After a separator, with no heading,
   come Mine, Escalated and All open. The headings are group labels inside the one
   `Queues` navigation. A section appears only for a viewer who can read its kind
   (`review.read`, `feedback.read`), and All open only when both are visible.
   The Private feedback section shows even when it is empty: its empty state says
   where private feedback comes from (a guest's private note, never published to
   Google) and, for a viewer allowed to create Portals whose scope has none, offers
   "Set up a feedback page" (the Portal creation address of the Property in view,
   or of the only Property, else the organization's Portals page). The Portal
   context answers "does this scope have a Portal?" (`getPortalPresence`, a yes or
   a no) only while that empty state shows.
2. **Queue keys.** `INBOX_QUEUES` gains `replied` (status `closed`, Review) and
   `handled` (status `closed`, private feedback). `feedback` stays the key of "To
   handle", `open` the key of "All open", and `reply`, `approval`, `waiting`,
   `escalated` and `mine` keep theirs. `closed`, every closed item whatever its
   kind, stays a valid server key for API compatibility and leaves the rail. A
   Replied or Handled folder holds every closed item of its kind, including the
   rare close that is not a reply or a handling (a Review Google no longer serves,
   feedback the guest withdrew); the item's own status still says so. The client
   reads an old `queue=closed` or `folder=closed` address as `replied`, at the URL
   boundary.
3. **Counts.** `replied`, `handled` and `closed` are not counted: they are
   archives, not work, and carry no badge (their count is `null`). A manager
   request performs one content-free Review stage lookup and seven counts
   (`reply`, `approval`, `waiting`, `feedback`, `escalated`, `mine`, `open`),
   down from eight. Every counted queue still equals its list total (decision
   6); the per-property counts behind the property select count the closed
   folders by kind as their lists do, since they are read only while the select
   is open.
4. **The reduced rail is a safety net.** Without reply stages (no `reply.manage`,
   or `property.publish_reply` unavailable) the Reviews section holds one row,
   "Open", under the `reply` key and Replied. `reply` is then every open Review,
   on the server and in the browser, and is counted that way; `approval` and
   `waiting` stay unavailable (refused, counted `null`). The list and per-property
   count functions take the reply policy's answer for `reply` as a boundary
   decision (`replyQueuesEnabled`), as the queue counts always did, instead of
   refusing the request. Only a settled denial is that answer: a policy that
   could not answer (`policy_unavailable`) refuses the request, as every gated
   read does, so an outage never serves another set than the page is drawn for.
   The server decides, per scope, and the queue counts carry the answer
   (`replyStages`). The browser draws the rail's rows and labels, the empty copy,
   where an edited row belongs and an open item's departure from it, and uses its
   own permissions and capability set only as the guess a first paint draws until
   the counts arrive. Only AccountAdmin and PropertyManager reach the Inbox in
   the closed beta and both hold `reply.manage`, so the stages drop only when an
   operator turns reply publication off, a fresh database has not yet allowed it,
   or the restore mode is isolated. Where a viewer lands without a queue in the
   address is the first row of the first visible section: Needs reply, or "Open"
   in this state (it was All open).
5. **Filters offer only what can match.** Source (All items, Reviews, Feedback)
   appears only in Mine, Escalated and All open. The topic filters (Aspect,
   Polarity) do not appear in To handle and Handled; Priority and Rating appear
   everywhere (see the 2026-10-29 note). What a queue does not offer is neither
   applied nor kept in the address when a person moves into the queue. The
   dashboard "Overdue" link opens All open narrowed to Reviews.
6. **Phone.** The strip of queue pills becomes one queue button (the current
   queue's glyph, label, count and a chevron) that opens the rail's sections in a
   bottom sheet, and a chip beside it that jumps to the other kind's open queue
   ("To handle" from a Reviews queue; "Needs reply", or "Open", from a feedback
   queue), shown only when that queue has items and its section is visible, and
   never from Mine, Escalated or All open.
7. **Kinds are named where they mix.** A feedback row begins with a "Private"
   badge (the locked message and the word). The open item's header names its kind
   ("Google review", "Review", "Private feedback") in place of the decorative chat
   glyph and the platform word, and the case toolbar reads "To handle" for open
   feedback, the name of its queue (it read "Needs attention", which the AI's flag
   under a review's topics also says).

Deployment note: a tab that loaded the page before this shipped keeps working
against the new server until it reloads. It still asks for `closed` and the other
old keys, which still answer, and it reads the counts it already knows (`closed`
arrives as `null`, so its Closed row loses its badge).

## Note 2026-10-29 — Priority is offered in every queue

Decision 5 of the amendment above withheld the Priority filter from To handle
and Handled, because it matched only the AI's attention level, which private
feedback never has. [ADR 0071](0071-inbox-manual-priority.md) makes it match the
effective level (the one a person set, else the AI's suggestion), so a manager's
Urgent on feedback can be found there: Priority is offered in every queue, and
the topic filters (Aspect, Polarity) are the only ones still withheld from the
two feedback queues. The filter also gains one value, "Urgent and High"
(`attention=urgent_high`). Nothing else in the amendment changes.
