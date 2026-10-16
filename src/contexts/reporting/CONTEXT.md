# Reporting Context

Reporting owns the product's governed metrics, Goal Programs, and dashboard read models.
The three capabilities share one build, one application interface, and one standard layer
set because Goal evaluation and dashboard presentation are downstream views of the same
metric authority.

## Responsibilities

- Record version-pinned metric readings and append-only corrections.
- Maintain anonymous Portal lifetime aggregates and Current on Google snapshots.
- Resolve governed metric availability, provenance, completeness, and correction impact.
- Create, revise, assign, schedule, evaluate, and close monthly Goal Programs.
- Produce property, fleet, staff, Portal analytics, Portals overview results, attention, setup-checklist, and
  per-Property setup reads.
- Register metric projection consumers, Goal correction consumers, Goal maintenance, and the
  daily evaluation of every Property Google rating goal.
- Contribute Reporting-owned records to organization export and lifecycle operations.

## Core model

- **Metric definition/version**: frozen code-reviewed measurement policy.
- **Metric reading**: immutable, version-pinned fact with event-time attribution.
- **Metric correction**: append-only retraction, replacement, or adjustment. A fact that
  is projected into several measures is corrected measure by measure: a correction's source
  key is `<fact id>:<definition version id>`, so a corrected rating retracts its private
  rating, its rating count and its rating average, and a Goal on either Goal measure finds
  the retraction of its own reading. The key `<fact id>:retract` of the earlier code, one
  for the first reading only, is still read.
- **Goal Program**: versioned monthly target over an approved metric and subject set. A month
  still running can carry its own target; once its period ends that target is locked.
