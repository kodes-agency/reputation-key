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
   delivery/event evidence; event ID is not the uniqueness key. This is an
   in-app rule: a recipient with in-app off gets a read email-only anchor per
   event, so each event is emailed (amended 2026-09-22, pending product
   confirmation; see the Feed CONTEXT.md). A mandatory notice coalesces in-app
   too, but is still emailed once per event: the repeat's email is anchored
   on the unread row and keyed on its own event (amended 2026-09-22).
3. Use the user IANA timezone with Organization fallback and test DST.
4. A multi-Property user receives one digest in their chosen timezone.
5. Application idempotency outlives the provider's 24-hour dedupe window.
6. Delivery moves through `pending → accepted →
delivered|delayed|bounced|complained|failed|suppressed|cancelled`.
7. Optional mail links to preferences; operational mail has no marketing.
8. Payload parsing admits only Property/resource/status metadata and excludes
   Review text, Guest text/media, sensitive scores, and other employees' data.

A daily digest is frozen as a batch with one idempotency key (r.5), and every
retry must send the same content under it; its date label comes from the
batch's local date, not the retry's clock. If the content changes before a
retry, a batch the provider refused outright (a rate or quota limit) is retired
and its members are re-sent in a new batch under a new key. Any other batch may
already have been accepted, so it fails closed rather than mail twice.

In the queue, `delayed` (r.6) is the pre-send quiet-hours deferral and stays
sendable. A delivery delay the provider reports after acceptance is recorded
only as `provider_state = 'delivery_delayed'`; the row stays `accepted`, so it
is never sent twice. A provider `failed` after acceptance is terminal, and a
provider `suppressed` stops mail to that recipient as a bounce or complaint
does. Suppressions made locally (a disabled preference) never count as the
provider refusing the recipient.

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
URL is `/inbox?itemId=<id>`; a hard-deleted unresolved item is skipped. A grouped
notice is many items, so it opens a queue at that Property instead of one of
them: an assignment the recipient's own (`/inbox?queue=mine&propertyId=<id>`),
a reopen every open item (`/inbox?queue=open&propertyId=<id>`).

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
fact's event id and delivery marker, and only deliveries the original fan-out
queued that are still unsettled are queued, each under an id of its own; an
identity the consumer derives only now (a moved Google anchor, a recipient who
joined since) is not a repair. A recipient who muted a type is settled,
so the repair never re-announces the review, and
`notification.missing_for_inbox_item` counts only items whose delivery is not
yet decided. The previous sweep minted an event id no outbox row carried, so
its receipts and settlements could never be written.

## Amended 2026-09-22 — goal results are the Recognition category, shown as "Goals"

`goal.completed` and `goal.result_revised` are live and classified `recognition`,
but the category had been left out of settings, filters and row mute as
"post-core history". People could not mute the only positive notices in the
product, filter to them, or reach the opt-in email this ADR promises. One
Program over every Portal can close up to 250 results in the same hour. The
category stays `recognition` in the model and is shown as **Goals** ("Goal
results for your properties."). It gets a Property settings row (in-app on by
default, email opt-in), a filter tab and a Mute action on its rows. Goals are
not reclassified as workflow, because muting a goal row would then also mute
assignments and notes. Every category a live notification type uses must now be
configurable, mandatory, or Organization-informational (ADR 0059), and must
have a filter. A test enforces this in both directions.

Goal email is a daily digest only; there is no immediate cadence for it. The
same 250 results closing in one hour would otherwise be up to 250 emails to one
person at once. Settings shows the one cadence without a choice, the preference
constructor refuses an immediate goal email row, and delivery sends a goal row
saved as immediate before this amendment in the daily digest anyway.

## Consequences

- Missing preferences cannot silently enable email.
- Resource coalescing and durable idempotency prevent duplicate delivery for
  in-app recipients. For email-only recipients only durable idempotency does:
  each event is its own email, and deliveries of one resource under different
  event ids are not merged. Mandatory mail is never merged: a second role
  change or purge-pending notice is a second email.
- Recognition email requires explicit opt-in and arrives in the daily digest.
- Provider/capability admission remains the outbound activation authority.

## Rejected alternatives

- Default-on optional email sends without deliberate consent.
- Event-ID uniqueness defeats resource-level coalescing.
