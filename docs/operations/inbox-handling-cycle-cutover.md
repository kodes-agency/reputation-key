# Inbox Handling Cycle legacy cutover and parity

This IBX-01 runbook produces the signed cutover/parity evidence for the Inbox
Handling Cycle. It classifies every pre-cutover `inbox_items` row against the
Handling Cycle tables, reconciles head coverage, compatibility-mirror drift and
Response Target lineage, and records the one policy decision that data cannot
answer: which start instant a **current-open private feedback** item gets.

It is a report. It is not a migration, a repair, a backfill, a schema
contraction, or a release approval.

## Standing constraints for this cutover

These hold for every run and for every disposition decided from a run. A
finding in the report never relaxes one of them.

- **Bulk Close stays capability-disabled.** Nothing in this cutover enables it,
  and no ambiguous or headless row may be dispositioned by bulk-closing it. A
  disabled capability is not an available remediation.
- **No column drop and no compatibility-mirror removal is authorized.**
  `inbox_items.status`, `closed_at` and the other legacy projection columns
  remain in place. This wave adds no migration; contraction is a separate,
  separately approved package that cannot start from this document.
- **The current-open private-feedback cutover rule is a signed operator
  decision, never an inferred one.** See the decision block below. Until it is
  signed, no start instant is written for a current-open feedback cycle.
- **`mappable` is not permission to migrate.** It means exactly one candidate
  anchor was found and no head row exists. It is a review candidate. Writing a
  head from it requires the separately reviewed backfill procedure.
- **An approved handling outcome or an on-time result is never inferred from
  `closed_at`.** A legacy row was closed by code that had no outcome table and
  no transition log, so its closure instant carries no evidence of _why_ it
  closed. Absence of evidence is recorded as `ambiguous` / `legacy_unknown` and
  excluded from the manager performance read.

## Run

```sh
pnpm ops:report-inbox-handling-cutover \
  --operator <registered-operator> \
  --org <organization-id> \
  --observed-at <ISO-8601>
```

`--org` and `--observed-at` are both mandatory. There is no `--apply` mode and
no repair path; the operator harness records the content-free read decision.

The repository opens **one** `REPEATABLE READ`, `READ ONLY` PostgreSQL
transaction, so the whole report describes a single snapshot and the database
itself — not code review — rejects a stray write. The transaction's own
posture is read back inside that transaction and printed in the envelope
(`transaction.readOnly`, `transaction.isolationLevel`,
`transaction.writeTransactionAssigned`); the command refuses to emit an
artifact if the posture is anything else. `--observed-at` bounds every table by
`created_at`, so a rerun at the same instant over unchanged history is
byte-comparable and two operators can diff instead of trusting one run.

## Output and privacy contract

The command prints one canonical (RFC 8785) JSON envelope containing only:

- the evidence schema version, the single US Data Cell id, the Organization id
  and the explicit observation time;
- the read-only transaction posture the artifact was produced under;
- the classification report payload and its SHA-256 fingerprint;
- per-item identifiers, one controlled reason code, one target eligibility and
  a performance-exclusion flag;
- parity counts and the ids of rows whose compatibility mirror disagrees with
  the head; and
- outcome tallies and Response Target lineage states.

It never selects guest or manager prose. `inbox_items.snippet` and
`reviewer_name`, `inbox_notes.text`, `guest_response_private_feedback.body`,
`material_review_revisions.normalized_text` and
`inbox_feedback_handling_outcomes.internal_note` are not read by any query in
this path.

## Classification contract

