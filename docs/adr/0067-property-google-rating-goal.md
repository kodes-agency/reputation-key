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

## Amended 2026-10-16 — rounds 3 and 4, setup

The setup is one screen opened already answered (the approved mocks E2 on a
desktop and E4 on a phone): the number Google is to show, when it arrives and
what it needs, then the plan behind it. A manager accepts it in one tap ("Aim
for 4.1") or adjusts it. It is worked out on the page from the setup read's
exact inputs (`workOutRatingGoal`); the server runs no planning maths for it.

1. **Proactive pace chips replace Steady, Faster and Push** (R3-1, R3-3), and
   with them the surge caution. The proven pace is the busier of the last 90
   days and the busiest 30 consecutive local days of the last year, a day. The
   recommendation is the nice pace (1, 2, 3, 5, 7, 10, 15, 20, 30 or 50 a day)
   nearest one and a half times it, at least 1 a day, a tie going up. A quiet
   Property (under 1 a day) is offered "A few a week" (3 a week), 1, 2, 3 and 5
   a day; a busy one its busiest month, the recommendation and the three nice
   paces above it. A manager may type a pace a day (one decimal) or a month,
   clamped from 0.2 to 50 a day. A month is 30.4 days. Decision 1's "Steady /
   Faster / Push or a whole number from 1 to 200" and the surge caution of the
   Consequences no longer hold; the copy never asks for a number of guests and
   says how to ask (R3-12).
2. **The planned average is automatic** (R4-1, R4-3): the higher tenth of the
   Property's best calendar month of the last twelve and its best calendar year
   (each with ten reviews; a tie goes to the month), or halfway between the
   shown number and five stars when that is higher, never above 4.8. It is
   shown as a fact with its source; "Change" lets a manager type their own from
   two tenths above the shown number to 5.0. Change plan keeps a stored average
   that is not today's automatic one, worded as "your plan's average". R2-5's
   switch is unchanged: from the tenth review since the goal was set, their own
   average replaces the planned one (the blend R4-2 proposes is a separate
   change; it replaced this switch the same day, see the next amendment).
3. **The recommended goal** (R4-4) is the highest one reached within six months
   even if new reviews average 0.1★ below plan, at least the next tenth; the
   status line names the next one up ("4.2 possible in about 6 months"). − and
   - pin another goal; "Back to 4.1, recommended" lets go. Over six months, the
     status offers the first faster chip that gets there, keeping the goal it
     names.
4. **The setup's time is a central figure and a likely range**, not month
   names: "in about 3 months, likely 9 weeks to 4 months", the range's ends at
   0.1★ better and asking 10% more, 0.1★ worse and asking 10% less, open when
   0.1★ worse no longer reaches the goal. Days are exact fractions; a range
   reads "a weeks to b months" when its fast end is under 70 days. The card and
   the detail page keep `forecastArrival`'s month ranges; the done screen repeats
   the setup's words. (Round 5 retired the month ranges; see its amendment.)
5. **Google lagging behind the cache.** A tenth the cache's exact average
   already clears while Google shows less is never a goal: the setup starts
   above it and says "Google should show 4.0 soon"; when every tenth to 4.9 is
   earned, it asks the manager to set the goal once Google catches up.
6. **Keep first from a shown 4.7** (owner, X1, amending R2-9). At 4.7 the next
   tenth needs new reviews averaging 4.9★ or more, at 4.8 every one to be 5★,
   so the setup opens on Keep and says why; "Raise it anyway" opens the climb
   with a typed average from two tenths above the shown number. A goal to keep
   may be set from 4.7. 5.0 is never a target and the 5.0 stop is gone.
7. **Tracking words.** A plan reads per day ("2 a day", per week under one a
   day); progress is still counted per week ("This week: 9 of 14 reviews") and
   judged on the last four weeks as before.

## Amended 2026-10-16 — new reviews take over step by step

The owner approved R4-2's blend (X3, R4-5) as its own change after the setup.
R2-5's hard switch made a goal's numbers jump on the day its tenth review
since the set arrived (the plan's 4.5★ replaced at once by ten reviews' noisy
average, ±0.3★ in the simulations); a blend moves them a little with every
review. It amends decision 4 of the 2026-10-15 amendment for the numbers only:

1. **The numbers blend from the first new review.** A climb goal's forecast,
   "Still needed" and next tenth assume (W × q + s) / (W + n), where q is the
   planned average, n the reviews since the goal was set, s their stars and
   W = 15 (`PLANNED_AVERAGE_WEIGHT_REVIEWS`): the plan counts like fifteen
   reviews, so after fifteen new ones both weigh the same. Exact rationals, as
   every count. With no new review it is the plan's average.
2. **The verdict does not blend.** "New reviews too low" still waits for ten
   reviews and judges their own average against the target's threshold; its
   notice is unchanged (R2-5, R2-10).
3. **Too low, the numbers judge as the status does.** While a goal is too low
   its numbers use the since-set average itself, not the blend, so "Still
   needed" reads "Not reachable" beside the chip. A blend with a plan above the
   threshold would still reach the target and contradict it.
4. **Before the tenth review, no verdict in the numbers either.** A few low
   early reviews could pull a plain blend to the target's threshold or below,
   so the numbers would read "Not reachable" under a Getting started or On pace
   chip: a verdict on quality R2-5 holds to ten reviews (Olive Tree, plan 4.6★
   for 4.4: two 1★ reviews blend to 4.18★, under the 4.35★ threshold). Before
   the tenth review the blend is held at `minimumQualityTenths` for the target,
   the least a plan may assume (a plan at that floor then reads as the plan
   alone). From the tenth no floor is needed: a blend of the plan with reviews
   that clear the threshold clears it too. A stored plan is never under the
   floor, so a goal that is not too low never reads "Not reachable".
5. **The words say so.** "Your plan" notes "forecasts use 4.55★, your plan
   mixed with them" (or "the numbers use their average" while too low, since a
   too-low goal shows no forecast, only "Still needed" and the next tenth) and
   still shows the new reviews' own average only from the tenth; the setup's
   planned average says "Your real average takes over step by step as reviews
   arrive." and its explanation "we count 4.5 stars as if 15 reviews gave it,
   so after 15 new ones both weigh the same. If 10 or more new reviews average
   too low for your goal, their own average counts alone."
