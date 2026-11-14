# Reporting Context

Reporting owns the governed metrics, the Goal Programs and the Property Google rating
goal, and the dashboard read models. They share one build, one application interface and
one layer set because goal evaluation and dashboard presentation are views of the same
metric authority. Sub-maps: [monthly goals](monthly-goals/CONTEXT.md) and
[Portal results](portal-results/CONTEXT.md).

## Where things live

| Area                                    | Location                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Cross-context interface                 | `application/public-api.ts` (the only one)                                                            |
| Request boundary                        | `server/*.ts`: the paths routes import, kept stable                                                   |
| Metric catalogue and reading commands   | `readings/` (`contracts.ts` is browser-safe)                                                          |
| Monthly goal commands, cards, pages     | `monthly-goals/*.server.ts`, screens in `monthly-goals/ui/`                                           |
| Google rating goal                      | `rating-goals/*.server.ts`, `rating-goals/contracts.ts` (browser-safe), screens in `rating-goals/ui/` |
| Portal Results                          | `portal-results/` (`contracts.ts`, `get-portal-analytics.server.ts`, SQL in `*.repository.server.ts`) |
| Rules without I/O                       | `domain/`                                                                                             |
| Use cases and read views                | `application/` (components import values only from here, never from `infrastructure/`)                |
| Repositories, adapters, jobs, consumers | `infrastructure/`                                                                                     |
| Tables                                  | `src/shared/db/schema/` (central; not moved)                                                          |

Reporting depends on the public interfaces of Property, Portal, Staff, Review, Inbox and
Guest, never on their repositories. `buildReportingContext` returns one public interface,
one outbox registration function, goal maintenance and the rights adapter. Root
composition may keep the aliases `metricPublicApi`, `goalPublicApi` and
`dashboardPublicApi`; they point at the same interface. Clocks, identifiers, logging,
storage and upstream reads are injected by composition
(`infrastructure/runtime-dependency-injection.test.ts`).

Jobs, declared in `src/shared/jobs/job-definitions.ts`:
`goal-program-maintenance.job.ts` (hourly, opens due months and closes finished ones) and
`rating-goal-evaluation.job.ts` (`rating-goal.evaluate`, daily, evaluates every active
rating goal). Outbox consumers: guest facts into readings
(`readings/guest-outbox-consumers.server.ts`), metric corrections into goal results
(`infrastructure/metric-correction-outbox-consumers.ts`), Current on Google snapshots
(`infrastructure/current-google-reputation-outbox-consumers.ts`), rating goal evaluation on
verified Google numbers and rating goal end on Property archive
(`infrastructure/rating-goal-*-consumers.ts`).

## Core model

- **Metric definition/version**: frozen, code-reviewed measurement policy. A reading is
  eligible only under its immutable version and source policy.
- **Metric reading**: immutable, version-pinned fact with event-time attribution.
  Individual Google review stars are not recorded; Google figures come from verified
  snapshots.
- **Metric correction**: append-only retraction, replacement or adjustment. A fact projected
  into several measures is corrected measure by measure: the correction's source key is
  `<fact id>:<definition version id>`, so a corrected rating retracts its private rating,
  count and average. The older key `<fact id>:retract` (first reading only) is still read
  because stored corrections carry it.
- **Goal Program**: versioned monthly target over an approved metric and subject set. A
  month still running can carry its own target; once its period ends the target is locked.
  Versions and month targets keep where the number came from (`target_source`:
  `recommended` or `own`; none when unknown). An ended Program keeps who ended it and when
  (`ended_at`, `ended_by`; none for an end before migration 0062).
- **Goal monthly result**: evaluation head with append-only revision evidence.
- **Goal progress**: the live month to date of a goal's subject, through the same
  authorization, visibility and governed metric as the monthly result, over the whole
  calendar month in the Program's time zone. It is never a result and is never stored; an
  average under the minimum sample, or a reading that cannot be trusted, is shown as such,
  never as zero.
