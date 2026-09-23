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
retry, a batch the provider refused outright (a rate or quota limit) on every
attempt is retired and its members are re-sent in a new batch under a new key.
Any other batch may already have been accepted, so it fails closed rather than
mail twice. Each attempt is recorded as started before the provider call, so
an attempt whose worker never reported back counts as possibly accepted, and
no later refusal makes the batch look safe to re-key.

In the queue, `delayed` (r.6) is the pre-send quiet-hours deferral and stays
sendable. A delivery delay the provider reports after acceptance is recorded
only as `provider_state = 'delivery_delayed'`; the row stays `accepted`, so it
is never sent twice. A provider `failed` after acceptance is terminal. A
permanent bounce, a complaint, or a provider `suppressed` stops mail to that
ADDRESS: it is recorded in a durable suppression list keyed by an HMAC of
the normalized address under a server secret, outside queue retention and
across Organizations, and checked before every send. The provider's own list
is mirrored: `suppression.added` records an address, and `suppression.removed`
is the only way one leaves. A transient or undetermined bounce ends only its
message. Suppressions made locally (a disabled preference) never count as the
provider refusing the recipient.

Delivery is authorized twice. The audience authorizer admits a recipient
when the notification is inserted, and the queued email keeps that audience
descriptor (identifiers only). Immediately before a Property-scoped send,
urgent or digest, the recipient's standing is rechecked: still an eligible
manager for the Property, and for a responsible-scope, Portal-health or
AccountAdmin audience still responsible or still an AccountAdmin. A row that
fails is suppressed as `recipient_ineligible`. Standing is not freshness: the
send never asks whether the item that raised the notice has moved on.

Queued email has a maximum age. Rows are queued even while outbound email is
dark for their Organization or Property, because the capability gates the
send, not the insert. A row past its bound is suppressed as `stale` rather
than sent, so admitting a scope, or lifting a stop, never flushes a backlog:
immediate mail keeps a day, daily-digest rows two days, and mandatory
Organization notices a week. The bound counts from when the row became due,
so a quiet-hours deferral never counts against it. Once attempted, an
immediate row, a mandatory notice included, is also retired 23 hours after its
first attempt, which is recorded before the provider call: the provider keeps
an idempotency key for 24 hours, and a retry after that of an attempt it may
have accepted would be a second email. An open digest batch was fresh when it
was frozen and is left to its bounded retries. `cancelled` rows
are terminal and age out with the other terminal states after 90 days.

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

## Amended 2026-09-24 — mandatory mail is not held by the beta email allowlist

`notification.send_email` is a controlled capability: an Organization must be
allowlisted before any of its mail leaves. That is right for product mail and
wrong for a mandatory account/security notice, whose whole purpose is to reach
someone about their account — including the last warning before an Organization
is permanently deleted, which for an Organization nobody ever allowlisted was
queued, never sent, and finally retired as stale.

Immediate mail for an Organization-scoped mandatory notice therefore travels
under its own delayed action, `system:notification.email_mandatory`, gated by
its own capability, `notification.send_mandatory_email`, whose fate is core: it
needs no tenant allowlist. It is the same processor under a second job name,
because the execution gate decides a capability per entry point. The digest
run's recovery sweep authorizes its Organization-scoped leg under that action
too, so a stranded mandatory row is re-enqueued in the same scopes.

Nothing else is carved out. The environment stop (`BETA_CAPABILITIES_OFF`) and
tenant suspension still refuse it; so do the Organization's irreversible
lifecycle boundary, the address suppression list, the stale-row bound, the
delivery-scope CHECK the stored row must satisfy, and the send-time recipient
checks. Optional mail is unaffected, and an unsubscribe still never applies to
a mandatory notice. A mandatory notice is emailed once per event either way.

The cost is accepted deliberately: an Organization outside the beta cohort can
now receive account/security mail. A final deletion warning nobody receives is
worse than an extra email.

## Amended 2026-09-24 — a cancelled publication tells the author and the approvers

`review.reply.publication_cancelled` had no notification consumer. A reply that
was approved, whose author was told "It is queued to publish to Google"
(`reply.approved`), silently returned to draft on a Google disconnect, a
Property Archive or a lost publishing authority (`policy`), a guest revising
their review (`source_changed`), or a different reply already live on Google
(`provider_truth`). No badge, no email, no row: the team went on believing the
reply was on its way.

