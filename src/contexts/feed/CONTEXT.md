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
- Whether a notice's work still waits is asked of the context that owns it,
  through `application/notification-work-state.ts` (container
  `notificationWorkerRuntime.workState`, passed to the insert, immediate-email
  and digest jobs): Inbox's lookups, Review's reply state through
  `ReplyWorkStateLookupPort` (`review.lookups.reply.findStatesByReviewIds`,
  internal replies only), Portal Health, responsibility, and the Organization
  lifecycle. Feed reads the Property lifecycle through `ActivePropertyLookup`
  and a bulk reopen's cycles through `GroupedReopenStorePort`, which reads that
  one fact's outbox payload by id.

## Model

Recent Activity is a privacy-filtered operational projection, not an event log
or source-content archive. As of 2026-09-28 no manager screen reads it: the
projection is kept because the Organization export and recovery read it (with
90-day replay facts), and whether it gets a UI or is re-graded is an open
product decision. Do not remove the projection or its consumer before that
decision; the unused `getActivityTimeline` plumbing in the inbox bundle is
cleanup for after the in-flight inbox work lands. Operational Action History is append-oriented,
organization-scoped evidence with restricted list/export access and legal-hold
handling. `listOperationalActionHistoryFn` and `exportOperationalActionHistoryFn`
are that restricted AccountAdmin API and have no UI on purpose
(`docs/operations/operational-action-history.md`, "Access and export").

Notifications are mutable delivery records. Copy is rendered from typed
payloads at read/send time so in-app rows, urgent email, and digests cannot
silently drift. Preferences and current responsibility are rechecked before
external delivery: each queued email keeps the audience descriptor that
admitted its recipient, and immediately before a Property-scoped send the
recipient must still be an eligible manager for the Property (membership
and access) and, for a responsible-scope, Portal-health or
AccountAdmin audience, still hold that responsibility or role. A digest drops
only the rows that fail. A digest already frozen for retry does too when the
provider refused every attempt at it: it is retired and the remaining rows go
out under a new key. A frozen digest the provider may already have accepted is
re-sent exactly as frozen, under its key, from the provider request stored
while it is open: a line read or settled since stays in it, because one stale
line is less surprising than losing the day's digest. It closes unsent only on
an authorization, standing, preference, suppression or address change, or once
every member was settled elsewhere, and it waits out quiet hours untouched.
The stored request holds the rendered mail and is cleared when the batch is
accepted or closed.
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
an OPEN cycle is `review.updated` and is `arrivals`, like the `review.created`
it amends (D4: off in the app and by email until the person turns arrivals
on): the item was already unhandled and already announced, so an edited comma
must not outrank the review itself with an immediate email. One that reopens a CLOSED cycle is `inbox.reopened` and stays
`urgent_operational`: a reply written for the old revision does not answer the
new one, so the old reply still live on Google does not close the reopened
cycle, and the reply to the edit settles the notice. Urgency for an unanswered
review comes from its Inbox Response Target. A low rating is the reader's own
threshold instead: when a new or edited review, or rated private feedback, is
at or below it, the notice is Low ratings for that reader (per channel, 3★ or
lower in the app and 2★ or lower by email unless they choose). Feed reads a
Google review's rating for that decision only, through Review's eligible read,
and keeps only the outcome — the category and the payload's `lowRating` flag,
never the stars (ADR 0046, amended 2026-09-24, 2026-09-28 and 2026-09-30).

Every new Inbox Item is announced to its responsible recipients except Google
history: an item whose first Handling Cycle was observed as
`historical_onboarding`, a past review an import brought in, is never
announced. The fan-out and the missing-notification gauge share one predicate,
so such an item is never a gap either (ADR 0046).

What an import brought in is announced ONCE instead, per Property:
`property.review_import_finished` (`workflow_collaboration`), from the Review
context's `review.property_history_import.finished` fact — what the import
listed, and how much of it still needs a reply (ADR 0046, amended 2026-09-24).
Its second number is counted HERE, when the notice is built, through
`InboxItemLookupPort.countOpenReviewItemsForProperty`, NOT in the import's
terminal transaction: an Inbox item is projected asynchronously from
`review.created`, so at that instant the items the notice is about may not
exist yet. Reading late is not enough on its own, so the consumer first asks
`hasPendingReviewProjections` whether any `review.created`, `review.updated`
or `review.reply.observed` recorded for the Property before the finished fact
still lacks its Inbox receipt; while one does it throws and the dispatch
retries. After `REVIEW_IMPORT_SUMMARY_SETTLE_HORIZON_MS` (15 minutes) it sends
the notice without the second number rather than a wrong one (ADR 0046,
amended 2026-09-28). The copy is present-tense to match, and a count that
cannot be read costs the sentence its second number, never the notice. The
count is open Handling Cycle heads, not measured Response Targets: imported
history is exactly the performance eligibility that would exclude. A failure
the discovery ladder retries by itself (`temporary`) is recorded obsolete and
reaches nobody. Recipients: whoever asked for the import (Integration's public
API answers it) while still eligible for the Property, then the Property's
responsible managers, then the AccountAdmins.

