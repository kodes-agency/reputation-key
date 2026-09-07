# Inbox — Context

**Audience:** Developers and agents working in `src/contexts/inbox/`.

## Responsibility

Unified triage for Reviews and private feedback: open/closed workflow state,
assignment, escalation, internal notes, Handling Cycles, Response Targets, and
new-item counts.

## Boundaries

- Inbox reads eligible Review and Guest content through context-owned lookup
  ports, never cross-context SQL. Handling stores remain content-free.
- Review visibility requires `inbox.read ∧ review.read`; private-feedback
  visibility requires `inbox.read ∧ feedback.read`.
- Review workflow requires `inbox.write ∧ review.read`; feedback handling requires
  `inbox.write ∧ feedback.handle`. Assignment never grants either permission.
- Review owns exact Google reply truth. Guest owns ratings, feedback text,
  correction, and withdrawal. Identity/Staff own manager eligibility.
- Recent Activity is **never** evidence that an Inbox command committed, so history is merged from Inbox's five append-only tables — `inbox_handling_cycles`, `inbox_handling_cycle_transitions`, `inbox_assignment_history`, `inbox_escalation_history` and `inbox_feedback_handling_outcomes` — and never from the activity feed.
- The organization-export contributor remains outside `publicApi`; no request path
  may call it.

## Model

An Inbox Item points to exactly one Review or feedback source and carries only
triage state. A Handling Cycle is an immutable numbered work episode anchored to
one source revision; its compare-and-swap head selects the current episode and
state revision. Feedback Handling Outcomes are append-only manager results, and
corrections supersede rather than rewrite them.

Google Review and private-feedback Response Targets default to 48 elapsed hours.
Each measured cycle snapshots its duration, policy version, start/due time, and
halfway/target-passed reminder slots.

## Runtime

Source lifecycle facts arrive through durable, apply-once consumers. Inbox-owned
command stores atomically commit item/cycle state, receipts, history, and
identifier-only facts. `review.reply.observed` is a wake-up hint; the exact-current
permit is checked under Review's observation fence before Inbox commits closure or
reopen work. The reminder job runs every five minutes and Notification revalidates
recipients immediately before delivery.

Handling History uses one bounded transition reader and a total order of
`(occurredAt, cycleNumber, stateRevision, kind, id)`. Actor names are resolved in
one Organization-scoped batch and reveal no email, avatar, role, or membership
state.

## Invariants

1. Bare ratings (no feedback comment) do not create Inbox Items.
2. Every human command authorizes its complete unique `(principal, Property)` requirement set once inside the write transaction. Multi-item commands cannot lock the permission generation after one item and then acquire a later item's membership or grant row.
3. Human mutations compare-and-swap the observed item revision; adding a note
   advances the same fence atomically with its identifier-only fact.
4. Bulk Close is unavailable. Bulk Reopen accepts at most 100 distinct item/revision pairs, preauthorizes the complete candidate set once, applies compare-and-swap writes in stable Inbox-item-ID order, and reconstructs privacy-safe results in caller order.
5. Generic status commands never close work. Review closure is provider/source-authoritative; a manager closes an open private-feedback cycle only through `markFeedbackHandled` with exactly one controlled outcome.
6. Outcome corrections append a directly superseding fact under exact item/cycle/source/state/outcome revision fences. They preserve the first completion instant and deadline result, leave the cycle closed, and never alter the source rating.
7. A source-epoch carry of unchanged Review material advances the head fence in
   place; it does not open or reopen a Handling Cycle, change status, or manufacture work.
8. Provider write acknowledgement and the internal `review.reply.published` lifecycle fact are not Google truth and cannot mutate Inbox status.
9. A stale/replayed observation cannot close or reopen work twice. An orphan or
   mismatched compatibility row is repair-visible but never actionable.
10. List cursors are canonical bounded base64 JSON; malformed values are discarded
    before SQL and never echoed into logs. Seen watermarks advance monotonically
    only after a successful first page.
11. Only an exact current live Google observation completes a Review target. Both `confirmed_on_google` and `external_current_live` count as observed-live completion; provider acknowledgement and `review.reply.published` do not.
12. Analytics never mix Review and feedback targets. Reminders never auto-escalate.
13. Inbox notes, private feedback, Review or Reply text, contact details, credentials, and raw network values must never enter the Activity projection or replay fact.

## Verification

Unit tests stay beside domain rules, use cases, durable consumers, jobs, server
contracts, cache policy, and Handling History. PostgreSQL integration tests cover
command atomicity, authorization/revision races, exact-current Review callbacks,
feedback outcomes, Response Targets, lifecycle, and export boundaries.

These statements describe repository wiring, not hosted activation evidence. Deployed scheduler ticks, worker/outbox health, migration state, and end-user delivery must be evidenced separately; see `docs/operations/inbox-response-targets.md`.