6. **Notice volume cannot change.** The evaluation and its notices never read
   the forecast average: neither imports `trackingMix`, which the check over 24
   representative goals for 26 weeks
   (`application/rating-goal-blend-volume.test.ts`) asserts. The check pins the
   Below pace, too-low and reached notice counts and shows identical streams at
   another planned quality; it is an independence result, not a before/after
   run of R2-5's switch. On screen the assumed average moves at most 0.06★ when
   the tenth review arrives where the switch moved 0.30★, and the check counts
   chip and numbers disagreeing both ways (none as built).

No data change: `qualityBasis` in the read DTOs gains `blended`, and
`since_set` now means "too low"; "Your plan" adds `assumedAverage`.

## Amended 2026-10-16 — round 5, tracking card

The owner chose R3-8's tracking blend (canvas row D, mocks D2 and D4; R5-1)
and answered PLAN-D's questions (Q1: "new reviews"). This first part changes
the card on the Goals page and the Property Overview; the detail page, the
low-review rows and the Monday check-in follow in their own amendments.

1. **Months are retired; one arrival rule.** Every time a goal names is a
   duration from today in the setup's own words ("4.1 in about 3 months at
   your 1 a day, likely 9 weeks to 4 months"), worked out by one rule for the
   setup and for tracking (`domain/rating-goal-arrival.ts`, `arrivalDays`):
   the central time at the average the goal assumes; the fast end at 0.1★
   better (never above five stars) and 10% more a week; the slow end at 0.1★
   worse and 10% less, open when 0.1★ worse no longer clears the goal by
   0.15★ (the setup's margin). A pace is reviews per days, so the chosen pace
   (tenths a week per 70 days) and the actual one (the last 28 days' reviews
   per 28) stay exact integers. This closes the split decision 4 of the setup
   amendment left (`forecastArrival`'s month ranges on the card and the
   detail): `forecastArrival`, its month helpers and `RatingForecastView` are
   gone, and the setup's `likelyDays` is a wrapper over the same rule. The card
   keeps Q8's basis: the chosen pace until the goal is 28 days old, then the
   last four weeks', and the sentence names which.
2. **The headline counts to the next number Google can show**: "18 new
   reviews to 4.1", the next number being the tenth above what the reviews
   have earned, at most the goal. A tenth the cache already clears while
   Google shows less is skipped and named beside the headline ("Google should
   show 4.4 soon"), so the card never says "0 new reviews to 4.4"; once the
   reviews have earned the goal itself the headline is "Google should show 4.1
   soon". When the headline counts to a nearer number, a quiet line gives the
   goal's own total ("212 new reviews to your goal, 4.5."). The unit is "new
   reviews" (Q1): reviews at the average the goal assumes, not five-star ones.
3. **The ladder** shows where the goal started (while Google shows more now),
   today, a tenth Google should show soon, the next number when it is not the
   goal, the goal, and the number above it as possible (R4-4: "4.2 is possible
   in about 6 months", at the same pace as the arrival, offered while the
   average clears it by 0.15★), five numbers at most, the start dropped first.
   The "possible" number is drawn only when the card says it: not past three
   years and not while the card waits for Google's latest numbers. While
   Google's numbers are stale the ladder says what Google "showed last", not
   what it "shows now".
4. **One empty square per review the headline counts**, from 1 to 30, and only
   while RepKey holds every review Google counts: past 30 the squares are
   noise, and under Google's own rounded figure (where every count reads
   "about") a row of squares would promise a count nobody knows.
5. **This week and the first step.** "This week: 2 of 7" with the day of the
   Property week ("It’s Tuesday", worked out on the server at every card read)
   and, once the goal works at its actual pace, the last four weeks' pace a
   day or a week (R3-7, also for a goal set "a month"; no unit is stored).
   "Google shows 4.0 now, up from 3.9 when you started." once it does, and
   only while Google's numbers are current. The card's exact-average progress
   bar is retired; the exact average stays on the detail page. A card under
   48rem is D4's short card: the ladder, the headline with its squares, one
   line "This week 2 of 7 · 4.1 in about 3 weeks" and View details; the pace
   and the likely range, the possible line, the week's bar, the first step and
   Open Portals are on the wide card (a reason there is no time, such as no
   pace, is said at every width).
6. **No new read.** The card read computes everything from the numbers it
   already reads (the next number, what the goal still needs, the number above
   it, the last four weeks, the baseline and the weekday): no extra query, no
   new query key, nothing new in first paint.
7. **The detail counts as the card does.** Its "Next: Google shows 4.4 after
   about 31 more reviews" line and the mark on its bar use the card's next
   number, so with Google lagging on 4.4 the detail says "Google should show
   4.4 soon" and the card and the detail never disagree. The tenth above what
   Google shows (`nextTenthMilestone`) is retired.

## Amended 2026-10-16 — round 5, tracking detail

The detail page becomes D3 (R3-8: A's fan chart, the plan so far, C's "what
moved you"), and it reads two more figures from Review. Neither moves the data
boundary above (PLAN-D §4.1): every aggregate read keeps the rule that no
window aggregate (a week, a month, a range) returns a star sum for fewer than
ten reviews, and no read returns a review.

1. **The exact average at the end of each week** (`getWeeklyHistory`): per
   Property-local week from four weeks before the goal was set (a year at
   most), the reviews created that week and the average of every current
   review created before the week ended, in thousandths. Review works these
   out itself from the week sums and the whole-history total in one statement
   and keeps the sums: what leaves is counts and averages. A week-end average
   is the whole-history aggregate `all` as of that week's end, a class the
   goal already reads; the difference of two of them can tell one new
   review's stars exactly as two reads of `all` a day apart already can, which
   the read port accepts (managers see each review in the Inbox). It replaces
   the weekly counts the old weekly bars read. It is drawn only while RepKey
   holds every review Google counts: a partial cache would draw a false line.
2. **Google's own number over time** (`getShownNumberChanges`): from the
   verified snapshot facts Review keeps under the Property's current binding,
   the snapshot in force when the chart starts and each later one whose
   one-decimal number differs from the one before it (newest 100 at most).
   These are Property-level figures Google publishes; nothing is stored for
   the goal.

3. **The page.** The header leads with the card's headline and says when the
   goal arrives at the card's own pace (the same arrival object the chart's
   likely band is drawn from, so words and shape cannot disagree), where
   Google stands against where it started, the number possible after it and,
   once the goal works at the last four weeks' pace, the chosen pace's time
   too (Q8). "The climb, step by step" draws the exact average at each
   Monday from four weeks before the set's week (a year back at most), the
   plan as a cone from the set (the stored baseline) or the latest plan change
   (the history at that week's Monday, no interpolation; none under a partial
   cache), the likely band from today, a line for each tenth and Google's own
   moves, in weeks from today, never dates, in a chunk of its own. "Your
   plan, so far" sets the last four weeks' pace against the plan and the four
   full weeks before the goal, the new reviews' average against the plan's,
   and the steps reached and next. "What moved you" says it in words: this
   week's count, Google's moves, each change of the plan and what the goal was
   set with (each field's first logged change, so a long log cannot lose it).
   The exact-average bar, the tiles, the weekly bars, the star mix since the
   set, the best case and the separate change log are retired (Q7's detail;
   R3-8 replaces it).

The per-review rows the mock also shows (low reviews and this week's stars)
are not part of this amendment: they need the owner's exception (PLAN-D Q2)
and follow in their own.

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