- **Dashboard read model**: content-minimal presentation assembled from governed sources.
- **Google's own numbers** (`domain/google-numbers.ts`): every headline rating (Overview
  Rating tile, Properties list, rating goal) is the number and count Google shows, from the
  Current on Google snapshot at the Property's current binding epoch, never RepKey's average
  of the reviews it holds. Numbers older than a day, or read while the binding is not
  active, are Google's last ones, shown with their date; none only when Google never sent
  numbers for the current binding. A snapshot is ordered and dated by when Google's numbers
  were read (`numbersObservedAt`, else `evaluatedAt`), so a slow snapshot finishing late
  does not replace fresher numbers. RepKey's period averages stay for the Ratings page and
  the rating drop signal. `readPropertyGoogleNumbers` (`getPropertyGoogleNumbersFn`) is the
  narrow `dashboard.read` read Guest voice uses; it needs no goal permission and the
  caller isolates its failure from the page.

## Monthly goals

Semantics that stay fixed:

- A goal starts in the current local month or the next, chosen at creation; the metric
  counts the whole month either way. A month is judged against its own target when it has
  one, else its version's. A month's target changes only while the month is open; every
  change logs who, when, old and new value. A version's target is never updated in place:
  a different target for the running month is that month's own, for later months a new
  version.
- A revision starts at the first local month beginning at or after the end of every month
  still open or reconciling. After a time zone moves east, that can be one month later, and
  the skipped month is evaluated under neither version; dialogs state the start date
  before saving.
- A version with no monthly result (a goal that has not started, even after its planned
  start passed) may be replaced by the next change; the replaced version keeps an empty
  window holding no subject. Ended in that state, the subject is free at once; ended after
  it started, the goal holds its subject until the month still open ends.
- Revisions keep at least one subject and never rewrite history. Corrections append; they
  never change the original reading or a closed result.
- Goal periods are half-open Property-local months. Stopping a Program locks its row,
  opens due months per assignment and ends it in one transaction; the last month still
  reconciles and closes.
- Goal pace (`domain/goal-pace.ts`) applies to count goals only. Expected = target × share
  of the month gone, in whole Property-local days with today included; behind pace is below
  90% of that (exactly 90% is on pace). Not judged in the first three days or when fewer
  than `GOAL_PACE_MINIMUM_EXPECTED` (5) are expected by today (`target × days gone < 5 ×
days in the month`); averages have no pace. One rule feeds the Goals list, the Overview
  chip and the Properties list; `application/goal-pace-parity.test.ts` holds them to one
  verdict. The chip and list count behind-pace goals from the readings of every running
  month in one statement (`infrastructure/adapters/goal-running-months.ts`) because a
  running month stores no value; it sums what the goal's own page sums, skips only the
  outbox completeness proof, and leaves out a goal whose Portal or Portal Group was
  deleted, whose metric version was not in effect the whole month
  (`goalVersionIsUsable`), or whose month holds a reading the governed read would
  quarantine. An integration test holds its sum to `queryGoalAggregate`.
- Goals list progress (`getGoalListProgress`) reads each active goal through the same
  `progressOf` as its own page, so list and page cannot disagree. It is bounded: at most 60
  figures, three in flight, and goals past that carry no line. Rows hold the room their
  line takes while figures load.

**Monthly portal goal** (ADR 0068; `application/monthly-portal-goal-identity.ts`): not a
Program kind but the Property's count goal whose subject is the Property alone and whose
measure is private ratings or scans. Writes serialize this identity under the Property
definition lock, including month-target changes and status changes. Reads choose in
`monthlyPortalGoalOf`: the earliest-created Program that has not ended, else the most
recently ended one that still counts a month. Averages and goals for a Portal or Portal
Group never are it. Setting one refuses `subject_has_goal` while any Property count goal
that has not ended exists on either measure; existing conflicts are kept for inspection,
never ended automatically. Every Property count goal's `$goalId` page sends the reader to
the card (`isPropertyCountGoal`).

