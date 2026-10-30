# Inbox — Context

**Audience:** Developers and agents working in `src/contexts/inbox/`.

## Responsibility

Unified triage for Reviews and private feedback: open/closed workflow state,
assignment, escalation, manager priority, internal notes, Handling Cycles,
Response Targets, and new-item counts.

## Boundaries

- Inbox reads eligible Review and Guest content through context-owned lookup
  ports, never cross-context SQL. Handling stores remain content-free.
- Review visibility requires `inbox.read ∧ review.read`; private-feedback
  visibility requires `inbox.read ∧ feedback.read`.
- Review workflow requires `inbox.write ∧ review.read`; feedback handling requires
  `inbox.write ∧ feedback.handle`. Assignment never grants either permission.
- Review owns exact Google reply truth. Guest owns ratings, feedback text,
  correction, and withdrawal. Identity owns manager eligibility (membership, role, PropertyAccessGrant); Staff participation plays no part.
- Recent Activity is **never** evidence that an Inbox command committed, so history is merged from Inbox's six append-only tables — `inbox_handling_cycles`, `inbox_handling_cycle_transitions`, `inbox_assignment_history`, `inbox_escalation_history`, `inbox_priority_history` and `inbox_feedback_handling_outcomes` — and never from the activity feed.
- The organization-export contributor remains outside `publicApi`; no request path
  may call it.

## Model

An Inbox Item points to exactly one Review or feedback source and carries only
triage state. A Handling Cycle is an immutable numbered work episode anchored to
one source revision; its compare-and-swap head selects the current episode and
state revision. Feedback Handling Outcomes are append-only manager results, and
corrections supersede rather than rewrite them.

An item's priority is a person's choice (ADR 0071). A manager sets Urgent,
High, Medium or Low on any Review or private-feedback item
(`setInboxItemPriority`, server function `setInboxItemPriorityFn`, gated like
Escalate); Inbox stores the level, who set it and when on `inbox_items`
(`manager_priority*`) and one `inbox_priority_history` row per decision, and
records the audit-only `inbox.inbox_item.priority_changed` fact. The AI's
attention level is only a suggestion: it is read live through `aiInsights`
and never stored here, so turning AI off or erasing AI data still removes it.
What a manager sees — the list's Urgent tint and High cue, the toolbar, the
Priority filter and its count — is the EFFECTIVE level: the set level,
otherwise the current suggestion (Reviews only; feedback is never analysed),
otherwise "Not set". A set level survives guest edits and new feedback
messages; picking the level already set writes nothing; a refusal names a
colleague's change to the priority itself (`priority_changed`, never replayed
by the client's revision retry). The list asks the AI's id gate for its
suggestions and the toolbar reads the detail's stricter delivery gate, so the
two can briefly disagree after a notice or redaction change; the toolbar is
authoritative for the open item.

