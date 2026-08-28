# Guest Response legacy-readiness reconciliation

This GST-01 command inventories legacy Rating/Feedback rows and canonical Guest
Response evidence without changing it. It is a report-first cutover aid, not a
migration, repair command, provenance backfill, consent decision, or release
approval.

## Run

```sh
pnpm ops:report-guest-response-readiness \
  --operator <registered-operator> \
  --observed-at <ISO-8601> \
  [--org <organization-id> ...]
```

`--observed-at` is mandatory. Repeated `--org` values select an Organization
set; omitting them produces a global report. The operator harness records the
content-free read decision. There is no `--apply` mode.

The repository reads one PostgreSQL `REPEATABLE READ`, read-only snapshot. The
observation time bounds created facts and retained rows. Mutable tables without
version history still expose their current stored state, so a fixed-time rerun
is byte-stable only when the underlying data is unchanged; it is not a claimed
historical reconstruction.

## Output and privacy contract

The canonical JSON contains only:

- schema version, explicit observation time, and optional Organization IDs;
- controlled outcomes, dimensions, reason codes, and counts;
- Organization, Property, Portal, source-row, related-row, and event IDs;
- fixed 1–5 star distributions and totals;
- valid rating/feedback submitted and retracted event identities, including an
  explicit superseded source ID and Guest Response revision where retained;
- one controlled evidence classification for every retained rating/feedback
  fact, even when an invalid payload cannot enter the valid identity list; and
- a SHA-256 fingerprint over the canonical payload.

It never selects or prints feedback text, contact values or ciphertext, session
IDs, IP/network pseudonyms, user agents, object keys/URLs, category values,
provider destinations, names, or email/phone values. A retained sensitive value
is reported only through its source ID and a controlled gap code.

## Classification contract

Every retained legacy Rating and Feedback receives a `legacy_relationship`
classification:

| Outcome    | Meaning                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exact`    | A same-ID canonical row and its current durable source-event identity agree on scope and retained value. The report does not treat timestamp/session similarity as exact provenance. |
| `mappable` | Stored scope is valid and the row has either an explicit Rating link or one unique same-scope session candidate. This is a review candidate only; nothing is written or inferred.    |
| `conflict` | Tenant/Property/Portal/session facts disagree, candidates are multiple, or a same-ID canonical row disagrees.                                                                        |
| `orphan`   | A required Portal, Rating, unique candidate, or Inbox relationship is absent. Feedback without a Rating is retained and reported here, never converted into a staged response.       |
| `unsafe`   | The stored star/source is invalid, publication/threshold evidence is unknown, a beta-blocked record is active, or a lifecycle/retention rule is violated.                            |

`mappable` never means “approved to migrate.” In particular, a unique legacy
session is candidate evidence, not guest identity or provenance. A later apply
design needs a separately reviewed, durable mapping authority; this report will
not manufacture one.

## Evidence dimensions

- `legacy_relationship` — explicit Rating link, unique session candidate,
  canonical same-ID evidence, scope, and invalid source/value checks.
- `active_session_uniqueness` — more than one still-active legacy/canonical
  rating source for one Organization/Portal/session. Session IDs are used only
  inside the query and never appear in output.
- `experience_snapshot` — missing experience row, unknown immutable Portal
  Publication Snapshot, unknown inclusive threshold, or threshold disagreement.
- `rating_lineage` / `feedback_lineage` — current source identity, source scope
  and value/revision, missing supersession targets, branched successors, and
  required retraction identities after withdrawal.
- `integrity_history` — revision-one origin, contiguous decision chain, and an
  exact latest outcome/reason/time match to the aggregate.
- `withdrawal_state` — terminal consent/value/source clearing, private-text
  removal, Contact retirement, and media purge state.
- `media_state` / `contact_state` — beta-blocked active records, terminal-state
  conflicts, and overdue Contact material.
- `inbox_link` — one same-scope Feedback Inbox source, no work for rating-only
  responses, and closed/redacted work after withdrawal.
- `retention_state` — 24-hour legacy/canonical session material, cleared legacy
  network slots, exact 90-day private text, exact 24-month response fact, and
  stale-content removal.
- `fact_evidence` — every durable rating/feedback fact's registered schema
  version, identifier-only payload shape, canonical response, tenant/Property/
  Portal scope, outbox aggregate identity, business time, event-time Primary
  Staff Attribution, and feedback revision. Version-one attribution and
  pre-version-three feedback revision remain explicitly unknown; `null` in a
  current attributed schema is a proved unassigned snapshot, not missing data.

## Star and lineage reconciliation

The report keeps four separate per-star distributions:

1. `legacyRatings` — valid stored legacy values observed by the cutoff;
2. `canonicalRetainedRatings` — current numeric values retained on canonical
   response rows;
3. `canonicalEffectiveRatings` — live, consented, integrity-accepted canonical
   rows with a current rating source ID; and
4. `durableRatingFactHeads` — durable `guest.rating.submitted` facts whose event
   ID is the canonical response's current source head.

The latter two must converge before a read cutover. The report exposes this as
`checks.canonicalRatingFactParity`; `ready` requires both that check and
`checks.zeroUnexplainedRows`. Legacy and canonical totals
are intentionally not collapsed into one average, and pre-cutover inequality is
not hidden. `facts` lists each source/correction/retraction identity; a corrected
rating is a `rating_submitted` identity with `supersedesSourceEventId`, while a
withdrawal/exclusion is a `rating_retracted` or `feedback_retracted` identity.
Malformed facts remain visible through identifier-only `fact_evidence` rows but
are never normalized into a valid identity or allowed to abort the report.

## Operator disposition

1. Store the JSON and fingerprint with the reviewed release evidence.
2. Review every non-`exact` row through the owning Guest, Portal, Inbox, or
   retention procedure. Do not edit source tables directly.
3. Keep legacy tables immutable. Preserve feedback-without-rating and unknown
   publication/threshold evidence as historical unknowns.
4. Require canonical-effective and durable-fact-head star distributions plus
   every source/supersession/retraction identity to agree; counts or averages
   alone are insufficient.
5. Rerun the same observation time and scope for unchanged-data comparison, then
   run an approved newer observation time for the release candidate.
6. Require both readiness checks to be true. Zero unexplained rows without
   exact canonical-rating/fact-head parity is not cutover evidence.
7. Zero unexplained rows is necessary cutover evidence; it does not activate
   Guest Contact, Guest media, a Portal cohort, or any production capability.
