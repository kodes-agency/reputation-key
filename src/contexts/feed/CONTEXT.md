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
external delivery: each queued email keeps the audience descriptor that
admitted its recipient, and immediately before a Property-scoped send the
recipient must still be an eligible manager for the Property (membership,
access, participation) and, for a responsible-scope, Portal-health or
AccountAdmin audience, still hold that responsibility or role. A digest drops
only the rows that fail. A digest already frozen for retry does too when the
provider refused every attempt at it: it is retired and the remaining rows go
out under a new key. A frozen digest the provider may already have accepted is
retired whole instead, because re-sending the rest could deliver it twice.
Organization-scoped mandatory mail is exempt: an access-removed notice goes to
someone who is no longer a member.

An AccountAdmin audience is decided at the Organization, with or without a
Property, because that is where the role is held. The Purge Pending final
notice depends on it: it carries no Property, and refusing it for that reason
dropped the last warning before an irreversible deletion. Every other audience
still fails closed without a Property.

The Organization's lifecycle authority is read when an email is queued and
again before it is sent. From a closure request, and until a cancelled
closure is explicitly reactivated, no optional email is queued or sent and
queued rows are suppressed as `organization_closing`; mandatory notices stop
only at the irreversible boundary. Rows for a Property that is not active are
held, by the digest and the urgent path alike.

The browser receives a `NotificationView`, never the stored row: the event
correlation id, the frozen title/body snapshot, `updatedAt` and the recipient
and Organization ids stay on the server.

A guest revision is categorised by the work it lands on. One that supersedes
an OPEN cycle is `review.updated` and is `workflow_collaboration`, like the
`review.created` it amends: the item was already unhandled and already
announced, so an edited comma must not outrank the review itself with an
immediate email. One that reopens a CLOSED cycle is `inbox.reopened` and stays
`urgent_operational`. Urgency for an unanswered review comes from its Inbox
Response Target, not from Feed, which never sees a rating class (ADR 0046,
amended 2026-09-24).

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

One notice is answerable by mail: the Purge Pending final warning names the
monitored support address in its copy and sets it as the message's reply-to.
The From address is unchanged — it stays the sending identity SPF/DKIM are
aligned for. Every other notice is answered in the product and sets none.

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
the Organization", a first save that changes only the date format stores the
zone delivery was already using. The format is an English convention, not a
language: every word in the product is English (docs/BETA.md).

Quiet hours and the urgent bypass sit in that same row, one window for every
Property the person has (ADR 0046, amended 2026-09-23), with an optional
per-Property override whose existence IS the override: a row with no times
means "hold nothing back here", and it replaces the personal window whole,
bypass included. Immediate mail is scoped to one Property and reads that
Property's override where there is one; the daily digest covers every Property,
so it reads the person's window only, once per recipient per sweep, and a quiet
window defers the whole digest to one minute rather than half of it (r.4).

Whether a category is delivered, and at which cadence, is still per Property,
but a Property with no row of its own now inherits the person's default for
that (category, channel) before falling through to the versioned defaults. A
Property added or reassigned after everything else was configured used to fall
straight through, which is how a brand-new Property mailed urgent notices at
03:00. "Apply to all my properties" writes that default and clears the
per-Property rows that would have overridden it.

Known gaps that need a nullable column or a product decision: that stored zone
is the Organization's, or UTC while the Organization has no active Property,
and from then on it no longer follows the Organization; the page calls it the
user's own. Rows the old page saved with its UTC pre-fill look exactly like a
chosen UTC and were not repaired.

Quiet hours that start and end at the same time are refused on save, by the
constructor and by a CHECK on both tables that can hold a window. Rows stored
that way earlier read back as no quiet hours, which is how delivery has always
treated them, so they never block a later save of their row.