`reply.publication_cancelled` is now a live type, category `urgent_operational`
and deliberately NOT in `URGENT_TYPES` — nothing reached Google, so no
cancellation is worth breaking quiet hours for. Its copy is chosen by the
event's own closed cause, because each cause asks for a different next step:
reconnect Google, nothing to do at this Property, write a reply to the new
review, or look at what is already live. The notice never says "your": it goes
to the reply's author AND to the AccountAdmins, who are the people who can
approve it again — the same audience `reply.pending_approval` asks.

For the `policy` cause only, an approver who is no longer eligible for the
Property is left out at fan-out: a policy cancellation is exactly what taking
that authority away looks like, and asking someone to re-approve what they can
no longer touch is noise. The other three causes take nobody's authority, so
every approver is kept. The author's own notice carries the `property_operator`
audience, whose delivery check re-tests Property eligibility anyway.

The fact carries `authorId` (identifier only, nullable) from this date. Facts
recorded before it reach the approvers alone.

## Amended 2026-09-24 — a deliberate Google disconnect tells the other admins

Disconnecting the Organization's Google account stops review updates and every
reply to Google, for every Property, and it said so nowhere: only somebody
watching the Integrations page could tell. `integration.google_disconnected` is
now a live type. It goes to every current AccountAdmin except the one who
disconnected — nobody is notified about their own action — and a fact the
recovery reconciler could not attribute excludes nobody rather than everybody.
The fact carries that actor (`userId`, identifier only, nullable) from this
date.

The notice is **Organization-scoped and not mandatory**, the third shape this
policy admits and the second type named in `notifications_mandatory_scope_check`
(migration 0030): category `workflow_collaboration`, no Property, and the
connection as its resource. It is in-app only — an Organization-scoped notice
has no Property preference row that could opt it into email, and the email
queue's own scope CHECK refuses it — which is exactly why it can be scoped
honestly. `integration.reauthorization_required` still anchors itself on an
arbitrary Property because it is urgent_operational and therefore mailed.

That needed a new audience kind. `account_admin` is Property-scoped: the
delivery authorizer refuses a Property-less job under it, which is why the
mandatory Purge Pending notice still reaches nobody. `organization_account_admin`
authorizes a Property-less notice against the AccountAdmin role itself. The
Purge Pending audience stays an open product decision and is untouched: which
audience a mandatory final notice should have is a different question from who
hears about a connection.

The copy never names the admin who disconnected. Rule 8 excludes other
employees' data, and the payload carries nothing at all.

## Amended 2026-09-24 — an offboarding release tells whoever owns the gap

Offboarding a member, or reconciling one who no longer qualifies for a
Property, unassigns every Inbox item they held. Each item recorded an
`inbox.inbox_item.unassigned` fact, all of them history, and nobody was told:
the work simply stopped being anyone's while the queue still showed it open.

The release now records one grouped close fact,
`inbox.inbox_items.assignments_released`, in the same transaction as the rows
it describes, and `inbox.assignments_released` is delivered from it — ONE
notice per Property, never one per item, because a departing manager can leave
dozens behind and the news is the gap, not each item. It goes to the
Property's responsible managers (AccountAdmins when none is eligible), less
the departing member, who no longer owns it, and less whoever released them,
who already knows. The row opens the Property's open queue, as the other
grouped Inbox notices open theirs.

Category `urgent_operational`, and not in `URGENT_TYPES`: the items are where
they always were and nothing is on a clock.

The fact's closed reason is named `releaseReason`, not `reason`: the outbox
adapter denylists `reason` as content, with one carve-out, and widening that
denylist for an enum is the wrong trade.

## Consequences

- Missing preferences cannot silently enable email.
- Resource coalescing and durable idempotency prevent duplicate delivery for
  in-app recipients. For email-only recipients only durable idempotency does:
  each event is its own email, and deliveries of one resource under different
  event ids are not merged. Mandatory mail is never merged: a second role
  change or purge-pending notice is a second email.
- Recognition email requires explicit opt-in and arrives in the daily digest.
- Provider/capability admission remains the outbound activation authority for
  every optional message. Mandatory account/security mail is admitted by the
  core mandatory capability instead, so a tenant allowlist cannot silence it
  (amended 2026-09-24).

## Rejected alternatives

- Default-on optional email sends without deliberate consent.
- Event-ID uniqueness defeats resource-level coalescing.
