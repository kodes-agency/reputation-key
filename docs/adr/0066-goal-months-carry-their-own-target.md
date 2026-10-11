---
status: accepted
date: 2026-10-12
---

# 0066 — Goal months carry their own target

Amends the Reporting CONTEXT (the Goal Program glossary line, invariant 2 and the
new invariant 8) and [ADR 0046](0046-notification-policy.md) (the Goal notice
marker).

## Context

A Goal Program is a monthly target over an approved metric and a set of
subjects. Its target lives on the Program version, and every monthly result is
pinned to the version it opened under. A version's window is made of whole
Property-local months, so a version cannot be split inside a month.

That left a manager with a wrong number for the month in progress no way to fix
it. A revision starts with the next full month. Updating the version's target in
place would have changed the target of every month that had already closed
under that version, after the fact.

The owner decision of 2026-10-11 (D2 of the flexible goal months plan) is that
the month carries its own target: while a month is running a manager can change
that month's target, the change is shown and logged with who, when, old and new
value and an optional note, and once the period ends the target is locked. By
default the new target also applies to the months after.

## Decision

1. **The month is the carrier.** `goal_monthly_results.target_value` is
   nullable; NULL means the month uses its version's target. The target a month
   is judged against is `row.target_value ?? version.target_value`
   (`effectiveMonthTarget`). Evaluation reads it when a month is reconciled,
   when it closes and when a closed month is corrected; the two behind-pace
   queries restate it as `coalesce`. Every surface that shows the target of a
   month reads it the same way: the goal card, the results matrix and the month
   rows of the goal page.
2. **A version's target is never updated in place.** A different target for the
   running month is that month's own. A different target for the months after is
   a new version. Months that closed under a version keep the target they closed
   against.
3. **The lock is the database's.** `guard_goal_monthly_result_v1` lets a row
   take or change a target only while it is `open` and `clock_timestamp()` is
   before its `period_end`, on INSERT and on UPDATE, and holds the value to the
   version's measure rule (a positive whole number for the two counts, 1 to 5
   with one decimal for the average). A closed row is immutable as before. So a
   stored target always means "set while the month ran".
4. **One command, decided before it writes.** `changeMonthTarget` needs
   `goal.update`. It opens an active goal's due months first, as the other
   change commands do. Paused goals may change their running month; ended goals
   may not. The form sends the month it showed (`YYYY-MM`), the target it showed
   and the version it was opened on:
   - a month that has ended answers `month_locked`, and a form left open over
     the end of a month never changes the month that began meanwhile;
   - a goal with no running month answers `no_open_month`;
   - the target is validated against the measure of the version the month
     belongs to, not of a change still waiting for its month;
   - a goal that moved on under the form answers `revision_conflict`. The one
     exception is a save sent twice: when the month already has the target and
     nothing else would be written, the command answers `unchanged`.
5. **The months after have an outcome, and it is stored.** Not asked:
   `not_requested`. The version that will govern them already has the target:
   `applied`, and no version is written. No change is waiting: a new version
   from the next month with the same measure and subjects, `applied`. A change
   with the same measure is waiting for its month: it is replaced by one with
   the new target and its own subjects, `replaced_scheduled_change`. A waiting
   change with another measure keeps its target, `kept_scheduled_change`. A
   subject that is no longer part of the Property, or a measure that cannot be
   read, gives `not_applied` with `subject_unavailable` or `metric_unavailable`;
   no subject is dropped from the goal to make the version fit. In the last two
   cases the month still changes and the answer says the months after did not.
6. **One transaction.** The repository takes the Program row with a
   compare-and-set on its head (the lock every writer of versions takes first)
   and refuses an ended Program; writes the following version through the same
   `reviseInTx` an ordinary revision uses; locks the months that are open and
   running at the command's instant; checks that they are the months the command
   read, with the targets it read; changes their target; writes one log row per
   month under a shared `change_id`; and writes the audit row
   `goal.month_target.changed`. A refusal by the guard on that one UPDATE (55000
   or 23514) is answered as `month_locked`. Any failure rolls all of it back.
7. **The log is the record.** `goal_month_target_changes` holds the month, the
   old and the new value, the outcome for the months after, the version this
   change wrote for them (null when it wrote none), the note, who and when. Its
   month and its following version belong to its Program by foreign key, and
   one command writes at most one row per month. It is read with the Program by
   `get` and `list` only, filtered by organization, Property and Program
   together. It is exported with the Organization and purged before the result
   revisions.
8. **A month put back on its version's target stores none of its own.** The
   change is still logged. The month then reads exactly like one that was never
   changed wherever a target is compared, which is what "judged against the
   target it started with" means.
9. **Every surface says so.** A month whose target is not the one it started
   with shows who changed it last, when, what it started at and how many times
   it changed (`monthTargetMarker`); a month changed and changed back shows
   nothing. The two Goal notices and the Recent Activity row of a met month
   carry `target_changed` for a month that closed on a target of its own
   (ADR 0046).

## Consequences

- **Images older than the storage release are unsafe once a month has its own
  target.** The storage and its readers shipped first (migration 0054, the
  commit of "month target storage and readers"); the command ships after both
  web and worker run that release. That commit is the worker's rollback floor.
  Before rolling the worker back, run
  `SELECT count(*) FROM goal_monthly_results WHERE target_value IS NOT NULL AND status <> 'closed'`.
  If it is not zero, do not go below the floor: an older worker would close that
  month against the version's target, and a closed row cannot be corrected in
  place. An older web image shows the version's target for such a month but
  writes nothing wrong.
- If a deploy stops after web and before worker, finish the worker step before
  anyone uses "Change this month's target".
- A target can be lowered on the last day of a month, and the month then closes
  as met. Nothing prevents that. The control is that it is visible: the log,
  the marker on every surface that shows the target, and the notice clause.
- The command's clock and the database's can disagree for an instant around the
  end of a month. The command filters with its injected clock, so its tests are
  deterministic; the guard has the last word, and its refusal reads as
  `month_locked`, not as a failure.
- A log row's following version can later be replaced before its month begins.
  The row still says `applied`, which was true when it was written; the version
  then has an empty window, and a reader of the history has to look at it.
- The Organization export gains the column and the log; its payload version is
  unchanged because the change only adds.

## Rejected alternatives

- **Update the version's target.** It would retarget every month that closed
  under the version.
- **Split the version inside the month.** A month's result is pinned to one
  version and must lie inside its window; the database refuses the rest.
- **Two transactions, the month first and the following version second.** A
  failure between them leaves a log that claims the months after were changed.
- **Store the tick ("also from next month") instead of the outcome.** The log
  is shown and exported; it has to say what happened, not what was asked.
- **A guard trigger on the log table.** It would need a bypass for the
  Organization purge, and the log records a value from before the month closed,
  not closed evidence.
- **An application-only lock.** A writer that forgot the check, or a clock that
  ran behind, could change a month after it ended. The guard cannot be
  forgotten.