A Review item's detail reads the AI's current analysis through `aiInsights`. A v3 reading
arrives as `ready_v3`: `mentions` (topic, polarity, strength, the thing and what was wrong with it,
the Property issue each belongs to now, the one-based numbers of the sentences that state it, and a
manager's correction if there is one) and `analysisSequence`, the reading's own number. The pane
draws one chip per cause ("Air conditioning, not working · Complaint") and underlines the cited
sentences in the guest's own words: the numbers are resolved in the browser with
`review-sentences-v1` against the text the detail already holds, nothing is stored, a number the
words no longer reach underlines nothing, and only the original text is marked (never a
translation). An Urgent reading also says why, in one line above the chips ("Urgent · The guest
reports a risk to safety."): this is where the reason is told, because the Urgent alert that brings
a manager here, its email and its bell row carry none (ADR 0046 r.8; `URGENT_REASON_SENTENCES_V3`),
and the line stays when a manager corrects a cause, which changes what was named and not the risk a
guest reported. A guest edit is a new analysis, so its corrections start empty. The Guest voice link
`?issue=<issueId>` (with `polarity`) narrows the list to the Reviews whose current analysis names
that issue, corrections laid over it (`findCurrentReviewIdsByIssue`; `polarity` then belongs to the
issue and the topic filter is skipped), and the chips that are that issue wear a ring with one line
saying in words which. "Not right?" is the manager's correction of a reading: Inbox holds no state
for it and calls the AI context's `correctReviewMentionFn`. The control is offered to
`inbox.write ∧ inbox.manage` on a Review whose reading names something; the server asks `inbox.write`
and the Property grant again, and a correction refreshes the open review, the list and the
Property's Guest voice at once.

A Review item's detail carries the way to the review on Google: its own
Business Profile page (`googleReviewUrl`, from Review's eligible snippet, so
null whenever the words are not served) and, as the fallback, the Property's
public reviews page (`googlePropertyReviewsUrl`, from a `verified` Property
destination naming a place: `https://search.google.com/local/reviews?placeid=`).
The second needs no content eligibility: it is Property-level and opens signed
out. The first carries the Business Profile location id to a reader who holds
`inbox.read ∧ review.read`, because that is the page; nothing else in an
Inbox payload names a provider identifier. Both are links only (a new tab,
`noopener noreferrer`, no referrer) and Inbox stores neither.

A manager can also ask Google about a review from the detail (2026-10-21), at
two moments, through one Inbox use case (`checkInboxReviewOnGoogle`, server
function `checkReviewOnGoogleFn`) over the same `GoogleReviewCheckPort` the
reminder uses. Review reads the review and records what Google shows; if that is
a reply, the normal `review.reply.observed` path closes the item within seconds.
The use case adds the authorization (exactly viewing the item: `inbox.read`,
`review.read` and the item's Property, so a missing or another Organization's
review is `not_found`), a budget, and a content-free verdict: `reply_found`
(Review's reply head is live and answers the review), `no_reply`, `unavailable`
(Google could not be read, or its reply could not be recovered), `not_checkable`
(not a Google review, no Google connection, content expired, Google no longer has
the review) or `rate_limited`. A refusal to authorize is the only error. The
budget is one call per review per 60 seconds and 30 per Organization per minute
(`GOOGLE_CHECK_REVIEW_LIMIT`, `GOOGLE_CHECK_ORGANIZATION_LIMIT`, on the shared
Redis limiter; the narrower budget is spent first, and a limiter that cannot
answer is `unavailable`, not a denial of the manager). The two moments:

1. **On demand.** "Check on Google" sits next to "Open on Google" in the
   detail's menu for a Google review item, shows its own pending state while it
   runs, and answers in a toast. A review the server calls `not_checkable` stops
   being offered for the rest of the session.
2. **On return from Google.** Choosing "Open on Google" (or "See reviews on
   Google") remembers the review and the time. When the tab is visible again within
   30 minutes and the same item is still open, the Inbox checks at once, and again
   2 and 10 minutes later while the item stays open and the tab visible. It stops
   when a reply is found, the item closes or the manager moves to another item;
   nothing runs while the tab is hidden. It speaks only when it finds the reply.

Nothing here changes the reminder pre-check, sync, or how a reply closes an item.

A guest edit (a new Material Revision) that lands on a CLOSED Review cycle
reopens the item: the transition is `reopened` with reason
`material_revision_changed`, because a reply written for revision N does not
answer revision N+1 and whoever considered the item finished has to be told
(ADR 0046, amended 2026-09-28). The reopened cycle keeps its Response Target
open until the edit is answered, so it counts in reminders, target results and
open items. An edit that supersedes an OPEN cycle is an opening, and so is a
new private-feedback occurrence: the guest wrote again, which is new work
rather than finished work coming back.

Google Review and private-feedback Response Targets default to 48 elapsed hours.
Each measured cycle snapshots its duration, policy version, start/due time, and
halfway/target-passed reminder slots. A halfway slot already due when the target
is recorded is never created, and one still pending once its target has passed is
cancelled rather than released, so a target overdue on arrival, or a late
release, prompts once, with target passed. Archiving a Property cancels its
unreleased slots (`inbox.on-property-archived`), as Organization closing does,
and Restore re-arms none of them: a cancelled slot is terminal.

A Google Review target stops at the reply's time on Google, not at the read that
saw it (ADR 0046, amended 2026-10-21): `clamp(Google's reply updateTime, target
start_at, observed time)`, carried to Inbox on Review's exact-current permit, with
the observation time as the fallback when Google gives none. It is written once at
the close and never moved by a later edit; only the completion (and
`first_reply_published_at`) use it, while `updated_at`, reminder cancellations and
`closed_at` stay at the observation time. Google's time is the reply's last edit,
so a reply edited before RepKey reads it counts at the edit. An item with no
measured target (none, `legacy_unknown`, onboarding history) has no start to clamp
to, so its first-reply time is bounded only above by the observation time. Targets
closed before this release keep their read-time completion; there is no backfill.

A Google-review reminder is checked against Google before it is released
(ADR 0046, amended 2026-10-21), because about 97% of replies are written on
Google and RepKey learns of them only at the next sync. The reminder job reads
the review once through the Inbox-owned `GoogleReviewCheckPort` (Review does the
read and records it, the same as a sync) and _holds_ the slot when Review's
reply head is live, answers the review, was observed at or after the cycle's
target start, and is on the cycle's Material Review Revision. A held slot writes
nothing and stays pending; the close the reply observation raises cancels it, so
a held slot is not a cancelled slot. Every other outcome releases (the check
fails open): no reply, a reply observed before the target restarted (a manager
reopened after it), a new material revision, a reply RepKey cannot read, or
content that has expired or been erased (never re-read). A read that fails
transiently leaves the slot pending until 15 minutes after its `scheduled_for`,
then releases; a permanent condition (capability off, no Google provider,
connection needing reauthorization) releases at once. No transaction or lock is
held across the Google read, private-feedback slots are never checked, and a tick
reads Google at most 20 times (a slot that never reaches Google spends none; one
past the limit waits for the next tick, however late it is).

An Organization may give its own low-rated Google reviews a shorter target — a
star threshold and a shorter duration on the same Google policy row — so their
reminders fall sooner. This is where a review's rating changes how soon someone
is prompted: the rating stays here, read from Review's attested target permit,
and Feed never sees one (ADR 0046 r.8). It is off by default, because
shortening a target changes which cycles count as late.

## Queues

The rail is two titled sections and the shared views (ADR 0057, amended
2026-10-28). Each queue is a key (`INBOX_QUEUES`, `application/inbox-queues.ts`)
that `queueToFilters` turns into the list's own predicates, and the same
predicates count it.

| Section          | Rail row           | Key         | Holds                                                   |
| ---------------- | ------------------ | ----------- | ------------------------------------------------------- |
| Reviews          | Needs reply        | `reply`     | open Reviews outside the awaiting and waiting stages    |
|                  | Awaiting approval  | `approval`  | open Reviews with a reply pending approval              |
|                  | Waiting for Google | `waiting`   | open Reviews whose reply is approved or being published |
|                  | Replied            | `replied`   | every closed Review                                     |
| Private feedback | To handle          | `feedback`  | open private feedback                                   |
|                  | Handled            | `handled`   | every closed private feedback                           |
| (no heading)     | Mine               | `mine`      | open items assigned to the viewer, of both kinds        |
|                  | Escalated          | `escalated` | every active unresolved escalation, of both kinds       |
|                  | All open           | `open`      | every open item, of both kinds                          |

`closed` (every closed item) is still a valid key but is no longer in the rail;
the client reads `queue=closed` and `folder=closed` as `replied`. Replied and
Handled are archives: they are never counted and carry no badge, so a manager's
rail is one stage lookup and seven counts (five without reply stages), each equal
to its list total.

Without reply stages (`reply.manage` missing, or `property.publish_reply`
unavailable) the Reviews section is one row, "Open", under the `reply` key, which
then holds every open Review; `approval` and `waiting` are refused. The server
functions pass the reply policy's answer for `reply` to the use cases as
`replyQueuesEnabled`, as they always did for the counts, rather than refusing the
request. Only a settled denial is that answer: a policy that cannot answer
(`policy_unavailable`) refuses the request, so an outage never serves another set
than the page is drawn for. The queue counts carry the answer as `replyStages`,
and the browser draws the rail, the labels and the empty copy from it; its own
permissions and capability set only guess until the counts arrive.

A section is drawn for a viewer who can read its kind (`review.read`,
`feedback.read`); All open only when both are visible. Private feedback stays in
the rail when empty, so its empty state can say where feedback comes from.

## Runtime

Source lifecycle facts arrive through durable, apply-once consumers. Inbox-owned
command stores atomically commit item/cycle state, receipts, history, and
identifier-only facts. When a Review is first projected after it has already
changed, the replayed Material Revision cycles are real history but nobody saw
the earlier revision; their `inbox.handling_cycle.opened` facts carry
`openedWithItem: true` so Notification announces the item once, as new. A
private-feedback submission and the withdrawal that takes it back are fenced
by one receipt key: the creation consumer reserves its receipt before it
creates anything, and the withdrawal consumer first settles that same
delivery as obsolete (`settleSupersededDelivery`). A withdrawal handled
between the creation consumer's source check and its insert therefore refuses
the insert, and one that meets an insert already in flight waits for it and
then closes the item. The withdrawal names the submission by event id in its
payload, so the delivery is settled only when that event is stored for the
withdrawal's own Organization. `review.reply.observed` is a wake-up hint; the exact-current
permit is checked under Review's observation fence before Inbox commits closure or
reopen work. The reminder job runs every five minutes, checks Google before it
releases a Google-review reminder (see Response Targets above), and Notification
revalidates recipients immediately before delivery.

The projection rebuild (`rebuildInboxProjection`, `ops:rebuild-projection`)
repairs from canonical data and records no facts. Its reply milestones read
Review's reply truth, so a reply written on Google counts as published, at the
time Google reports for it (`provider_updated_at`, else when RepKey read it).
It never changes an existing item's status: an open item over a reply Google
shows can be right — a manager reopened it, or the guest edited the review
after the reply — and a rebuild cannot tell that from a lost close. An item it
creates is created closed when, inside Review's exact-current observation
permit, Google shows a reply answering the review's current revision (the
predicate `inbox.on-reply-observed` closes on, `isAnsweringGoogleReply`); that
review's observed fact gave up waiting for the item long ago and nobody else
may close a Review cycle, so an item created open would stay open for good
(decided 2026-10-18). Its cycle opens and closes at the instant Google was seen
answering (never a close before the open), and the rows carry the repair's own
write time. The item's target is `legacy_unknown`, so no completion time applies
to it, and its first reply is stamped at the same Google time the consumer path
uses. An obsolete permit creates the item open, and the newer observation's own
fact reaches it.

Handling History uses one bounded transition reader and a total order of
`(occurredAt, cycleNumber, stateRevision, kind, id)`. Actor names are resolved in
one Organization-scoped batch and reveal no email, avatar, role, or membership
state.

## Invariants

1. Bare ratings (no feedback comment) do not create Inbox Items.
2. Every human command authorizes its complete unique `(principal, Property)` requirement set once inside the write transaction. Multi-item commands cannot lock the permission generation after one item and then acquire a later item's membership or grant row.
3. Human mutations compare-and-swap the observed item revision; adding a note
   advances the same fence atomically with its identifier-only fact. A
   single-item command decides Property scope before it answers the revision,
   as the bulk commands do, so a conflict (which names the item's current
   revision and status) is never returned for an item the caller may not act on.
4. Bulk Close is unavailable. Bulk Reopen accepts at most 100 distinct item/revision pairs, preauthorizes the complete candidate set once, applies compare-and-swap writes in stable Inbox-item-ID order, and reconstructs privacy-safe results in caller order. It commits one identifier-only `inbox.inbox_items.bulk_reopen_completed` fact naming each cycle it opened and stamps its per-item `inbox.handling_cycle.reopened` facts with the bulkId, so notification follows the one command rather than each item, as for bulk assignment.
5. An offboarding or eligibility release clears a member's assignments, records
   one identifier-only `inbox.inbox_item.unassigned` fact per item, and commits
   one grouped `inbox.inbox_items.assignments_released` close fact in the same
   transaction. That fact counts and anchors only the OPEN items released, and
   is not recorded for a Property where only closed items were released. It
   groups by Property — an anchor item, a count — never
   one entry per item: a departing fleet manager's assignments are unbounded. Notification follows the one release, not each item, as for
   bulk assignment and bulk reopen. Its closed cause is `releaseReason`,
   because the outbox adapter denylists `reason` as content.
6. Generic status commands never close work. Review closure is provider/source-authoritative; a manager closes an open private-feedback cycle only through `markFeedbackHandled` with exactly one controlled outcome.
7. Outcome corrections append a directly superseding fact under exact item/cycle/source/state/outcome revision fences. They preserve the first completion instant and deadline result, leave the cycle closed, and never alter the source rating.
8. A source-epoch carry of unchanged Review material advances the head fence in
   place; it does not open or reopen a Handling Cycle, change status, or manufacture work.
   Both paths collapse a carry the same way: the reply observation and the
   source-event projection's catch-up (`review.updated`), through one head-move
   helper. Review attests which revisions are carries; a guest edit after a
   carry, including one first seen in the new epoch, opens a cycle like any
   other edit.
9. Provider write acknowledgement and the internal `review.reply.published` lifecycle fact are not Google truth and cannot mutate Inbox status.
10. A stale/replayed observation cannot close or reopen work twice. An orphan or
    mismatched compatibility row is repair-visible but never actionable.
11. List cursors are canonical bounded base64 JSON; malformed values are discarded
    before SQL and never echoed into logs. Seen watermarks advance monotonically
    only after a successful first page.
12. Only an exact current live Google observation completes a Review target. Both `confirmed_on_google` and `external_current_live` count as a live completion, dated at Google's reply time clamped to `[target start_at, observed time]` (observed time when Google gives none), written once; provider acknowledgement and `review.reply.published` do not complete it.
13. Analytics never mix Review and feedback targets. Reminders never auto-escalate.
14. Inbox notes, private feedback, Review or Reply text, contact details, credentials, and raw network values must never enter the Activity projection or replay fact.
15. An excluded Response Target is never counted, never reminded and still closable. A row in `inbox_response_target_exclusions` (migration 0069, append-only, written only by `pnpm ops inbox exclude-restated-revision-targets` for a cycle opened on a revision Google only restated) leaves its cycle out of the Google analytics, the per-Property overdue figures, reminder selection and admission, and waiting time, through one predicate (`src/shared/db/inbox-response-target-exclusions.ts`); it reads as "Not measured". The target and cycle are untouched, so a later real reply closes both normally and the completion stays out of the figures. Inbox never reads Review tables: Review lists the restated revisions and the command hands the list in.

16. Priority is human-owned. Only a signed-in manager's command sets it: the
    command store refuses a priority write whose fact names no web actor, and
    re-authorizes that actor inside the transaction. AI levels are read, never
    stored. Setting a priority never notifies, never opens, closes or reopens a
    cycle, never escalates, never changes a Response Target, and never enters
    Reporting or AI.

## Verification

Unit tests stay beside domain rules, use cases, durable consumers, jobs, server
contracts, cache policy, and Handling History. PostgreSQL integration tests cover
command atomicity, authorization/revision races, exact-current Review callbacks,
feedback outcomes, Response Targets, lifecycle, and export boundaries.

These statements describe repository wiring, not hosted activation evidence. Deployed scheduler ticks, worker/outbox health, migration state, and end-user delivery must be evidenced separately; see `docs/operations/inbox-response-targets.md`.