ADR 0046 r.2's one-unread-row coalescing is an in-app rule, and only a row
whose work still waits (unread and unsettled) holds its key: a settled row
leaves the slot, so a request raised again gets a row, and an email, of its
own (migration 0036). A recipient with in-app off and email on gets an
email-only anchor row stored already read, so it never holds the unread
`(user, type, resource)` key: every event on a resource is emailed, and none
of those rows resurfaces as unread if in-app is turned back on. Consequences of
that choice, pending product confirmation:

- Nothing coalesces for such a recipient. Ten notes on one Inbox item are ten
  immediate emails, or ten digest lines.
- Only durable receipts fence repeat deliveries for them. The unread key no
  longer does, so two deliveries of one resource under different event ids,
  such as a repair sweep overlapping the original, each send an email.
- The anchor's `read` status is not a read by the user, so its `read_at` is
  NULL (`isEmailOnlyAnchor`), and the send treats it as unread; settlement
  stamps it like any row. Anchors stored before 2026-09-28 carry `read_at` =
  their creation time. The Organization export reports them as stored, and
  once in-app is back on they show in the feed as read history, one row per
  event.

One notice is answerable by mail: the Purge Pending final warning names the
monitored support address in its copy and sets it as the message's reply-to.
The From address is unchanged — it stays the sending identity SPF/DKIM are
aligned for. Every other notice is answered in the product and sets none.