- _Recommendation_ (`domain/goal-recommendation.ts`, read by
  `application/use-cases/goal-recommendation-read.ts`): the number offered, never a result.
  Basis W is the 28 whole Property-local days ending yesterday, from the goal versions'
  first day (2026-08-01) on. A Portal's live days are those on which a publication
  activation was open for any part of the day. A Portal joins the rate when published,
  live and at 14 live days; draft, disabled, archived and deleted Portals never join, though
  their readings count in the month. R is the sum of joined Portals' readings on their live
  days over their live days, an exact BigInt rational. For a month of D days, x = R × D:
  "your usual" `roundUp(x)`, "a bit more" (recommended) `max(roundUp(1.1x), up(usual))`,
  "stretch" `max(roundUp(1.2x), up(a bit more))`; for the rest of the current month, with S
  counted so far and L days left, the same over S + R × L, the first at least `up(S)`. The
  grid (`domain/goal-number-steps.ts`): 1–29, fives to 100, tens to 500, fifties above.
  Each measure is `unreadable` (a reading the governed read would quarantine in this month
  or on a joined Portal's live day in the basis), `nothing` (R = 0) or `ready`. The
  Property state is `no_live_portal`, `getting_ready`, then `ready`, `scans_only`,
  `nothing_counted` or `unreadable`. The readings come from one statement
  (`infrastructure/adapters/goal-recommendation-readings.ts`), sharing the counted-reading
  SQL with the behind-pace count (`goal-count-readings.sql.ts`); an integration test holds
  it to `queryGoalAggregate`.
- _Card_ (`monthly-goals/monthly-portal-goal-card.server.ts`): authorizes `goal.create`,
  reads the clock once, then Programs and the recommendation together, and answers the goal
  or the state before one (no Portal, draft only, first weeks, number ready, nothing
  counted, unreadable). The offered number is in `monthly-portal-goal-offer.server.ts`. The
  set sheet's facts ride on the card (`portalGoalSheetFactsOf`); its steps and own-number
  note come from the one grid.
- _Running_ (`monthly-portal-goal-running.server.ts`): the month is the governed read
  (`progressOf`; a stopped goal still counts to the end of the month it stopped in,
  `readSubjectMonth`). The server decides the month's days, the first three quiet days and
  `belowPace`. Per-Portal counts come from the recommendation's set read and are drawn only
  when they add up to the governed figure. Each month carries the measure of the version it
  opened under; a coming-month change leaves the running month as it was.
- _Page_ (`monthly-portal-goal-page.server.ts`, `/goals/portals`): the card's read plus a
  line of succession (this goal, then earlier ended Property count goals, newest first;
  `monthly-portal-goal-history.server.ts`) with up to 24 months, dated changes, the stop
  and each published Portal's live run. Side reads (other goals' progress, subject names)
  fail soft: the page stays whole.
- _Month-start check-in_ (`domain/portal-goal-check-in.ts`,
  `monthly-portal-goal-check-in.server.ts`): on local days 1–7 of a month that is not the
  goal's first, while it runs, the card asks once whether the month keeps its number. Keep
  writes `goal_programs.check_in_answered_month` only (`goal.update`; no version, no change
  row; refused `check_in_closed` outside days 1–7); changing the month's own number answers
  it too. Use is the change now. Nothing is sent or automatic.