- **Goal monthly result**: evaluation head with append-only revision evidence.
- **Goal progress**: the live month to date of the goals that target one subject (a Portal
  Group's goal card), read through the Program list's own authorisation and visibility and
  the same governed metric the monthly result uses, over the whole calendar month in the
  Program's time zone. Its target is the one the running month is judged against, with who
  changed it when it is no longer the one the month started with. It is never a result: it evaluates nothing, is never stored, and an
  average under the metric's minimum sample or a reading that cannot be trusted is shown as
  such, never as a zero.
- **Goals list progress**: the month so far of every active goal of a Property, read in one
  request for the Goals list (`getGoalListProgress`, `createGoalListProgressReader`): one Program
  list read, then each goal through the same `progressOf` as its own page. One subject gets its
  figure against the running month's target and the days left, and on a count that is below pace
  the quiet amber words "below pace": after the days left where the row's cell has room, beside
  the bar where it has not (`belowPace` is 1 or 0 for one subject, null when nothing was judged,
  the same figures and the same `goalPace` as several subjects); several
  subjects on a count get how many are below pace; an average with several subjects, or more
  subjects than a goal's page reads, gets the count of subjects alone. A scheduled, paused or
  ended goal has no line. Each figure is the governed read of the goal's own page, so the list
  and the page cannot disagree: one server call but several statements, a deliberate departure
  from one set-based read because the set-based count below leaves out the outbox completeness
  proof. A page is bounded instead:
  at most 60 figures, three in flight (two queries each, six of the web pool's ten connections),
  and the goals past that carry no line. While the figures are first read, an active row keeps
  the room its line will take (`GoalLiveLinePending`), so the rows below do not move; whether a
  count is below pace is known only with its figure, so the note adds no height at any cell
  width, which is why it moves beside the bar in a narrow one.
- **Goal pace** (`domain/goal-pace.ts`): how far a count goal's running month should have got. A
  count measure expects the month's target times the share of the month gone, in whole
  Property-local calendar days with today included (the Results window's convention). It is
  behind pace below 90% of that, and exactly 90% is on pace. The first three days of a month are
  not judged, and an average has no pace. One rule feeds the Goals list ("below pace" on a row
  with one subject, "N below pace" on one with several), the Overview chip and the Properties
  list. The chip and the list count the figure from the readings of every running month of an
  active count goal in one statement
  (`infrastructure/adapters/goal-running-months.ts`), because a month still running stores no
  value: its result row stays `updating` until it closes. That read sums what the goal's own page
  sums and reads a goal only where the page could: a Portal or Portal Group that was deleted, or
  a metric version not in effect for the whole month (`goalVersionIsUsable`, the governed read's
  own rule), leaves a goal uncounted. It leaves out only the outbox completeness proof, and a
  month with a reading the governed read would quarantine has no figure and is not counted. An
  integration test holds its sum to `queryGoalAggregate` on the same readings. A goal counts once
  however many subjects are behind.
- **Goals for several subjects**: one save that creates one Goal Program per row, each for
  one Portal or one Portal Group with its own target (`createGoalsForSubjects`, at most 50
  rows). It is authorised once and its start month is resolved once, so every goal of a save
  starts in the same month; each goal is its own transaction and is named after its subject
  and measure. A row that cannot be saved is reported with its reason and never holds back
  the others, and a row reached after the chosen month has ended is not written. There is no
  target that subjects share and no Property total.
- **Property Google rating goal**: a Property's target for the one-decimal rating Google
  shows, with a planned quality (the average stars it assumes new Google reviews bring) and
  a chosen weekly pace of new Google reviews (a climb goal), or a watch that
  Google keeps showing a tenth it shows now (a keep goal). At most one is active per
  Property (ADR 0067, `docs/plan/google-rating-goal.md`). It is not a Goal Program: it has
  no months, subjects, metric readings or monthly results, no deadline and no "missed". It
  is worked out from Google's own rating and review count (the Current on Google snapshot)
  and from counts and star sums of the Property's cached Google reviews, read through
  Review's public API, and it is reached only when Google itself shows the target. Only
  AccountAdmins and PropertyManagers with access to the Property see, set, change or end it.
- **Property Google rating goal (implementation)**: One active goal per Property (`property_rating_goals`, a partial unique index); a
  climb goal names a tenth from 1.1 to 4.9, a planned quality in tenths (`quality_tenths`,
  migration 0059: at least 0.15★ above the target's threshold in the domain, at least the
  target in the database) and a pace in tenths of a review a week (`pace_tenths_per_week`,
  migration 0060: 10 to 3500, 1 a week to 50 a day; `pace_per_week` is its whole weekly
  mirror for one release, held equal to it by the CHECK, and the set and change schemas
  map a legacy whole weekly `pacePerWeek` × 10 for that release), a keep goal a tenth Google shows
  now and neither, set only while Google shows 4.7 or more (X1, 2026-10-16, amending R2-9:
  the next tenth needs new reviews of nearly five stars there; the commands refuse a keep
  goal below, as the screens offer none). The plan (target, quality, pace) is version-checked as a whole. There is no deadline and no "missed": a goal runs
  until Google shows the target (reached), or it is ended by a manager, by its Google
  location changing (the Property's binding epoch moved) or by its Property being archived.
  Changes of target, quality, pace or mode are logged with who, when, old and new value,
  and no reason (`property_rating_goal_changes`). A manager's "Not now" for a Property's goal is
  kept apart (`property_rating_goal_deferrals`): it only lets the setup checklist count the
  step as decided, and sets, changes or blocks no goal. The maths is pure and exact
  (`domain/rating-goal-*.ts`, BigInt rationals): Google's number rounds half up (4.45
  shows 4.5, one named rule), so a target's threshold is five hundredths below it; the exact
  average is the cache's sum over count when the cache holds every review Google counts,
  otherwise Google's figure; the recent mix is the last 90 days at ten reviews or more,
  else the most recent 25; reviews needed is ceil(N(θ − E)/(q − θ)) at a quality q; the
  forecast is a month range in the Property's time zone (quality ± 0.1, pace ± 10%).
  The setup (rounds 3 and 4, 2026-10-16) is one screen worked out on the page from the
  setup read's exact inputs (`application/rating-goal-setup-plan.ts`, `workOutRatingGoal`,
  client-safe, never throwing on what a manager typed): the planned average is automatic
  (`domain/rating-goal-average.ts`: the better tenth of the best month and year, or halfway
  to five stars, at most 4.8; a typed one from two tenths above the shown number to 5.0),
  the pace chips come from the proven pace (`domain/rating-goal-pace-chips.ts`: 1.5 times
  the busier of the last 90 days and the busiest 30, to a nice pace a day, at least 1), and
  the recommended goal is the highest within six months at 0.1★ below plan, with a central
  time and a likely range in exact day fractions (`domain/rating-goal-duration.ts`). A tenth
  the cache already clears while Google lags is never a goal. Keep comes first from 4.7.
  Components import these values only from `application/` (the components boundary).
  A goal's numbers (forecast, still needed, next tenth) assume the planned quality
  blended with the reviews since it was set from the first one, the plan counted as 15
  reviews (`trackingMix`, round 4 X3); the verdict still waits for ten reviews and judges
  their own average: `reviews_too_low` (that average at or below the threshold) replaced
  `cant_reach_at_mix`, and while a goal is too low its numbers use that average too, so the
  chip and the numbers agree. The evaluation and its notices read no forecast average
  (`application/rating-goal-blend-volume.test.ts` pins the notice volume). The review cache is read only through Review's
  `ReviewGoogleRatingReads` (counts and star sums, the serving eligibility, the current
  binding epoch; also since a goal was set, per calendar year, per calendar month with ten
  reviews and per local date, counts only); Google's own numbers
  come from the Current on Google snapshot. A goal may be set only on an active Property with at least ten Google
  reviews (Google's count decides that first, current or not) and current numbers; a
  reading waits for Google while its numbers are not current, show no tenth or give no
  exact average, or the review cache holds no review (an empty or expired cache). The setup
  read also returns `setupInputs` (`application/dto/rating-goal-setup.types.ts`, rounds 3
  and 4): Google's numbers, the exact average, the best calendar month of the last twelve
  and the best year with ten reviews, the reviews of the last 90 days and the busiest 30
  local dates of the last 365 (`domain/rating-goal-evidence.ts`), from which the one-screen
  setup works its plan out on the page; the server runs no planning maths for it (the
  view's `offersClimb` says whether a climb can be planned at all: eligible, with inputs,
  and the reviews have earned less than 4.9, so no climb is offered while Google catches
  up with an earned 4.9). A set
  goal stores the tenth Google showed and the status it starts in. A goal is evaluated by
  its card and detail reads and by `goal.google-rating-evaluation` when Review verifies
  Google's numbers, through one evaluation (`application/rating-goal-evaluation.ts`) that
  stores the tenth and status it saw only when they change, only onto the plan version it
  read and never over a newer evaluation, so the next evaluation can tell a transition
  from a repeat. `goal.on-property-archived` ends the goal of an archived Property
  (`property_archived`) when it was set under an earlier binding epoch than the archive's,
  so a late fact never ends a goal set after a Restore.
- **Property Google rating goal notices**: five, change-only (ADR 0067 decision 6; ADR
  0046, amended 2026-10-14, 2026-10-15 and 2026-10-16): reached (offering Keep from 4.7);
  Google showing another tenth; entered Below pace, at most once in 14 days, read per day
  when the payload carries the pace in tenths a week; entered New reviews too low (ten or more reviews
  since the set, averaging at or below the threshold), also at most once in 14 days and
  with no star figure; a keep goal dropped below.
  `domain/rating-goal-notices.ts` decides them from what the goal last stored: the tenth
  Google showed, the last status that was not a wait for Google (`last_known_status`,
  migration 0057) and when it last told Below pace (`below_pace_noticed_at`) and New
  reviews too low (`cant_reach_noticed_at`, the retired Can't reach notice's column, kept
  under its name by migration 0059). Reached replaces the tenth gained, a keep goal's drop
  replaces the tenth lost, an ended goal tells nobody, and a status the goal was set in or
  that a manager's change of plan put it in (a plan change clears the known status) is
  stored without a notice. The
  evaluation write is one transaction that also compares the tenth, known status and
  notice times it read, and writes one identifier-only `goal.rating_goal.transitioned`
  fact per notice, so the same change is told once whichever evaluation stores it first.
  Below pace moves with the calendar, so `rating-goal.evaluate`
  (`infrastructure/jobs/rating-goal-evaluation.job.ts`, daily, `goal.use`) evaluates every
  active goal; it lists goals across tenants by identifier only and asks its scope
  authorizer about each goal's Organization and Property before reading anything. Feed
  turns the facts into notices for the Property's responsible managers.
- **Dashboard read model**: content-minimal presentation assembled from governed sources.
- **Google's own numbers** (`domain/google-numbers.ts`): every headline rating (the Property
  Overview's Rating tile, the Properties list's Rating and Reviews, the rating goal) is the
  number and count Google shows, from the Current on Google snapshot at the Property's current
  binding epoch, never RepKey's average of the reviews it holds (ADR 0067, decision 16).
  Numbers more than a day old, or read while the Google binding is not active, are Google's
  last ones, shown with their date; none at all only when Google never sent numbers for the
  current binding. The overview read returns them beside the dashboard (`google`); the fleet
  read joins them, and the Property's active rating goal as stored (target, mode, last status,
  never a live evaluation), for its page only. RepKey's period averages stay for the Ratings
  page and the rating drop signal.
- **Portal lifetime aggregate**: anonymous all-time values with rebuild and seal evidence.
- **Portal results measures**: the five figures on a Portal's Results view, each named for
  what it counts. Qualified scans (not raw page opens; counted from August 2026), private
  ratings, the average private rating, guests who opened Google (Google review link opens
  only; a secondary link is not one), and private notes. The reading floors live in
  `domain/portal-results-thresholds.ts`.
- **Results window**: a bounded range is that many whole Property-local calendar days ending with
  today, opening at local midnight (`localDaysWindow`); the period before is the same number of
  days before that, cut at the same time of day so both are equally long (today is still in
  progress). "Last 30 days" on 30 Sep is 1-30 Sep against 2-31 Aug. A Portal's Results tab
  and the Portals overview read the same window, so a Portal's row and its own tab agree.
- **Results series**: a Portal's window cut into weekly buckets anchored to its own first day
  (`domain/portal-results-series.ts`). A bucket carries qualified scans, the prior window's scans
  in the same position, and an average computed as sum over count of that bucket's own ratings,
  held back below the average floor. Versions that went live inside the window (Portal's
  `listPublicationActivationsBetween`) are placed on their local day. All Time has no series.
- **Guests by language**: private ratings (not scans) counted by the language of the page the
  guest saw, read from Guest (`getPortalRatingLanguages`). A rating with no recorded language is
  counted on its own line, never guessed.
- **Portals overview results**: the same five measures for every Portal at once, then per Portal
  Group, per Property for its Portals in no group, per Property as a subtotal, and in total
  (`getPortalResultsOverview`, read in a fixed number of statements per distinct time zone however
  many Portals are asked about). Every row is assembled by the code that assembles a single
  Portal's Results, and each Property is read through its own window (its time zone, built the way a
  Portal's Results view builds it), so a Portal's row says what its own Results view says. The total
  adds Property readings and has no window of its own. All Time is not read here. A group's figures
  are its readings under the group each Portal had when the guest acted (ADR 0040), so a Portal that
  moves keeps its earlier results with its old group. A group's evidence is the weakest of the
  Portals with readings under it, whether they are in the group today (`memberPortalIds`) or only
  contributed (`contributingPortalIds`). The caller supplies the roster (Portal owns the list and
  each Portal's current group) and each Property's time zone; Reporting supplies the numbers.
  The server function reads one Property, or, with none named, the whole Organization (the All
  properties page): then the roster is every Portal of every Property the caller may read for both
  `portal.read` and `dashboard.read` and is assigned to (each asked per Property before anything is
  read), a Property with no time zone on record is left out of the results rather than read in a
  guessed zone, and the one-read limit of 1000 Portals applies to the whole Organization (past it
  the page shows its list without results; each Property's own page still reads its own).
- **Portal configuration completeness**: a content review's count of required Portal fields,
  as a percentage. Version 1 holds counts on the legacy settings (every fact before event
  version 3); version 3 holds counts on the Immersive Hub's fields. The fact's field set picks
  the version, so each version's series holds only its own count. A correction replaces a
  reading of its own version only: one that corrects a review counted on the other field set
  starts its own version's series, and the earlier reading keeps its value.
- **Property setup**: seven per-Property steps derived at read time from current facts
  (Google binding, first sync, reply language, AI decision, responsible manager, reply
  voice, published Portal), and an eighth, "Set a Google rating goal", where a goal can be
  set: an active Property Google counts ten reviews for (the Current on Google snapshot at
  the current binding), seen by a viewer with `goal.create` while `goal.use` is on. The
  eighth counts toward "n of m done": it is done once a manager decided it, by setting a
  goal (active, reached, or ended by a manager; a goal its Google location or an archive
  ended decided nothing) or by choosing "Not now" (`property_rating_goal_deferrals`, one
  row per Property, written by the rating goal's "Not now" command), which counts as
  decided the way a deferred AI decision does. A Property that is not active shows no
  eighth step, even with a goal. It records no milestones, unlike the Organization
  checklist.

## Invariants

1. A metric read is eligible only under its immutable definition version and source policy.
2. Goal evaluation uses half-open property-local monthly periods and approved Goal metrics.
   A goal starts in the current local month or the next one, chosen at creation; the metric
   counts the whole month either way. A month is judged against its own target when it has
   one, otherwise its version's. A month's target may change only while the month is open and
   before its period ends; every change is logged with who, when, old and new value. A
   revision starts at the first local month that begins at or after the end of every month
   still open or reconciling, so that month stays inside its version's window. After the Property's timezone moves east, the next local month
   begins before the open month ends, so the revision starts one local month later and the
   skipped local month is not evaluated under either version. The dialogs state the start
   date before a change is saved, and the saved change states its own. A version with no monthly result (a goal that has not started,
   or a change still waiting for its month) may be replaced by the next change; the replaced
   version and its assignments keep an empty window, which holds no subject. A goal that has
   not started is one still scheduled with no month, even after its planned start has passed.
   Ended in that state it keeps the same empty window, so its subject is free at once; ended
   after it started, it holds its subject until the month still open ends. While a goal is
   scheduled its status reason says what its plan waits for (its metric source, or only its
   first month), and a revision before the start states it again for the measure it now has.
3. Goal assignment changes preserve at least one subject and never rewrite history.
4. Corrections append; they never mutate the original reading or closed Goal result.
5. Dashboard values preserve unavailable/updating/insufficient states instead of showing zero.
   A Portal's average private rating is held back below five ratings (with the true n and
   the reason), and compared with the prior period only at ten ratings in each period. Google
   opens are `insufficient` (`destination_unattributed`) while any click in the period never
   recorded which link was opened. A funnel step that out-counts the step before it is shown
   as counts only, never as a percentage over 100. Qualified scans have no history before
   their registry `effectiveFrom`, which the read model hands over as `qualifiedScansSince`:
   a prior window that opens before it has no prior figure (`measure_not_yet_counted`), and a
   current one that does carries the `measure_started_mid_period` note.
6. Every tenant read includes organization and property scope or an explicit global authority.
7. Clocks, identifiers, logging, storage, and upstream reads are injected by composition.
8. A version's target is never updated in place. A different target for a month still
   running is that month's own; a different target for the months after is a new version
   (ADR 0066).
9. Nothing puts a Goal Program into `active` in an Organization the lifecycle holds: one with a
   closure requested or in progress, or one whose closure was cancelled and awaits
   reactivation (the Closing phase can pause only active programs; the database has no
   scheduled -> paused edge). Maintenance neither lists nor activates its programs, and the
   commands that would start one are refused with `organization_closing`: creating a goal (one
   or several), and changing a goal's status to `active` (starting a scheduled goal, resuming a
   paused one). Pausing and ending are never refused. A month already open still reconciles
   and closes, which is how Goal's purge-readiness check comes to find none left.
10. The Property Google rating goal and Goal Programs never feed each other. No Goal measure
    reads Google data (`GOAL_METRICS`, and the metric CHECKs on `goal_program_versions` and
    `goal_subject_assignments`), no Goal Program target or result is derived from the rating
    goal, and the rating goal reads no metric reading and no Goal result. The rating goal is
    never split across Portals, Portal Groups or people, never shown to staff, and never a
    quota, ranking, incentive or employment input (ADR 0067).

## Interfaces and dependencies

`application/public-api.ts` is the only cross-context application interface. Server functions
under `server/` are the request boundary used by routes. Reporting depends on public
interfaces from Property, Portal, Staff, Review, Inbox, and Guest; none of their repositories
are imported. Metric-to-Goal and Metric-to-Dashboard collaboration is internal and follows
the normal domain/application/infrastructure layer rules.

The Property-scoped dashboard reads authorize their own reader. `getDashboardData`,
`getPropertyOverview`, `getAttentionSignals`, `getPortalAnalytics` and
`getPortalResultsOverview` take the caller's `AuthContext` beside their input and first ask
`application/dashboard-property-access.ts`: the reader belongs to the Organization, holds
`dashboard.read`, and reaches every Property the read names (an Organization-wide holder
all of them, a manager only those currently granted). A refusal is a tagged `DashboardError`
`forbidden`, raised before anything is read. `getPropertyOverview` and `getAttentionSignals`
ask for more: their attention band is work state (reply targets past due, items to triage,
escalations), so the reader must also hold `dashboard.fleet_read` and reach the Property with
it. A Member, who holds `dashboard.read` for the staff dashboard, is refused the overview
whether or not the Property is granted. `getDashboardData` also hides reply state from a
reader without `reply.manage` (`domain/reply-workflow-redaction.ts`); that covers the
`dashboard` half of the overview, and the `dashboard.fleet_read` requirement covers its
`signals` half. The server functions still ask the execution policy first, with the same
permissions and the Property (capability, suspension, kill switch, and the policy's own grant
check); the use case's decision is the one a caller that is not a server function cannot skip.

`getDashboardDataFn` is the one server function no route calls: the Property dashboard
moved to `getPropertyOverviewFn`. It stays because the dashboard-governance and
review-expiry e2e specs call it by export name to prove the governed read: grant
filtering and expired-Review exclusion, as a PropertyManager with one grant. Reply
redaction has no session that can ask for it in the beta (both interactive roles may
manage replies), so that e2e case is parked and `get-dashboard-data.test.ts` holds the rule.

The unified `buildReportingContext` returns one public interface, one combined outbox
registration function, Goal maintenance, metric maintenance, and named lifecycle/export
contributors. Root composition may continue exposing capability-specific aliases such as
`metricPublicApi`, `goalPublicApi`, and `dashboardPublicApi`; they reference the same Reporting
interface.

## Persistence

Reporting owns the metric, Goal Program, Property Google rating goal, dashboard
setup-checklist, Portal lifetime, and Current on Google tables declared in the shared schema
package. Repositories remain split by
aggregate and read purpose even though they share a bounded context.

## Durable facts

Metric and Goal event modules are named `metric-events.ts` and `goal-events.ts`. Their event
tags remain stable for outbox replay compatibility. Reporting consumes Guest, Portal, Review,
and metric-correction facts through the shared durable consumer registry. Each
consumer holds a receipt for a fact it has finished. A fact that yields no reading is
finished too: when the registry refuses it by design (a destination ratio under its minimum
sample, a fact that cannot be attributed, one from before its measure took effect) the store
commits an `obsolete` receipt and no reading, so it is not redelivered for nothing. A refusal
that a registry or policy change would undo (`source_policy_not_allowed`, `scope_not_allowed`,
`definition_not_approved`, `unknown_definition_version`) fails the delivery instead, and the
retry applies once the change is deployed. The Goal correction consumer
writes its receipt after a complete reconciliation pass, outside the result
transactions, which is the second form the consumer contract allows
(`ConsumerRegistration.handler` in `src/shared/outbox/consumer-registry.ts`):
each closed result is revised by its own compare-and-set, so a delivery repeated
after a crash finds every result unchanged and only adds the receipt. A pending
result throws before the receipt, and the fact is delivered again
(`metric-correction-outbox-consumers.integration.test.ts`). The same fact has a
second consumer, `metric.correction-reconciliation`
(`correction-outbox-consumers.ts`). Despite its name it reconciles nothing: it
checks the fact's attribution and writes its receipt, so its receipt says that
Metric saw the fact, and only the Goal consumer's says the correction was
reconciled. `goal.google-rating-evaluation` takes the same second form on
`review.google_reputation_snapshot.verified`: the fact only says when to look, the
evaluation reads the current snapshot, cache and Property as a page read does and writes
only what changes the stored goal, so a repeat finds nothing to write and adds the receipt.
`goal.on-property-archived` (`rating-goal-property-lifecycle-consumers.ts`, ungated) does
the same on `property.archived`: it ends only an active goal set before the archive's
epoch, so a repeat ends nothing and adds the receipt.

Reporting writes `goal.rating_goal.transitioned` (`domain/goal-events.ts`), one per rating
goal notice, inside the evaluation's own write (a read, `goal.google-rating-evaluation` or
the daily `rating-goal.evaluate`). Its payload is identifiers, closed enums and the
Property-level figures the notice states (Google's shown tenth, the target, the pace in
tenths a week `paceTenthsPerWeek` beside its whole weekly legacy mirror `pacePerWeek`, 1 to
350, and the recent pace), never a review or a figure RepKey works out from review ratings; Feed's
`notification.on-rating-goal-transitioned` consumes it.

## Verification

- `build.test.ts` pins the unified interface and worker contributions.
- `infrastructure/runtime-dependency-injection.test.ts` rejects ambient runtime state.
- Unit tests remain beside their domain, use-case, repository, adapter, and server subjects.
- Integration tests exercise PostgreSQL constraints, projections, lifecycle, and exports.