The account notices are Organization-scoped and mandatory, and every one names
the Organization (the payload's `organizationName`); the role-change notice also
names the role the member now holds (`memberRole`). Two come from Identity's
access facts: `account.organization_property_access_changed` (to the member, from
`identity.member.property_access_changed`, audience `affected_organization_user`,
opening Properties) and `account.invitation_accepted` (to the inviter named by
the accepted fact's `inviterId`, audience `account_admin`, opening Members; a
fact recorded before it named its inviter gets an `obsolete` receipt). Neither
names another person, and neither counts Properties or people in its copy:
repeats of a type merge into one unread row, which says only that it happened
again. An inviter who is no longer an AccountAdmin of the Organization, such as
an operator who invited through the console, is refused at delivery.

Mandatory notices coalesce in-app like any other: every account notice keys
on the Organization, so a second role change while the first is unread bumps
that row. Mandatory mail is not coalesced. The repeat's email is anchored on
the same unread row and keyed on its own event (`event:<eventId>:<userId>:email`),
so the queue admits one email per mandatory event on one row, where every other
row still carries at most one. The email renders the row's merged, newest facts,
and the delivery-lag report times it from its own event, read from that key.

A read, dismiss or settlement that lands between the unread lookup and the
bump is kept: the bump only touches a row whose work still waits, and the
event opens a fresh unread row (with its own email) instead.

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
per-Property rows that would have overridden it; while email is not allowed
for the Property in view it applies the in-app half only and says so. The
in-app list and badge resolve in-app the same way — the Property's row, then
the person's category default, then the versioned default — and hide a
Property notice that resolves off. Mandatory, urgent_operational and
Organization notices are never hidden.

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
the head is the whole feed, or the rows on screen hold more still-waiting rows
than the unread count. An optimistic write patches every cached feed of the
Organization (the bell's and the page's, every filter), not only the surface
that acted, and a "Load more" it interrupts is asked for again.

In the browser "unread" means still waiting (`isStillWaiting`, exported from
the public API and matching the repository's rule): the badge, the Unread tab,
the "New" group and the optimistic counts skip a settled row, which stays
`unread` until opened but is listed under "Earlier". The head poll stops on
401, 403 and 409; focus or Retry reads again.

"Mark all read" marks the unread rows of the filter tab the reader is on, not
every unread row: tidying Workflow leaves urgent Action-needed and account
notices unread. The feed head therefore carries, from the same snapshot as the
unread count, the filter's share of it (`filterUnreadCount`); a tab offers the
action exactly while that share is above zero. It and "Clear all" act only on
rows the reader's feed shows (`NotificationFeedScope`): Properties the reader
can still reach under `notification.read`, plus Organization notices, less
categories switched off in-app. Rows hidden by revoked access or an in-app
opt-out stay untouched and come back unread if access returns. On the All tab
a settled row is marked read too, since the server matches `status =
'unread'`; the Unread tab leaves it, as the server does.

Every Property-scoped notice names its Property, read when it is fanned out,
so a reader with several Properties can tell rows and urgent emails apart. The
Google connection's notices are the exception: the connection belongs to the
Organization. `integration.reauthorization_required` is mailed, so it is filed
under a Property that is only a delivery anchor and never named in its copy;
with no active Property to anchor it, it goes to the AccountAdmins' bell at
Organization scope instead, unmailed (migration 0035).
`integration.google_disconnected` is in-app only, so it is Organization-scoped
outright and points at the connection. Both Organization shapes reach every
current AccountAdmin — the disconnect notice less the one who disconnected —
through the `organization_account_admin` audience: `account_admin` is
Property-scoped and the delivery check refuses a Property-less notice under
it. On `/notifications`, rows with no Property are grouped as "Account and
security" when mandatory and "Organization" otherwise.

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
self-assignment, an AccountAdmin's own escalation or submission, a submitter
approving or rejecting their own reply — and keeps everyone else. A reply's
outcomes (approved, rejected, published, publish failed, publication
cancelled) go to its author as Review defines it: whoever last submitted it,
else its creator. Google's publication outcomes have no actor and always
reach that author. One notice is about the reader's own action on purpose: a
member who leaves still gets the mandatory access notice, as "You left the
organization", from an optional `removedBy` on `identity.member.removed`; the
payload keeps only a `leftOrganization` flag, never the actor.

A note reaches the assignee, the item's responsible scope and everyone who has
written on it before, minus the actor, each under the audience that admitted
them (`inbox_assignee`, the responsible scope, or `inbox_note_author`). A
Review revision and a reopen reach the item's eligible assignee beside its
responsible scope, as a passed Response Target already did. A manual
reassignment tells the previous holder, as `inbox.unassigned`, without naming
who has it now; a bulk reassignment, a take-over included, tells each previous
holder once per Property, as the grouped `inbox.bulk_unassigned`
(`property_operator`, opening the Property's open queue). A bulk release, and a
release caused by lost eligibility, tell no previous holder.

An approval request goes to the Property's responsible managers who hold
`reply.manage` (the `reply_approver` audience), falling back to AccountAdmins
only when none of them can act, and never to the submitter. Responsibility and
that permission are separate authorities, so the audience check and the
pre-send standing check ask both. An escalation follows the item's own
responsible scope, Property or Portal, with the same admin fallback every
responsible-scope route has; the escalating manager is removed before that
fallback is considered, so a scope that names only them reaches the other
AccountAdmins, and an escalation that reaches nobody logs a warning. When it
is resolved, the notice goes to the tier the escalation went to (the Portal's
managers for private feedback, no manager for feedback with no known Portal)
and to the AccountAdmins who were told it was raised — proved by Feed's own
`inbox.escalated` rows for that item whose latest arrival is at or after the
item's current `escalated_at` — and to nobody who was not.

A notice that asks its reader for work stops asking once the work is done.
The actionable types are named in `domain/notification-settlement.ts` — the
arrivals (`review.created`, `review.updated`, `feedback.created`) included;
the settlement consumers retire every recipient's still-waiting row for a
(type, resource) when the finishing fact arrives and cancel the still-sendable
mail behind them. `property.archived` settles by Property instead, every
actionable notice there except the Organization's Google reconnect request. A
grouped reopen is settled by row id, once none of the cycles it stands for is
still its item's open head. The one retractable type,
`account.organization_purge_pending`, is taken back when the purge is
cancelled, its mail cancelled as `purge_cancelled`. Settling stamps
`resolvedAt` and leaves `status` alone, because read is not resolved: a
settled row leaves the unread count and the Unread tab and stays in the feed
under a "Done" marker; a repeat on the resource is a new row. The work itself
is asked (`application/notification-work-state.ts`) before a notice is
written (finished work settles the delivery as obsolete, with no row), before
its email or digest line leaves, and before a settling fact retires a type,
so a request made again since keeps its notice. Immediately before the
provider effect, the immediate path and the digest both also ask whether the
row is still actionable — unsettled, unread (an email-only anchor counts as
unread), undismissed — and retire it as `work_no_longer_waiting` otherwise. A
notice that reports an outcome is never held back that way; a retractable one
is held back only once taken back.

A request to choose a responsible manager is raised for AccountAdmins other
than whoever opened the gap — the fact names them, including an admin who
cleared the responsible managers — and only while the Property or Portal
still has no eligible manager, rechecked at delivery by the
`responsibility_gap` audience; its email is sent only while the recipient is
still an AccountAdmin. One offboarding still raises one notice per affected
Property and Portal; grouping them into a single Organization-scoped notice is
open, because invariant 6 admits only the Organization-scoped types it names. A
failed publication goes to its author while they can still act on the
Property, otherwise to the Property's responsible managers (AccountAdmins when
none is eligible), so it always reaches someone who can retry it.

A publication cancelled after approval reaches the reply's author and the
people who can approve it again — the Property's responsible managers who may
approve (`reply_approver`), AccountAdmins only when none can, the author
removed before that fallback — with the copy its closed cause asks for. Only
`disconnect` and `policy`, which cancel cycles never dispatched, may say the
reply never went out. Under the `policy` cause — a Property Archive, a lost
publishing authority — an approver who is no longer eligible for the Property
is left out: that cause is what taking their authority away looks like. Every
other cause keeps them. On a Property that is no longer active the
cancellation tells nobody, the author included. The fact names no actor, so an
admin who disconnected Google is still told about their own disconnect.

The signed List-Unsubscribe URL accepts an RFC 8058 one-click POST in either
form encoding and answers 204. Its token names only the queue row or digest
batch, which retention deletes after 90 days, so the optional scopes a message
stands for are kept when it is sent, for a year; a valid token that matches
nothing still answers 204 and is logged as a warning. A browser GET on the same URL gets a confirm
page and never unsubscribes, because link scanners fetch every URL in a
message; that page's form is answered with a page. No answer reveals whether
a token is valid. A notice delivered through a Property it never names
(`PROPERTY_ANCHORED_NOTICE_TYPES`, today the Google reconnect request) is
still optional mail with a preferences link, but its List-Unsubscribe points
at the preferences page without `List-Unsubscribe-Post`: no one-click, and no
unsubscribe scope is recorded for it, alone or as a digest line. A keyring
the endpoint cannot parse is treated as unset (503 `unsubscribe_disabled`),
and the worker refuses to boot on one while `notification.send_email` is
enabled.

## Runtime

Durable outbox consumers project activity and enqueue deterministic notification
jobs. One consumer family does the opposite: the settlement consumers subscribe
to the facts that finish work and write through the notification and email
repositories directly, because settling is one bounded update per fact with no
per-recipient decision to fan out. A bulk Inbox command (assignment, reopen) notifies once per recipient per
Property from its completion fact; the per-item facts it covers stay history.
An offboarding or eligibility release does the same: one notice per Property to
the Property's responsible managers, less the departing member and less
whoever released them, counting only the open items released.
So a grouped reopen stands while any of its items is still the open head the
recipient is responsible for, and says how many are when it is delivered; a
grouped assignment likewise stands for the items still assigned to its
recipient. Both counts are restated at send. A closed cycle settles a grouped
reopen in-app once none of its items stands, except a row that coalesced a
second bulk reopen.
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
only those scopes' rows, so a dark backlog cannot saturate it. The in-app
delivery-lag count leaves out route facts whose consumer announces nothing
(`silent-route-fact.ts` restates those consumers' rules in SQL: a change to
either belongs in both), so an import's silent facts do not page. A
quiet-hours hold on an immediate email schedules its own release job for the
minute the window ends (`quiet-release-<emailId>-<ms>`); the hourly sweep is
the fallback. Each email's
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
   answers only with an instant (the latest occurrence) and whether the reader
   left on their own — no Organization id or name, no actor, no row id — and
   takes its subject from the session. A
   second user-scoped read needs its own decision here. Notification mutations
   additionally prove row ownership by the current user. The in-app feed and
   its unread badge also follow the reader's current Property access for
   `notification.read`, so a revoked or expired grant hides that Property's
   rows; Organization-scoped notices are never Property-gated.
3. Activity replay and notification delivery are idempotent. Redelivery must
   converge through receipts and deterministic identities.
4. Email delivery rechecks preference, capability, responsibility, delayed
   execution policy, and whether the work still waits immediately before the
   provider effect.
5. User-facing notification copy is produced only by
   `domain/notification-templates.ts`.
6. Mandatory notices are Organization-scoped; every other notice is
   Property-scoped, with three named exceptions. `beta_feedback.outcome`
   (ADR 0059) and `integration.google_disconnected` (ADR 0046, amended
   2026-09-24) are Organization-scoped `workflow_collaboration`: in-app by
   ADR 0046 defaults and never mailed. `integration.reauthorization_required`
   is Organization-scoped `urgent_operational` only when no active Property
   can anchor it, and then is never mailed either (ADR 0046, amended
   2026-09-28). Each is admitted by name, in a branch of its own, in
   `notifications_mandatory_scope_check`. A new exception needs its own ADR and
   a CHECK change.
7. Operational Action History list/export responses are private and no-store.

## Verification

Unit tests stay beside domain rules, use cases, consumers, jobs, and server
contracts. PostgreSQL-backed repository, recovery, delivery, export, and
lifecycle tests stay beside their infrastructure subjects. The build test pins
that one Feed build exposes both former APIs without widening either lifecycle
surface.