- _Overview prompt and Results line_: the card's number ready also feeds the Overview
  prompt, put off while "Not now" names that month or a later one
  (`portal_goal_prompt_deferrals`, one row per Property, only moves on; a month past next
  month's is refused `start_month_changed`). A Portal's Results line
  (`monthly-portal-goal-line.server.ts`, `goal.create`) shows that Portal's count toward the
  goal when every Portal's count adds up to the governed figure, and the Portal's own goal
  when one runs.
- _Add a portal goal_ (`application/use-cases/portal-goal-add-*.ts`): a goal for one Portal,
  each Portal (from 2 live), a Portal Group (with a live Portal) or the Property's average
  private rating (from 10 private ratings in 4 weeks). Offers follow the recommendation's
  month and measure; a group counts readings recorded under the group at source-event time
  (`group_id`), so a moved Portal counts in its old group before the move. A subject with a
  goal on that measure is "Has a goal". `/goals/new` only redirects to the add sheet. Commands are `createGoal` and
  `createGoalsForSubjects` (at most 50 rows per save, each its own transaction, one start
  month; saves over 50 run in batches and report unsaved rows). Numbers are stored
  `recommended` only when they equal what the read offers that subject now. A count goal for
  the Property alone is never made here.
- _Single-subject pages_ (`monthly-goals/get-portal-goal-page.server.ts`,
  `programs.portalGoalSingle.page`): authorizes `goal.create`, applies visibility and says
  which page the Program has before reading more. A Portal's or group's count goal is read
  from the recommendation narrowed to its subject (`narrowedRecommendation`); the average
  reads none (`averageMeasureOf`). A goal for several subjects made by the earlier form has
  a plain page with Stop. The change commands accept one-Portal and one-group goals and the
  average (always `own`, never turned into a count); Stop takes every goal naming a subject.
  No command changes a goal's subjects alone; the engine keeps the month-target
  commands.
- Server functions for these live in `server/monthly-portal-goals.ts`, which the Goals
  route reaches only through its own `import()` so they stay out of first paint
  (`route-server-fn-bundles.test.ts`).
- Staff targets: personal Portal and Portal Group subjects holding people admit only
  qualified scans, with every member collecting private ratings; checks apply to creation,
  subject changes, target changes and resume, under Portal's Property fence. The Add picker
  offers staff subjects only while `STAFF_SCAN_TARGETS_ENABLED` is on; a person gets an empty
  number and no recommendation. Off, existing staff targets read Paused without changing
  storage. Recommendations still include personal Portals in the Property number; goal
  contribution lists show them as "Staff portals: N".

`PortalRatingGoalReadApi.findPortalRatingGoalBlockInTransaction` reads running rating
assignments and their published collectors inside the caller's transaction. Portal holds the
shared Property goal fence before this read and its mutation; goal definition and
membership writers use the same fence. Ended goals hold no collector.

## Property Google rating goal

A Property's target for the one-decimal rating Google shows, with a planned quality and a
weekly pace of new Google reviews (climb) or a watch that Google keeps showing a tenth it
shows now (keep). At most one is active per Property (`property_rating_goals`, partial
unique index; ADR 0067). It is not a Goal Program: no months, subjects, readings, results,
deadline or "missed". It runs until Google shows the target (reached), a manager ends it,
its Google location changes (binding epoch moved) or its Property is archived. Only
AccountAdmins and PropertyManagers with access to the Property see, set, change or end it.
It is never split across Portals, Groups or people, never shown to staff, and never a
quota, ranking, incentive or employment input.

- Stored plan: a climb names a tenth from 1.1 to 4.9, a planned quality in tenths
  (`quality_tenths`: at least 0.15★ above the target's threshold in the domain, at least the
  target in the database) and a pace in tenths of a review a week (`pace_tenths_per_week`,
  10 to 3500). `pace_per_week` is the whole-number weekly mirror, still stored and held
  equal by a CHECK, and still carried on the `goal.rating_goal.transitioned` payload
  (1 to 350). A keep goal names the tenth shown now and neither, and is set only while
  Google shows 4.7 or more. The plan is version-checked as a whole. Changes log who, when,
  old and new value, no reason (`property_rating_goal_changes`). "Not now" is kept apart
  (`property_rating_goal_deferrals`): it only lets the setup read count the step as decided.
- Maths is pure and exact (`domain/rating-goal-*.ts`, BigInt rationals). Google's number
  rounds half up, so a target's threshold is five hundredths below it. The exact average is
  the cache's sum over count when the cache holds every review Google counts, else Google's
  figure. The recent mix is the last 90 days at ten reviews or more, else the latest 25.
  Reviews needed is ceil(N(θ − E)/(q − θ)); arrival is one rule for setup and tracking in
  exact days (`domain/rating-goal-arrival.ts`): a central time and a likely range (quality
  ± 0.1, pace ± 10%), never a month.
- Tracking: numbers assume the planned quality blended with reviews since the set, the plan
  counted as 15 reviews (`trackingMix`). The verdict waits for ten reviews and judges their
  own average: `reviews_too_low` (that average at or below the threshold) uses it for the
  numbers too; before the tenth review the blend is held at `minimumQualityTenths`. Pace is
  judged from when it came into force (`pace_since`): after a set or pace change the goal is
  getting started for 14 days and its window runs from the change; the card's time uses the
  chosen pace until the pace is 28 days old. The card also carries the climb (next number
  Google can show, what is still needed, last four weeks), the detail adds the climb chart
  and, by exception, low reviews since the set and this week's star split (read live, kept
  nowhere; the server function turns review ids into Inbox item ids after `inbox.read`).