The in-app feed is ordered by latest activity, newest first:
`COALESCE(coalesced_latest_at, created_at)`, with id as the tiebreak. A
coalesced row therefore moves to the top when a repeat event is absorbed, the
same instant its body starts saying how often it repeated ("This happened N
times.").

Pages below the polled head continue by keyset, never by offset: each page
carries a server-minted `nextCursor` (the last row's latest-activity instant to
the microsecond, and its id), and the next page reads strictly after it. Rows
arriving or leaving above a page cannot shift it. The head is bounded, so when
a refreshed head no longer reaches the loaded history the client reads the rows
between them as one more page and keeps every page the user loaded; only when
one page cannot bridge that gap (or its read fails) does it reset that history,
and "Load more" continues from the head's own cursor. Loaded history is never
re-read, so the client also resets it when a refreshed head proves it stale:
the head is the whole feed, or the rows on screen hold more unread than the
unread count. An optimistic write patches every cached feed of the
Organization (the bell's and the page's, every filter), not only the surface
that acted, and a "Load more" it interrupts is asked for again.

"Mark all read" marks the unread rows of the filter tab the reader is on, not
every unread row: tidying Workflow leaves urgent Action-needed and account
notices unread. The feed head therefore carries, from the same snapshot as the
unread count, the filter's share of it (`filterUnreadCount`); a tab offers the
action exactly while that share is above zero.

Every Property-scoped notice names its Property, read when it is fanned out,
so a reader with several Properties can tell rows and urgent emails apart. The
Google connection's notices are the exception: the connection belongs to the
Organization. `integration.reauthorization_required` is mailed, so it is filed
under a Property that is only a delivery anchor and never named in its copy;
`integration.google_disconnected` is in-app only, so it is Organization-scoped
outright and points at the connection. That disconnect notice reaches every
current AccountAdmin except the one who disconnected, through the
`organization_account_admin` audience — `account_admin` is Property-scoped and
the delivery check refuses a Property-less notice under it.

A notice states the governed fact its event carried, never a category of
event: why an item was reopened, what is wrong with a Portal and whether
guests can reach it, the target time a reminder is about, and which month a
Goal result covers, whose goal it is and which way it went. Each crosses as a
closed enum or a key; the sentence is written here (ADR 0046, amended
2026-09-24). Two facts are read on the RECIPIENT's clock rather than stored as
labels: a target time renders through an optional render context carrying only
the reader's timezone, and a Goal month is a `YYYY-MM` key on the Property's
own calendar. A surface with no timezone — the frozen snapshot written at
insert time — leaves the target time out rather than guessing UTC, and every
live surface re-renders.

Each surface states a fact once. Titles name the Property; a locally
collected rating and a waiting age sit beside the copy (the in-app strip,
email's facts line) and never inside a sentence; a property-grouped digest
leaves the group's Property out of each line's facts.

A row that absorbed repeat events keeps their count in `coalesced_count` only.
Every read projects that column into the payload the copy renders from, and
the copy says it once, in the words for what repeated ("3 notes added").

A waiting age is never stored. A notice about something still waiting on its
reader (an approval, an escalation, a Response Target reminder) stores when the
current wait began, the start of the current cycle's measured Response Target.
The read measures that wait to the row's latest event, the time the row shows,
and every surface shows that fixed age ("waited 2d"): the item may have been
answered since, so no surface measures against its own clock. Notices about
finished work, closed items and met targets carry no wait, and a repeat event
that measured none drops the row's earlier one.

Nobody is notified about their own action. Every route whose fact names a
person as the actor drops that person from its recipients — a claim, a
self-assignment, an AccountAdmin's own escalation or submission, an author
approving or rejecting their own reply — and keeps everyone else. Google's
publication outcomes have no actor and always reach the author.

An approval request goes to the Property's responsible managers who hold
`reply.manage` (the `reply_approver` audience), falling back to AccountAdmins
only when none of them can act, and never to the submitter. Responsibility and
that permission are separate authorities, so the audience check and the
pre-send standing check ask both. An escalation follows the item's own
responsible scope, Property or Portal, with the same admin fallback every
responsible-scope route has. When it is resolved, the notice also reaches the
AccountAdmins who were told it was raised — proved by Feed's own rows for
(`inbox.escalated`, that item) — and nobody who was not.

A notice that asks its reader for work stops asking once the work is done.
The actionable types are named in `domain/notification-settlement.ts`; the
settlement consumer retires every recipient's still-waiting row for a
(type, resource) when the finishing fact arrives and cancels the still-sendable
mail behind them. It stamps `resolvedAt` and leaves `status` alone, because
read is not resolved: a settled row leaves the unread count and the Unread tab,
stays in the feed under a "Done" marker, and returns to asking if a repeat
event lands on the same resource. Immediately before the provider effect, the
immediate path and the digest both ask whether the row is still actionable —
unsettled, unread, undismissed — and retire it as `work_no_longer_waiting`
otherwise. A notice that reports an outcome is never held back that way.

A request to choose a responsible manager is raised for AccountAdmins only
while the Property or Portal still has no eligible manager, checked when the
notice is inserted: a manager chosen before then retires it. Nothing rechecks
the gap afterwards, so the in-app row stays and an email already queued for it
(one held for quiet hours or a digest) is still sent. A failed publication goes
to its author while they can still act on the Property, otherwise to the
Property's responsible managers (AccountAdmins when none is eligible), so it
always reaches someone who can retry it.

A publication cancelled after approval reaches the reply's author and the
AccountAdmins who can approve it again, with the copy its closed cause asks
for. Under the `policy` cause — a Property Archive, a lost publishing
authority — an approver who is no longer eligible for the Property is left out:
that cause is what taking their authority away looks like. Every other cause
keeps them.

The signed List-Unsubscribe URL accepts an RFC 8058 one-click POST in either
form encoding and answers 204. Its token names only the queue row or digest
batch, which retention deletes after 90 days, so the optional scopes a message
stands for are kept when it is sent, for a year; a valid token that matches
nothing still answers 204 and is logged as a warning. A browser GET on the same URL gets a confirm
page and never unsubscribes, because link scanners fetch every URL in a
message; that page's form is answered with a page. No answer reveals whether
a token is valid.

## Runtime

Durable outbox consumers project activity and enqueue deterministic notification
jobs. One consumer family does the opposite: the settlement consumers subscribe
to the facts that finish work and write through the notification and email
repositories directly, because settling is one bounded update per fact with no
per-recipient decision to fan out. A bulk Inbox command (assignment, reopen) notifies once per recipient per
Property from its completion fact; the per-item facts it covers stay history.
An offboarding or eligibility release does the same: one notice per Property to
the Property's responsible managers, less the departing member and less
whoever released them.
So a grouped reopen stands while any of its items is still the open head the
recipient is responsible for, and says how many are when it is delivered.
The activity worker also exposes bounded projection recovery. Notification
jobs perform insert, urgent-email, digest, and missing-notification repair work.
A durable delivery is settled once its materialization receipt is claimed: a
row was written, preferences asked for none, or the recipient no longer
qualified. The repair replays a delivery Redis accepted that never settled
through its route's own consumer, under the source fact's event id; a settled
delivery is never repaired, and never counts as a gap, and a delivery the
original fan-out never queued is never queued by the repair.
All queue, clock, logger, identifier, capability-policy, and upstream lookup
dependencies are provided by composition; modules do not read ambient roots.
Immediate mail for an Organization-scoped mandatory notice is a job of its
own name (`mandatory-email`) under its own action and core capability, so the
beta email allowlist, which gates every other message, cannot hold an
account/security notice back (ADR 0046). It is the same processor: the stored
row must still be mandatory, Organization-scoped and immediate. The digest
run's orphan sweep authorizes its Organization leg under the same action.

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
2. Every read and mutation remains organization-scoped, with one named
   exception: the access-removal read behind `/unavailable` is scoped to the
   caller's own user id, because the notice it looks for lives in an
   Organization the caller can no longer open. It admits one notification type,
   answers only with an instant, and takes its subject from the session. A
   second user-scoped read needs its own decision here. Notification mutations
   additionally prove row ownership by the current user. The in-app feed and
   its unread badge also follow the reader's current Property access for
   `notification.read`, so a revoked or expired grant hides that Property's
   rows; Organization-scoped notices are never Property-gated.
3. Activity replay and notification delivery are idempotent. Redelivery must
   converge through receipts and deterministic identities.
4. Email delivery rechecks preference, capability, responsibility, and delayed
   execution policy immediately before the provider effect.
5. User-facing notification copy is produced only by
   `domain/notification-templates.ts`.
6. Mandatory notices are Organization-scoped; every other notice is
   Property-scoped, with two named exceptions. `beta_feedback.outcome`
   (ADR 0059) and `integration.google_disconnected` (ADR 0046, amended
   2026-09-24) are Organization-scoped `workflow_collaboration`: in-app by
   ADR 0046 defaults, never mailed, and each admitted by name, in a branch of
   its own, in `notifications_mandatory_scope_check`. A new exception needs its
   own ADR and a CHECK change.
7. Operational Action History list/export responses are private and no-store.

## Verification

Unit tests stay beside domain rules, use cases, consumers, jobs, and server
contracts. PostgreSQL-backed repository, recovery, delivery, export, and
lifecycle tests stay beside their infrastructure subjects. The build test pins
that one Feed build exposes both former APIs without widening either lifecycle
surface.