| Outcome     | Meaning                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exact`     | A cycle 1 row exists, the head agrees with the cycle log on cycle number, source revision and state revision, the compatibility mirror agrees with the head status, and the head's source scope tuple equals the item's.        |
| `mappable`  | Exactly one candidate anchor exists (a live Material Review Revision, or the Guest Response revision at which private feedback was submitted) and no head row exists. Identifiers and a reason code only — no inferred outcome. |
| `ambiguous` | The mirror disagrees with the head, the row is closed with no outcome row and no observable closure transition, the head disagrees with the cycle log, or more than one anchor competes. Reported, never repaired.              |
| `orphan`    | The source row is gone, `property_id` is a non-UUID legacy text key, or the head's property/source scope does not match the item.                                                                                               |

Target eligibility is only carried forward for an `exact` row with a recorded
snapshot. Everything else is `legacy_unknown` and `performanceExcluded`, so a
partially migrated row can never contribute an on-time result.

## Parity blocks

- **Head coverage** — `inboxItemCount`, `handlingCycleHeadCount`,
  `orphanCount`, `headlessItemCount`. An item is reconciled when it carries a
  head or is a declared orphan; the remainder is the un-backfilled work list.
- **Compatibility-mirror drift** — every row where `inbox_items.status`
  disagrees with the head status, listed by id with both values. The report
  does not repair drift; the mirror stays in place and authoritative for
  nothing until the writers are cut.
- **Response Target lineage** — every snapshot row is reconciled against the
  current head cycle. A snapshot on an older cycle is `superseded` — ordinary,
  expected history for a corrected guest submission — and is **not** a
  discrepancy. A snapshot with no head at all is `headless` and belongs to the
  backfill work list.

## Outcome eligibility (a separate axis)

A row can be structurally `exact` and still carry no measurable result.

| Eligibility            | Meaning                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `handled_on_time`      | The latest outcome row for the head cycle recorded `on_time`.    |
| `handled_late`         | The latest outcome row for the head cycle recorded `late`.       |
| `handled_not_measured` | An outcome exists but the cycle was never measured.              |
| `withdrawn`            | The transition log closed the head cycle with `guest_withdrawn`. |
| `unrecorded`           | No outcome row exists. Never upgraded from `closed_at`.          |
| `not_applicable`       | A Google Review item; private-feedback outcomes do not apply.    |

`withdrawn` and `unrecorded` are terminal exclusions and are kept out of the
`handledOnTime` / `handledLate` tallies. A manager cannot have handled feedback
the guest took back, and an outcome that was never recorded cannot be
reconstructed.

---

## DECISION BLOCK — start instant for current-open private feedback

**Status: UNSIGNED. Engineering does not pick this rule.**

Every private-feedback item that is still open at cutover needs a Response
Target start instant before it can be measured. Two rules are defensible and
the database cannot choose between them: the choice is a statement about what
the product promises a guest, not a fact recoverable from the rows. Engineering
implements whichever rule is signed below and must not default to either one,
must not pick the one that reports better, and must not ship a measured
current-open target before this block is signed.

Whichever rule is signed, it applies **only** to cycles that are open at
cutover. Cycles already closed before cutover stay `legacy_unknown` and
performance-excluded; they are never retro-scored.

### Candidate A — original-submission start

`start_at` = the instant the guest submitted the private feedback.

- **Handled-on-time count:** depressed for the first measured period. Backlog
  items handled after cutover are scored against a clock that has already been
  running, so many are recorded `late` however fast the team responds now.
- **Overdue count:** spikes at cutover. Every open item older than the target
  duration is immediately overdue on day one, including work that predates any
  Response Target policy existing.
- **What it means:** the measure answers "how long has this guest been
  waiting", which is the honest reading of a guest-facing promise. The team is
  measured against history it could not have known it was being measured on.

### Candidate B — cutover start

`start_at` = the instant the cutover runs.

- **Handled-on-time count:** measurable from day one, with every open item
  given a fresh full duration. The first period reads high because no backlog
  age is carried in.
- **Overdue count:** starts at zero and rises only from post-cutover behaviour.
- **What it means:** the measure answers "how long since we started measuring".
  A guest who has already waited three weeks is recorded as handled on time if
  the item is closed within the target after cutover, which overstates
  performance from the guest's point of view.

### Consequences that are identical under both rules

- No closed legacy cycle is retro-scored.
- No `ambiguous`, `orphan` or headless row gains a measured target.
- The compatibility mirror is not modified; no column is dropped.
- Bulk Close remains capability-disabled as a disposition route.

### Signature

Engineering prepares this block and may not approve it.

| Role                                          | Named person | Date | Signature |
| --------------------------------------------- | ------------ | ---- | --------- |
| Decision owner (accountable, non-engineering) |              |      |           |
| Reviewer (independent of the owner)           |              |      |           |

**Rule selected:** ☐ Candidate A — original-submission start ☐ Candidate B — cutover start

**Recorded rationale (required, in the owner's own words):**

**Evidence run this decision was taken against:** `--observed-at` \_\_\_\_\_ ,
report SHA-256 \_\_\_\_\_

An unsigned block, a block with only one name, or a block signed by the
engineer who produced the evidence is not a decision, and the cutover does not
proceed.

---

## Operator disposition

1. Store the canonical JSON and the report SHA-256 with the reviewed release
   evidence, alongside the `--observed-at` used.
2. Rerun the same observation time for an unchanged-data byte comparison, then
   run an approved newer observation time for the release candidate.
3. Work every `mappable` row through the separately reviewed backfill
   procedure. Do not write heads directly from this report.
4. Review every `ambiguous` and `orphan` row through the owning Inbox
   procedure. Do not edit `inbox_items` or the Handling Cycle tables by hand,
   and do not close rows to make counts look better.
5. Treat compatibility-mirror drift as a defect to investigate at its source,
   not as a value to overwrite.
6. Do not begin any contraction, column drop or mirror removal from this
   document. Zero unexplained rows is necessary cutover evidence; it is not a
   contraction approval and it activates no capability.
7. Obtain the signed decision block above before any current-open
   private-feedback target is measured.
