---
status: accepted
date: 2026-10-14
---

# 0067 — Property Google rating goal

Amends [ADR 0031](0031-google-source-content-and-ai-processing-boundary.md)
(review-derived staff goals), [ADR 0041](0041-governed-metric-registry.md) (Google
facts and Goals) and [ADR 0049](0049-beta-local-acceptance.md) (rule 2), each by a
dated note that points here; `docs/BETA.md` §2, §3 and §10; and version 2.1 of the
Google Business Profile Access Disclosure and of the Closed Beta Participation
Agreement. The plan is `docs/plan/google-rating-goal.md`.

## Context

Managers think about their reputation in the number Google shows: "we are at 4.3,
we want 4.5". They want to set that target and know how many new Google reviews
it takes and how long it is likely to be.

Until now the written posture kept Google data away from goals. The Google Access
Disclosure (version 2.0) and the Participation Agreement (section 6) said Goal
Programs do not use Google review completion, rating or volume. `docs/BETA.md` §3
allows exactly three Goal measures, all first-party Portal facts. ADR 0031 denies
review-derived staff goals, badges and leaderboards; ADR 0041 keeps
Google-derived analytics out of Goals unless a metric version allows it; ADR 0049
rule 2 says no Google fact may drive Goals or workforce recognition; and
`gbp.review_solicitation_gamification` is `permanently_denied`. RepKey's own
disposition of the Google response of 2026-07-14 (its executable policy row,
`denied_by_separate_policy`) states the rule: review clicks, request scans,
review volume/rating, named mentions and public-review conversion never drive
staff goals, badges or leaderboards. Google's reply did not address goals, so
that rule is RepKey's own policy, and it stays as written. Google's review
policies forbid incentivised reviews and selective solicitation, and Google
flags unusual review volumes.

A Property-level target was proposed on 2026-09-30. On 2026-10-11 it was reshaped
into an automatic "next tenth" display beside the rating pages, never called a
goal, to keep it apart from Portal goals; the flexible goal months plan then put
"any Google-rating feature" out of scope (its D5) without a reason, and nothing
was built. On 2026-10-14 the owner decided to build a real goal and settled 17
decisions (the plan lists them).

Two facts about the data, checked read-only on the beta on 2026-10-14:

- Google's `averageRating` arrives already rounded to one decimal and is stored
  as a float32 artefact: `3.9000000953674316` for a Property whose complete review
  cache (261 reviews, Google's count is 261) averages exactly 3.9119. Google's
  figure never carries the exact average.
- Whether Google rounds half up or truncates could not be told apart on the beta
  data (3.9119 shows 3.9 either way).

## Decision

1. **One goal per Property.** A Property may have one active Google rating goal.
   Its target is the one-decimal number Google shows for the Property's Business
   Profile location. A _climb_ goal names a tenth above what Google shows now and
   carries a chosen weekly pace of new Google reviews: Steady (the current pace),
   Faster (about 1.5 times), Push (about twice, the cap) or a whole number from 1
   to 200. A _keep_ goal watches a tenth Google shows now and carries no pace.
2. **Reached means Google shows it.** A goal is reached only when Google's own
   number shows the target. RepKey's exact average leads the progress ("4.38 of
   4.45"); when it crosses the threshold before Google does, the screen says
   "Google should show 4.5 soon" and the goal is not reached yet.
3. **Pace first, no deadline.** A goal has no target date and cannot be missed. It
   shows a forecast month range that moves with the numbers, and it runs until it
   is reached, changed or ended. Target and pace can be changed at any time; each
   change is logged with who, when, old and new value, and no reason.
4. **It ends when its ground moves.** A goal ends when a manager ends it, when the
   Property's Google location is relinked to another place, or when the Property
   is archived. A new goal can then be set.
5. **Owners and managers only.** AccountAdmins and PropertyManagers with access to
   the Property see, set, change and end it, with the permissions Goal Programs use
   (`goal.read`, `goal.create`, `goal.update`, `goal.cancel`) and under the
   controlled-beta capability `goal.use`. Members never see it.
6. **Notices go to the Property's responsible managers** in the existing Goals
   category (bell and daily digest), with AccountAdmins as the fallback, as Goal
   notices are routed today. They report changes only. The notices and their
   ADR 0046 amendment ship together. The Goals category is the `recognition`
   category of ADR 0046, shown as "Goals", in name only: these are change notices
   to the Property's managers about a Property figure, not workforce recognition
   (ADR 0049 rule 2), and the ADR 0046 amendment must say so.

## Guardrails

These hold for the goal and for every surface that shows it.

- **Property only.** It is never split across Portals, Portal Groups or people.
  No Portal, group or person has a share of its target or pace, and no Portal
  goal is derived from it.
- **Never staff-facing.** No screen, notice or export addressed to staff shows
  it, and it names no person as responsible for the reviews.
- **Never a quota, ranking, incentive or employment input.** The pace is a
  planning figure for the Property. Nothing compares or ranks people by it,
  rewards anyone for it, or feeds an employment decision
  (`employment_decision_eligible` stays `false`, ADR 0041).
- **Portal Goals stay Google-free.** Goal Programs keep exactly their three
  measures. No Goal measure reads Google data, no Goal Program target or result is
  derived from the rating goal, and the rating goal reads no metric reading and
  no Goal result. Neither feeds the other.
- **The guest journey is unchanged.** Every guest is offered the same Google
  review action, with the same order, timing, copy and prominence, whatever the
  private rating, the goal or its status. There is no gating and no extra prompt.
- **No AI.** No AI operation sets, evaluates or explains the goal.
- **`gbp.review_solicitation_gamification` stays `permanently_denied`.** Its
  explanation ("AI or competitive mechanics to influence review solicitation")
  still holds: the goal is neither.

## Why it is not a Goal Program

- Goal Programs are monthly. Each month is a half-open Property-local period with
  its own target that closes, is judged and can be corrected (ADR 0066). A
  Google rating moves slowly and continuously, so the useful question is "when",
  not "did October reach N". A month that "missed" would say something false
  about a goal that is still on its way.
- Goal Programs target a Property, a Portal Group or a Portal. The rating goal
  must never be split, so it must not live in a model whose subjects can be split.
- Goal Programs read governed metric readings, and the three Goal measures admit
  only first-party Portal sources. Keeping Google data out of that machinery keeps
  "Portal Goals stay Google-free" mechanical: the measure list
  (`GOAL_METRICS`) and the database CHECKs on `goal_program_versions` and
  `goal_subject_assignments` refuse anything else.
- Reached is Google's own displayed number, not an evaluated monthly result.

## Data sources

- **Google's own numbers** come from the Current on Google snapshot: Google's
  average and review count as the Business Profile API sends them, published by
  Review after a verified run and refreshed every 15 minutes to 6 hours.
- **The exact average, the recent mix and the pace** come from the Property's
  cached Google reviews, read only through Review's public API as counts and star
  sums of reviews that may be served (ADR 0031) and were observed under the
  Property's current Google binding. Dates are Google's creation times. No review
  text, reviewer, identifier or per-review value leaves Review, and a read neither
  extends the cache clock nor copies content.
- **The goal stores only Property-level figures:** target, mode, pace, state,
  the Google binding it was set under, the figures it started from (Google's count
  and average, the exact average), the tenth and status it last saw, and a change
  log. It is exported and purged with the Organization's Goal records.

## Rounding and maths

- **What Google shows:** Google's average read to the nearest thousandth, then
  rounded half up to one decimal. The threshold of a target T is θ = T − 0.05
  (4.5 shows from 4.45). Half up is one named constant. If Google truncates
  instead, the plan aims a little low, but reached is still right, because it is
  read from Google's own number.
- **Exact average E:** the cache's sum of stars over its count when the cache
  holds every review Google counts (its count equals Google's); otherwise
  Google's figure, and the screen says the numbers are approximate.
- **Recent mix m:** the average stars of the Google reviews created in the last
  90 days when there are at least ten, otherwise of the 25 most recent.
- **Reviews needed:** with N Google reviews, n = ⌈N(θ − E) / (m − θ)⌉ when
  m > θ. When m ≤ θ no pace reaches the target at this mix; the screen says so and
  suggests the highest target that is reachable. The best case uses m = 5.
- **Current pace:** Google reviews created in the last 28 days, per week. The
  suggested paces never fall below 1, 2 and 3 a week.
- **Forecast:** a month range in the Property's time zone, its early end at the
  mix 0.1★ better and the pace 10% faster, its late end at the mix 0.1★ worse and
  the pace 10% slower.
- **Exact arithmetic:** counts of reviews are worked out on exact rationals, not
  floats, so a float artefact never asks for one review too many.

Worked example: 812 reviews, exact average 4.31 (Google shows 4.3), recent mix
4.70. 4.4 needs 93 more reviews; 4.5 needs 455, or 207 if every new review is
five stars; 4.6 needs about 1,300; 4.8 cannot be reached at this mix.

## Consequences

- Google's wording changes first. Version 2.1 of the Google Access Disclosure and
  of the Participation Agreement describe the goal and its guardrails; ADRs 0031,
  0041 and 0049 carry dated notes; `docs/BETA.md` §3 states the rule. Nothing
  that shows the goal ships before both documents are published.
- The Privacy Notice stays at version 2.2. The goal processes no new class of
  personal data: it uses Google's figures for the location and counts and star
  sums of reviews the Service already imports and analyses, and it stores no
  review content. The Goal Programs the notice describes keep their three
  measures.
- Reporting gains two tables (migration 0056) and their Organization export and
  purge. Review gains a read port that hands out counts and star sums only.
  The notices (PR 5) add three columns to `property_rating_goals`
  (`last_known_status`, `below_pace_noticed_at`, `cant_reach_noticed_at`;
  migration 0057), exported with the table, and a daily job, `rating-goal.evaluate` (`goal.use`), because Below
  pace moves with the calendar rather than with a Google fact (ADR 0046,
  amended 2026-10-14).
- Like every enabled feature (ADR 0049), the goal needs a positive journey, a
  denial journey for a Member, and an emergency switch, which is `goal.use`.
  `goal.use` is a shared switch: turning it off for an Organization or Property
  also turns off Portal Goal Programs there, and turning it on offers both. The
  `goal.use` explanation in `capability-fate.ts` ("Property, Portal Group, and
  individual Portal Goals over scans, rating count, and rating average") is
  updated in PR 2 to name the rating goal and to keep the Portal measures
  described as private ratings; its fate stays `controlled_beta`. A separate
  capability for the rating goal is the alternative if the owner wants to switch
  the two apart (plan, open question 8).
- Google's wording is not the only external check. The disclosure's change
  control asks the release owner to recheck Google's public Business Profile
  and review policies whenever a data flow changes, and the goal adds a flow
  (counts and star sums to Reporting; Google's rating and a weekly pace of new
  reviews). The release owner does that recheck before the change that shows the
  goal ships (PR 3), and refreshes the disclosure's "last refreshed" date if
  Google's policies changed.
- A weekly pace could be read as a solicitation quota. The guardrails are the
  control: the goal is not shown to staff, Push is capped at about twice the
  current pace and a custom pace above that shows a surge caution, and the copy
  speaks of new reviews, never of asking a number of guests.
- The forecast is honest uncertainty, not a promise: a month range, no date, no
  "missed". When the recent mix sits close to the threshold the range is wide.
- The rounding rule is not verified. It is one constant, and reached does not
  depend on it.

## Amended 2026-10-15 — planned review quality

A beta Property that Google shows at 3.9 had its last 25 reviews at 3.92, under
4.0's threshold of 3.95, so the goal said a higher number was not reachable at
the recent star mix and offered Keep. A Property with weak ratings can raise
its mix on purpose, so a plan now states the quality it assumes. The owner's
round 2 decisions (R2-1 to R2-12; the plan's "Round 2") amend decisions 1 and 3
and the maths:

1. **A plan has three parts.** A climb goal is a target, a _planned quality_
   (the average stars it assumes new Google reviews bring, a tenth of a star)
   and a weekly pace. The quality is stored on the goal and is part of its
   version-checked plan; a change of it is logged like target and pace. A keep
   goal has none.
2. **The quality comes from evidence.** Its options are anchors, never
   arithmetic offsets: the recent mix ("Like now"), the best calendar year with
   at least ten reviews ("Like your best year"), "a step above what {T} needs"
   (the threshold + 0.3★, rounded up) and "Excellent" (4.8★). A quality must
   clear the target's threshold by 0.15★, because reviews needed =
   gap / (quality − threshold) explodes near it; anchors below that floor are
   dropped, and a manager's own quality obeys it. The recommendation is the
   recent mix if it clears, else the best year, else a step above.
3. **Pick a plan.** Setting a goal is one step: three complete plans that share
   one quality (Cautious: the recommended target at Steady; Recommended: at
   Faster; Ambitious: the highest higher target the quality clears that Push
   reaches within a year, else the recommended target at Push), or "Build
   your own" from a target row, a quality row and a pace row. Every target is
   worked out at its own recommended quality, so no stop is "never at this mix".
   Keep is offered only when Google shows 4.9 or 5.0.
4. **New reviews are judged once there are ten.** Until ten Google reviews
   have arrived since the goal was set there is no verdict on their stars and
   the goal's numbers assume the planned quality; from the tenth on they assume
   those reviews' average. The status "New reviews too low" (that average at
   or below the target's threshold) replaces "Can't reach at this mix", which
   judged the recent mix, and its notice replaces the Can't reach notice
   (ADR 0046, amended 2026-10-15). Trailing the plan's quality is a line on the
   detail page, not a status and not a notice.

The maths is otherwise unchanged: reviews needed is ⌈N(θ − E) / (q − θ)⌉ with
the planned quality q in place of the recent mix, the forecast drifts q by
0.1★ and the pace by 10%, and counts stay exact rationals. Worked example (the
beta Property, about one review in 28 days): 4.0 at the best year's 4.5★ needs
19 reviews, Realistic at 2 a week; the quality options are 4.3, 4.5
(recommended) and 4.8.

**Data.** Migration 0059 adds `quality_tenths` to `property_rating_goals` (a
climb goal's quality, at least the target so above its threshold, at most
5.0; the 0.15★ floor stays the domain's rule), lets the change log take
`quality`, and replaces `cant_reach_at_mix` with `reviews_too_low` in both
status CHECKs; a stored retired status is cleared, not translated. The notice
time keeps its column, `cant_reach_noticed_at`, so the release still running
while web migrates keeps working. Review's rating read gains two counts-and-sums
answers: the totals since an instant (the reviews since a goal was set) and
each Property-local calendar year's totals (the best year). No review content,
reviewer or per-review value leaves Review, as before.

**Guardrails.** Unchanged. The quality is a planning figure for the Property,
like the pace, never a staff target. The copy says what moves the number
without asking for selective solicitation (R2-12): "Your Portals offer every
guest the same Google review link. Asking every guest, not only the ones who
would write anyway, and better stays are what move this number."

**Keep, and plans more than a year away (2026-10-15, review fixes).** Keep is
offered only while Google shows 4.9 or 5.0, everywhere: the reached news offers
"Keep 4.9" at 4.9 and only "Set your next goal" below it, the Reached notice
offers to keep the number only there (ADR 0046), and the set and change commands
refuse a keep goal while Google shows less, so no stale page sets one. A plan
and a Build your own preview carry their reach, the target label's rule at the
plan's own pace; a plan card wears no Realistic or Stretch label, but one more
than a year away at its own pace says "More than a year", and so does the live
total of a plan built by hand. Amended 2026-10-15 (owner, R2-13, amends R2-9):
the Ambitious plan stays within a year. It is the highest target of the row that
the shared quality clears by 0.15★ and that the Push pace reaches within 52
weeks, else the recommended target at Push; a target past a year stays in Build
your own, which says "More than a year".

**Screens (2026-10-15).** "Pick a plan" is one step: the shared quality line
with its "Change", the three plans as radio cards, the policy line and "Build
your own", a disclosure that is the plan being set while it is open (closing it
returns to the card it was opened from). "Change" opens Build your own on its
quality row; the three plans keep their quality, so the first screen does not
change under the manager. A change of a goal adds its own plan as a fourth
card, "Your plan", checked, with Build your own prefilled from it. The card's
chip names the target while new reviews are too low ("New reviews too low for
4.0"), and the detail page's "Your plan" sets the goal, the new reviews'
average (after ten) and the pace against the plan, above the forecasts.

## Amended 2026-10-16 — rounds 3 and 4, storage

The setup now plans a pace a day ("1.5 a day") or a month ("20 a month") and
plans new reviews from the Property's best month and busiest 30 days (owner
decisions R3-1 to R3-12 and R4-1 to R4-4). This amendment covers what is stored
and read; the one-screen setup follows in its own change.

1. **A pace in tenths of a review a week.** A climb goal stores its pace in
   `pace_tenths_per_week` (migration 0060), whole tenths from 10 (1 a week) to
   3500 (50 a day): the one unit in which a pace a day or a month round-trips
   (1.5 a day is 105; 20 a month reads back as 20 a month). Tracking stays
   integer maths: on pace is reviews × week × 1000 ≥ 90 × tenths × window,
   compared in BigInt. The change log's `pace` rows are tenths; 0060 rewrote the
   old rows × 10, so the field has one meaning.
2. **One release of legacy fields.** `pace_per_week` stays as the whole weekly
   mirror, `GREATEST(1, (tenths + 5) / 10)`, held equal by the plan CHECK, so a
   worker still running the release before reads a pace it knows. The set and
   change schemas also accept a legacy whole weekly `pacePerWeek` (1 to 200,
   mapped × 10; a request naming the pace both ways is refused), so a page
   opened before the release keeps working instead of having its pace stripped.
   `goal.rating_goal.transitioned` adds `paceTenthsPerWeek` and keeps
   `pacePerWeek` (widened to 350); Feed's payload carries both. A contract
   migration drops the mirror and the legacy fields once no release reads them.
3. **Two more Review reads, counts and sums only.** Review answers the totals
   of each Property-local calendar month with at least ten reviews and the count
   of reviews on each Property-local date (no sum: a date with one review would
   expose its rating, and a month under ten is never returned, so no month's
   total is one review's stars; comparing successive reads of the growing
   current month is out of scope, since managers see each review in the
   Inbox). Reporting trims them to the best month of the last twelve and the
   busiest 30 consecutive local dates of the last 365, and the setup read
   returns them with Google's numbers as `setupInputs`. The server runs no planning maths for them; the
   page works the plan out.
4. **Waiting for Google on an empty cache.** A reading waits while Google's
   numbers are not current, show no tenth or give no exact average, or the
   review cache holds no review. The last replaces the recent mix's absence,
   which held exactly when the cache was empty: an empty or expired cache keeps
   a goal waiting (no zero-review pace window, no Below pace notice) and keeps
   the setup closed until the import has filled it.

## Rejected alternatives

- **A fourth Goal measure for the Google rating.** It would put Google data into
  the Goal machinery that Portal and Portal Group goals share, make a split
  possible, and force a monthly verdict onto a number that moves over months.
- **An automatic "next tenth" display, never called a goal** (2026-10-11). It
  hid the decision managers want to make, and it was never built.
- **A required target date.** A fixed date is misleading and hardens
  expectations; a pace and a moving month range say what is known.
- **Per-Portal or per-person Google review goals.** A Property has one Google
  review link, so a review cannot be attributed to a Portal or a person, and a
  Portal quota becomes a personal quota.
- **RepKey's cache average as the headline.** The goal is about what guests see
  on Google, so screens lead with Google's own number and use the exact average
  for progress.