- Monday check-in (`domain/rating-goal-recap.ts`): from Monday to Sunday of the Property's
  week, for a climbing goal getting started, on pace or below pace. Keep
  (`keepRatingGoalPace`, `goal.update`) stores `recap_answered_week` for every manager with
  no version and no change row, and refuses a closed check-in (`recap_closed`); a pace
  change this week answers it too. It is a card, never a notice.
- Setup is one screen worked out on the page from the setup read's exact inputs
  (`rating-goals/contracts.ts` `setupInputs`; `application/rating-goal-setup-plan.ts`
  `workOutRatingGoal`, client-safe, never throwing on typed input): planned average
  (`domain/rating-goal-average.ts`), pace chips (`rating-goal-pace-chips.ts`), recommended
  goal and time range (`rating-goal-duration.ts`). Keep comes first from 4.7. A tenth the
  cache already clears while Google lags is never a goal. A goal may be set only on an
  active Property with at least ten Google reviews and current numbers; a read waits for
  Google while its numbers are not current, show no tenth, or the cache holds no review.
- The review cache is read only through Review's `ReviewGoogleRatingReads` (counts and star
  sums, serving eligibility, binding epoch, per-year, per-month and per-date counts, the
  exact average at each week's end, Google's own numbers over time). Google's own numbers
  come from the Current on Google snapshot.
