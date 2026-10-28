---
status: accepted
date: 2026-10-28
---

# 0071 — Inbox manual priority

Amends [ADR 0055](0055-stable-review-and-inbox-handling-cycles.md) (decision 9)
and [ADR 0057](0057-inbox-queues.md) (the 2026-10-28 amendment's filter rule), each
by a dated note that points here. Priority adds no queue and no count.

## Context

The Inbox's only "priority" was the AI review analysis' attention level
(`attentionFor()`, `analyze-review-event.ts`): urgent for a safety, health,
discrimination, legal or fraud signal; high for a service failure or a very
negative review; medium and low below that. The Inbox read it live through the
AI port for the Priority filter and the list's Urgent tint (#857), and showed
"Needs attention" under a review's topics for urgent or high. A manager could
not change it, private feedback (never analysed) never had one, and a review
the AI misjudged stayed misjudged.

On 2026-10-18 the owner chose "full manual priority": managers set Urgent,
High, Medium or Low on any Inbox item, Reviews and private feedback alike, with
the AI level as the starting point. On 2026-10-28 the owner settled the open
questions (decisions P-1 to P-8). What binds the design:

- **No AI output may mutate Inbox state** (`docs/BETA.md` §3). AI invariants 1,
  4, 5 and 8: manager-internal data never enters AI; disabling AI hides its
  outputs and erasure purges them; provider output is advisory; missing data is
  never shown as a value. ADR 0031: AI derivatives keep their own lifecycle.
- **Inbox invariants 2 and 3**: every human command authorizes its actor inside
  the write transaction, and decides Property scope before the revision.
- **ADR 0030**: facts carry identifiers only. **ADR 0056**: history is never
  described as audit-grade.

## Decision

1. **Priority is a fifth independent Inbox axis**, beside open/closed,
   assignment, escalation and seen state (ADR 0055 decision 9). It never opens,
   closes or reopens a Handling Cycle, never escalates, never changes a
   Response Target and never notifies. It shares the item's command fence
   (`commandRevision`) with the other item commands, so a priority change
   refuses a bulk command whose rows predate it, and the bulk path re-reads.
2. **Inbox stores only the level a person set**: `inbox_items.manager_priority`
   (`urgent | high | medium | low`), `manager_priority_set_by` and
   `manager_priority_set_at`, all three or none (migration 0077,
   `inbox_items_manager_priority_stamped`). The AI level is a live suggestion
   read through `aiInsights` and never copied — not into a column, the
   history, a fact or the export — so turning AI off or erasing AI data still
   removes it at once, and Inbox holds nothing to erase.
3. **The effective level** — the set level, else the current suggestion (a
   Review's only; feedback is never analysed), else "Not set" — drives the
   list's cue (Urgent: #857's red tint and word; High: three bars and the word,
   no tint; Medium and Low silent), the toolbar, and the Priority filter and its
   count, for Reviews and feedback alike, so the filter is offered in every
   queue, the private feedback queues included. The list and the filter ask the AI's
   id gate (`findCurrentReviewIdsByAttention`); the toolbar reads the detail's
   stricter delivery gate (`readCurrentReviewAnalysis`, which also fences on
   the notice and redaction profile). After a notice or redaction change the
   two can disagree until re-analysis. This is accepted for v1; the toolbar is
   authoritative for the open item.
4. **A set level persists** through guest edits and new feedback messages
   (owner P-6). Once the new words are analysed, the detail says "Review
   signals suggest X." if the suggestion differs. Lapsing on an edit can come
   later without data change: history records each decision's cycle.
5. **Only a signed-in manager's web command writes it** (`setInboxItemPriority`,
   gated like Escalate: `inbox.write`, the source's handle permission and
   Property scope on the server, `inbox.manage` in the client). The command
   store refuses a priority write whose fact names no web actor — otherwise
   `transition()` would authorize nobody — and re-authorizes that actor in the
   transaction. Its emergency switch is the existing `inbox.write` execution
   action (ADR 0049). It is excluded from Reporting and AI.
6. **Two managers at once**: a stale revision from an unrelated change is
   answered with the conflict result the client retries once; a change to the
   priority itself is refused with `priority_changed` (409, "Someone else
   changed the priority just now. Check it and choose again."), which the retry
   never replays, so nobody's choice is overwritten unseen. A colleague's
   identical choice, and a pick of the level already set, are silent no-ops: no
   history row, no fact, no revision bump.
7. **History is a sixth append-only table**, `inbox_priority_history`, keyed by
   the command revision it produced: a person's level, the one before, the
   actor (never null) and the cycle. A reset is a NULL level. It holds no AI
   level and no free text, and it is not described as audit-grade. Each
   decision also records one identifier-only, audit-only fact,
   `inbox.inbox_item.priority_changed`, with no consumer: nothing reaches
   Recent Activity or a notification (owner P-4).
8. **No priority sort, no queue, no bulk** in v1 (owner P-3, P-7). The URL and
   DTO key `attention` keeps its name and now means the effective level; its
   one new URL value, `urgent_high`, is "Urgent and High". The cursor stays
   `(sourceDate, id)` (Inbox invariant 11).

## Consequences

- The review's "Needs attention" topic pill is retired (owner P-5): it showed
  the AI's level and contradicted a manager's. Those words are no longer a
  priority cue anywhere; the toolbar's Priority member is the one place a
  level is read.
- The list re-reads after a priority change, so an item that leaves an active
  Priority filter closes the pane, as a status or escalation change does.
- `inbox_escalation_history` moved, unchanged, into
  `inbox-triage-history.schema.ts` beside the priority history, to keep
  `inbox.schema.ts` within its length ratchet.
- The organization export carries the three columns and a
  `priority-history` file; every `inbox_items` column is now either exported
  or named as not exported, by a test.

## Rejected alternatives

- **Store the AI level when a manager accepts it**: an AI copy outside AI's
  lifecycle (erasure and disable would miss it). Picking the suggested level
  stores it as the manager's own choice instead; there is no "Accept".
- **A single on/off flag**: the owner kept four levels (P-1), and a binary flag
  grows into levels only with migration debt.
- **Flags for priority** (moving Escalate to another glyph): every manager would
  relearn Escalate across five places (P-2). Priority wears signal bars.
- **A rating-based starting point for feedback**: a second, unversioned scoring
  formula; feedback starts "Not set" (P-1).
