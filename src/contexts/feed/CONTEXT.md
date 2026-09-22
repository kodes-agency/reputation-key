# Feed — Context

**Audience:** Developers and agents working in `src/contexts/feed/`.

## Responsibility

Feed owns two related downstream experiences:

- Recent Activity and restricted Operational Action History projections.
- In-app notifications, notification preferences, email queueing, digests, and
  one-click unsubscribe.

It consumes durable, identifier-only facts from upstream contexts. It does not
own source review, inbox, property, portal, identity, or goal state.

## Boundaries

- Cross-context consumers import only `application/public-api.ts` or a Feed
  server function.
- `buildFeedContext` is the sole composition module. Its `activity` and
  `notification` dependency records preserve the former independent build
  boundaries, while its `publicApi` merges both surfaces.
- Activity and notification lifecycle/export contributor identifiers remain
  distinct because the persisted lifecycle and archive contracts distinguish
  those data families.
- The notification audience may read Goal monthly-result facts only through
  Goal's application public API.

## Model

Recent Activity is a privacy-filtered operational projection, not an event log
or source-content archive. Operational Action History is append-oriented,
organization-scoped evidence with restricted list/export access and legal-hold
handling.

Notifications are mutable delivery records. Copy is rendered from typed
payloads at read/send time so in-app rows, urgent email, and digests cannot
silently drift. Preferences and current responsibility are rechecked before
external delivery.

Every new Inbox Item is announced to its responsible recipients except Google
history: an item whose first Handling Cycle was observed as
`historical_onboarding`, a past review an import brought in, is never
announced. The fan-out and the missing-notification gauge share one predicate,
so such an item is never a gap either (ADR 0046).

ADR 0046 r.2's one-unread-row coalescing is an in-app rule. A recipient with
in-app off and email on gets an email-only anchor row stored already read, so
it never holds the unread `(user, type, resource)` key: every event on a
resource is emailed, and none of those rows resurfaces as unread if in-app is
turned back on. Consequences of that choice, pending product confirmation:

- Nothing coalesces for such a recipient. Ten notes on one Inbox item are ten
  immediate emails, or ten digest lines.
- Only durable receipts fence repeat deliveries for them. The unread key no
  longer does, so two deliveries of one resource under different event ids,
  such as a repair sweep overlapping the original, each send an email.
- The anchor's `read` status and its `read_at` (its creation time) are not a
  read by the user. The Organization export reports them as stored, and once
  in-app is back on they show in the feed as read history, one row per event.

Mandatory notices coalesce in-app like any other: every account notice keys
on the Organization, so a second role change while the first is unread bumps
that row. Mandatory mail is not coalesced. The repeat's email is anchored on
the same unread row and keyed on its own event (`event:<eventId>:<userId>:email`),
so the queue admits one email per mandatory event on one row, where every other
row still carries at most one. The email renders the row's merged, newest facts,
and the delivery-lag report times it from its own event, read from that key.

A read or dismiss that lands between the unread lookup and the bump is kept:
the bump only touches a row that is still unread, and the event opens a fresh
unread row (with its own email) instead.

The settings page and in-app timestamps read the same effective timezone the
delivery jobs resolve (ADR 0046 r.3): the user's own, else the Organization's
representative zone, else UTC, together with where it came from. A settings
save writes only what the user changed; because the column cannot hold "follow
the Organization", a first save that changes only the language stores the zone
delivery was already using.

Known gaps that need a nullable column or a product decision: that stored zone
is the Organization's, or UTC while the Organization has no active Property,
and from then on it no longer follows the Organization; the page calls it the
user's own. Rows the old page saved with its UTC pre-fill look exactly like a
chosen UTC and were not repaired.

Quiet hours that start and end at the same time are refused on save. Rows
stored that way earlier read back as no quiet hours, which is how delivery has
always treated them, so they never block a later save of their row.

## Runtime

Durable outbox consumers project activity and enqueue deterministic notification
jobs. The activity worker also exposes bounded projection recovery. Notification
jobs perform insert, urgent-email, digest, and missing-notification repair work.
A durable delivery is settled once its materialization receipt is claimed: a
row was written, preferences asked for none, or the recipient no longer
qualified. The repair replays a delivery Redis accepted that never settled
through its route's own consumer, under the source fact's event id; a settled
delivery is never repaired, and never counts as a gap, and a delivery the
original fan-out never queued is never queued by the repair.
All queue, clock, logger, identifier, capability-policy, and upstream lookup
dependencies are provided by composition; modules do not read ambient roots.
Delivery-lag evidence judges immediate email only in scopes where the injected
`notification.send_email` decision allows sending: a capability-dark scope's
rows are never attempted, so they are not late mail. Its bounded scan reads
only those scopes' rows, so a dark backlog cannot saturate it. Each email's
source is one outbox primary-key lookup (a uuid event id, never `id::text`),
and the gap and delivery-lag health reads run under a PostgreSQL statement
timeout, so a stalled statement is cancelled rather than left running.

## Invariants

1. Durable facts and queue payloads contain identifiers and governed facts, not
   review text, reply text, notes, reviewer identity, or provider snippets.
2. Every read and mutation remains organization-scoped; notification mutations
   additionally prove row ownership by the current user.
3. Activity replay and notification delivery are idempotent. Redelivery must
   converge through receipts and deterministic identities.
4. Email delivery rechecks preference, capability, responsibility, and delayed
   execution policy immediately before the provider effect.
5. User-facing notification copy is produced only by
   `domain/notification-templates.ts`.
6. Mandatory notices are Organization-scoped; every other notice is
   Property-scoped, with one named exception. `beta_feedback.outcome` is
   Organization-scoped `workflow_collaboration`: in-app by ADR 0046 defaults,
   never mailed, and admitted by name in `notifications_mandatory_scope_check`
   (ADR 0059). A new exception needs its own ADR and a CHECK change.
7. Operational Action History list/export responses are private and no-store.

## Verification

Unit tests stay beside domain rules, use cases, consumers, jobs, and server
contracts. PostgreSQL-backed repository, recovery, delivery, export, and
lifecycle tests stay beside their infrastructure subjects. The build test pins
that one Feed build exposes both former APIs without widening either lifecycle
surface.