- Evaluation (`application/rating-goal-evaluation.ts`) runs from the card and detail reads,
  from `goal.google-rating-evaluation` when Review verifies Google's numbers (a completed
  snapshot's, or a head check's under `REVIEW_HEAD_CHECKS=persist`: the fact only says when
  to look, and the evaluation reads the current numbers itself), and daily from
  `rating-goal.evaluate` (lists goals across tenants by identifier only and asks its scope
  authorizer about each goal's Organization and Property before reading anything). It stores
  the tenth and status only when they change, onto the plan version it read and never over
  a newer evaluation. `goal.on-property-archived` ends only a goal set under an earlier
  binding epoch than the archive's, so a late fact never ends a goal set after a Restore.
- Notices (ADR 0067, ADR 0046), change-only, decided by `domain/rating-goal-notices.ts`
  from the stored tenth, the last status that was not a wait for Google
  (`last_known_status`) and when Below pace and New reviews too low last told
  (`below_pace_noticed_at`, `cant_reach_noticed_at`; the second column keeps its older
  name): reached (offering Keep from 4.7), Google showing another tenth, entered Below pace
  (at most once in 14 days), entered New reviews too low (ten or more reviews since the set,
  at most once in 14 days, no star figure), and a keep goal dropped below. Reached replaces
  the tenth gained, a keep goal's drop replaces the tenth lost, an ended goal tells nobody,
  and a status the goal was set in or a plan change put it in is stored without a notice.
  The evaluation write is one transaction that compares what it read and writes one
  identifier-only `goal.rating_goal.transitioned` fact per notice; Feed's
  `notification.on-rating-goal-transitioned` consumes it.
- Goal Programs and this goal never feed each other: no goal measure reads Google data
  (`GOAL_METRICS` and the metric CHECKs on `goal_program_versions` and
  `goal_subject_assignments`), and this goal reads no metric reading or goal result.

## Portal Results and the dashboard

- Portal results measures: Scans (server-verified, counted from August 2026), Ratings,
  Average rating, Went to Google (Google review link opens only), and private notes.
  Reading floors are in `domain/portal-results-thresholds.ts`. An average private rating is
  held back below five ratings and compared with the prior period only at ten in each; Google
  opens are `insufficient` (`destination_unattributed`) while any click in the period never
  recorded which link opened; a funnel step that out-counts the step before it is shown as
  counts only; qualified scans have no history before their registry `effectiveFrom`
  (`qualifiedScansSince`): a prior window that opens before it has no prior figure
  (`measure_not_yet_counted`) and a current one that does carries
  `measure_started_mid_period`.
- Results window: a bounded range is that many whole Property-local calendar days ending
  with today, from local midnight (`localDaysWindow`); the period before is as long, cut at
  the same time of day. A Portal's Results tab and the Portals overview read the same
  window. Series (`domain/portal-results-series.ts`): days up to seven local days, otherwise
  weeks anchored to the Portal's first day; a bucket's average is sum over count of its own
  ratings, held back below the floor. All Time has no comparison, series or scan patterns.
- Retention boundary: Guest-derived readings are deleted 24 calendar months after they were
  recorded, with their corrections, by the rule `metric_readings.expired`, once scheduled
  retention is activated (`docs/security/data-inventory.md`). All Time totals are computed
  from the effective readings, so they shrink with that deletion; the label is "All time"
  until retention is active and "Last 24 months" after
  (`portal-results/ui/portal-results-window.ts`).
- Link taps: governed, corrected `portal.review_link_click` readings for `secondary_link`
  with a recorded `portal_link_id`, grouped by link; labels and order come from Portal's
  `listResultsLinks`, removed links count separately. Counting began
  `PORTAL_LINK_TAPS_COUNTED_SINCE` (2026-11-01).
- Scan patterns: Guest's public read groups unretracted qualified scans by channel,
  Property-local hour and weekday in one statement; Reporting returns channels and a
  busiest-times summary, never hourly counts (from 30 scans: best two-hour interval, a
  runner-up at 80% of it, a weekday at 1.2 times the mean day). Guests by language counts
  private ratings by the language of the page the guest saw; no recorded language is its
  own line.
- Portals overview results (`getPortalResultsOverview`): the five measures per Portal, Group,
  Property subtotal and total, in a fixed number of statements per distinct time zone. Rows
  are assembled by the code that assembles one Portal's Results, each Property through its
  own window; a Property with no time zone is left out. A group's figures are its readings
  under the group each Portal had when the guest acted (ADR 0040); its evidence is the
  weakest of the Portals with readings under it. The caller supplies the roster (Portal owns
  the list) and time zones. With no Property named it reads the whole Organization: the
  roster is every Portal of every Property the caller may read for both `portal.read` and
  `dashboard.read` and is assigned to, from one Accounts grant snapshot; the limit is 1000
  Portals.
- Properties list: the fleet read pages Google snapshots at the current binding, stored
  rating goals and current Inbox attention; it accepts a cursor without a historical period
  and reads no historical analytics for list cells. Monthly goals behind pace use the shared
  running-month readings.
- Property setup (`domain/property-setup.ts`): seven steps derived at read time (Google
  binding, first sync, reply language, AI decision, responsible manager, reply voice,
  published Portal) and an eighth, "Set a Google rating goal", on an active Property where
  Google counts ten reviews and the viewer has `goal.create` while `goal.use` is on. It is
  done once a manager decided it: a goal set (active, reached or ended by a manager; a
  goal ended by location change or archive decided nothing) or "Not now". No milestone
  history: a step that stops being true needs attention again.
- Portal link-check facts remain Portal-owned and are not projected into Reporting.

### Dashboard authorization

`getDashboardData`, `getPropertyOverview`, `getAttentionSignals`, `getPortalAnalytics` and
`getPortalResultsOverview` take the caller's `AuthContext` and first ask
`application/dashboard-property-access.ts`: the reader belongs to the Organization, holds
`dashboard.read` and reaches every Property named (Organization-wide holders all, managers
only those granted). A refusal is a tagged `DashboardError` `forbidden` raised before
anything is read. `getPropertyOverview` and `getAttentionSignals` also need
`dashboard.fleet_read`, because the attention band is work state. `getDashboardData` hides
reply state from a reader without `reply.manage` (`domain/reply-workflow-redaction.ts`).
Server functions still ask the execution policy first; the use case's check is the one a
non-server caller cannot skip. Every tenant read includes Organization and Property scope or
an explicit global authority. A Member holds no `dashboard.read`; the staff self door is
governed by ADR 0076.

`getPropertyOverview` carries the governed dashboard read in `dashboard` and grant filtering
and expired-Review exclusion are checked through it by the dashboard-governance and
review-expiry e2e specs. Reply redaction has no session that can ask for it in the beta, so
`get-dashboard-data.test.ts` holds that rule.

### Staff self reads (ADR 0076)

`staff-self-results.ts` reads only the session's own personal Portal, under `staff.self` and
`staff.accounts`. DTOs allow scans, delayed rating count and average, scan-only targets or
an enabled colleague list; no Google fact, private note or manager field. Colleagues are one
accepted active roster and one batch scan read in name order; the default-off Property
setting gates it. Periods use the Property calendar (US Sunday, otherwise Monday); last
month is the previous complete local month; goals stay in the current month. Rating events
end at the start of today (or the previous month's end) and use only readings and
corrections recorded before that cutoff, so a late projection cannot move the same day's
figure; today has no rating fields and averages under five ratings are absent.
`staff_self` is a permitted consumer of qualified scans, numeric private ratings, rating
count and rating average only; their retention stays with the 24-month Guest facts. Only
qualified scans may drive a staff target (`STAFF_SCAN_TARGETS_ENABLED`, default off).

## Persistence and durable facts

- `readings/contracts.ts` owns the immutable metric catalogue: definition and version ids,
  source policies, consumer permissions, precision and sample floors. Retractions use the
  measure definitions of recording, so withdrawing a rating retracts its value, count and
  average together. `metric-command-store.server.ts` commits readings, corrections,
  attribution and source receipts atomically.
- `infrastructure/readings/effective-readings.server.ts` owns correction-tip selection,
  effective values and retracted sample counts for dashboard, goal and Portal reads (raw SQL
  uses its `readings`/`tip` aliases). Staff reads use the as-of variant. Source status and
  Portal evidence still check every required projection and retraction independently of the
  effective value. Period reads use the concurrent index on Organization, Property, metric
  version and event time (migration `0138`).
- Monthly goal totals and their completeness proof are read in one read-only
  repeatable-read transaction (`goal-metric-snapshot.ts`). The Goals list batches up to 60
  figures in one statement; historical Portal Group membership is resolved inside it,
  captured attribution (including an explicit null group) taking precedence.
  `goal-completeness-volume.test.ts` and `goal-list-progress-volume.test.ts` hold those
  set-based predicates to Portal's own group API.
- Maintenance reads Programs and due results in keyset pages of 100 (by Organization,
  Property and Program id; by period end and result id). Denied, failed and raced work
  advances the cursor and stays eligible next hour. Request lists use summaries; the history
  read uses chronological keyset pages of at most 100 results with the same tenant, Property
  and subject visibility as other goal reads.
- Closure holds the Property fence exclusively through the result and outbox commit and
  compares the snapshot's source head, so a changed head leaves the month reconciling. A
  contended fence skips the month for retry. Closure also holds the Organization lifecycle
  fence and rechecks execution policy inside its transaction; a committed hold still lets
  existing months drain (`goal-result-closure-barrier.test.ts`).
  `scripts/ops/find-stale-goal-results.sql` lists closed heads whose values differ from
  current effective readings; it is read-only and authorizes no repair.
- Metric and goal event tags (`metric-events.ts`, `goal-events.ts`) stay stable for outbox
  replay; both stored versions of `metric.recorded` remain decodable although new readings
  commit with their source receipt without emitting it. Replacements and retractions emit
  `metric.corrected` atomically. A consumer holds a receipt for a fact it finished; a fact the
  registry refuses by design (cannot be attributed, or from before its measure took effect)
  commits an `obsolete` receipt and no reading. A refusal a registry or policy change would
  undo (`source_policy_not_allowed`, `scope_not_allowed`, `definition_not_approved`,
  `unknown_definition_version`) fails the delivery so the retry applies after deploy. The
  goal correction consumer writes its receipt after a complete reconciliation pass, outside
  the result transactions (the second form in `ConsumerRegistration.handler`,
  `src/shared/outbox/consumer-registry.ts`); a pending result throws before the receipt.
- Rights: `infrastructure/adapters/reporting-rights.adapter.ts` is Reporting's executor for
  the manual rights script (access export and Organization purge of goal, metric and
  dashboard records). `retired-readings-erasure.adapter.ts` serves the command that erases
  the retired `property.review` readings.

## Verification

- `build.test.ts` pins the unified interface and worker contributions.
- Unit tests sit beside their domain, use-case, repository, adapter and server subjects;
  integration tests (`*.integration.test.ts`) exercise PostgreSQL constraints, projections
  and rights.
