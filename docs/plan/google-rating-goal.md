# Property Google rating goal: plan

Date: 2026-10-14. Status: owner-approved decisions (17), being built in six pull requests. Written from the owner grilling of 2026-10-14 against `origin/main` at `78f4d0b80`. The decision record is [ADR 0067](../adr/0067-property-google-rating-goal.md). Paths are relative to the repository root.

## Why the Google goal was missed

- **2026-09-30.** The owner asked for a rating target at Property import ("3.7, pick 4.0 or 4.2, how many reviews"). A Property-only rating plan was proposed, design only.
- **2026-10-11.** On review it was reshaped into an automatic "next tenth" display beside the Property's rating pages, "never called a goal", to keep it apart from Portal goals as the owner asked.
- **2026-10-11.** The flexible goal months plan (`docs/plan/goals-flexible-months.md`) then put "any Google-rating feature" out of scope (its D5) without a reason. No later plan picked it up, so neither the display nor a goal was built.
- **2026-10-14.** The owner grilled the missing goal and settled the 17 decisions below. The written posture also had to move: Google Access Disclosure 2.0, Participation Agreement §6, `docs/BETA.md` §3, ADRs 0031, 0041 and 0049, and the `permanently_denied` capability `gbp.review_solicitation_gamification` all kept Google data away from goals.

## What changes

A Property gets one Google rating goal: a target for the number Google shows, plus a chosen weekly pace of new Google reviews. A forecast month range replaces a deadline. It sits on the Goals page above Portal goals, with its own wizard, a simple card and a detail page. Portal Goal Programs keep their three measures and get two fixes. Nothing that shows the goal ships before the legal wording in PR 1 is live.

## Owner decisions (2026-10-14)

- **D1. A real goal.** A "Google rating goal" on the Goals page, in its own section above Portal goals. One per Property; owners and managers only; never split across Portals, Portal Groups or people; never shown to staff; never a quota or ranking; Portal goals stay Google-free. Publish version 2.1 of the Google Access Disclosure and the beta agreement §6; amend `docs/BETA.md` and ADRs 0031, 0041 and 0049.
- **D2. Reached means Google shows it.** The target is Google's one-decimal number. The plan aims at the exact threshold (4.45 for 4.5). Reached only when Google's own number shows the target. Screens lead with Google's number and show the exact average as progress ("4.38 of 4.45"); when RepKey's cache crosses first, "Google should show 4.5 soon" (Google can lag up to two weeks).
- **D3. Pace first, no date.** A goal is a target plus a weekly pace: Steady (the current pace), Faster (about 1.5×), Push (about 2×, the cap, because Google flags surges) or a custom number. The pace is shown per week (headline), per month and per day. Arrival is a forecast month range that moves with the numbers. No deadline, no "missed"; a goal runs until it is reached, changed or ended. (A required date was the first answer and was withdrawn: a fixed date misleads and hardens expectations.)
- **D4. The recent star mix.** The headline uses the recent mix: the average stars of the last 90 days (at least 10 reviews, else the last 25). A quiet best-case line, worded by the owner as "if every new review is 5★: 207, ~5 months" (worked at 10 a week; at the 11 a week this plan takes, the same 207 is about 4 months, see open question 7). When the recent mix is at or below the threshold, the screen says no pace reaches the target at this mix and suggests the highest reachable target.
- **D5. The picker.** A slider in tenths from the current tenth + 0.1 to 4.9; 5.0 visible and disabled with its reason. Labels from the forecast at the Faster pace: Realistic within 6 months, Stretch within 12, Out of reach beyond that or never at the recent mix. Preselect the highest Realistic stop, at most +0.3; else the next tenth. Out-of-reach stops stay selectable with a clear warning.
- **D6. Lifecycle.** Reviews needed and the forecast are recomputed daily from Google's current numbers and the recent mix. The chosen pace stays until changed. Target and pace can be edited any time; a short change log (who, when, old → new), no reason. Progress is the exact average from the baseline to the threshold. Reached: celebrate, record the date, move to History, offer the next tenth (preselected) or "Keep 4.5" (watch mode, warns if Google drops below). End any time.
- **D7. Two levels of tracking.** The Goals page and the Property Overview show a simple card only. The detail page is the full monitoring view, one click away. The Properties list shows one status word. Rating history stays on the Ratings page. Portal goals are a separate list below, with no shared numbers. Owner principle: first-time and setup screens are much simpler; detail is one click away.
- **D8. Status.** From Google reviews in the last four weeks against the chosen pace (see Statuses). The simple card forecasts from the actual four-week pace once it exists, otherwise from the chosen pace; the detail page shows both.
- **D9. Wizard scope.** A Google-goal-only wizard with three doors: the last, skippable step of Property setup when Google's numbers are ready; the Goals page empty state "Set your Google rating goal"; one item in the setup strip. The last screen offers one onward link (Create a Portal, or Set portal goals once Portals exist) and carries no numbers over. Portal goals keep their own flow.
- **D10. Wizard steps.** Step 1 "Pick your goal", step 2 "Pick your pace", then "Your goal is set" (see Setting a goal).
- **D11. Notices.** Change-only, to the Property's responsible managers (AccountAdmins as fallback, the resolver Goal notices use), in the existing Goals category (bell and daily digest, existing per-channel settings). No weekly summary for now.
- **D12. Access.** As Portal goals: AccountAdmins and PropertyManagers with access to the Property see, set, change and end it (`goal.read`, `goal.create`, `goal.update`, `goal.cancel`). Members never.
- **D13. Several Properties.** The Properties list gets a "Google goal" column ("4.5 · On pace" or "Set goal"). A single-Property import ends with the goal step; a multi-Property import skips it and the setup strip reminds per Property. No bulk table now.
- **D14. Portal goals: two fixes only.** (1) Goals list rows show live "64 of 120 so far · 14 days left" and a simple bar (the existing progress read). (2) A real "behind pace": a count goal expects target × the elapsed share of the month; below 90% is Below pace (the same threshold); averages show current against target with no pace. It feeds the Overview chip and the Properties list attention. Follow-up, owner decision 2026-10-14: a single-subject count row also says it, in quiet amber text, after the days left where the cell has room ("64 of 120 so far · 14 days left · below pace") and beside the bar where it has not, so a phone row is no taller when the note arrives, from the same pace rule and figures the list already reads (90%, the first three days not judged, averages never). The bar stays neutral, and a goal with several subjects keeps its "N below pace" count.
- **D15. Edge cases, all seven** (see Edge cases).
- **D16. One rating number.** Every headline rating (Overview tile, Properties list, goal) shows Google's own number and count. The Ratings page keeps RepKey's period averages for date ranges.
- **D17. Build.** Six PRs, each in a fresh worktree off `origin/main`, never the main checkout (see Pull requests).

## Terms

- **Google shows**: Google's average read to the nearest thousandth, then rounded half up to one decimal. Google sends `averageRating` already rounded and stored as a float32 artefact (`3.9000000953674316`).
- **Target T** and **threshold θ = T − 0.05**: 4.5 shows from 4.45.
- **Exact average E**: the review cache's sum of stars over its count when the cache holds every review Google counts (its count equals Google's). Otherwise Google's figure, and the screen says the numbers are approximate.
- **Recent mix m**: average stars of the Google reviews created in the last 90 days when there are at least 10, otherwise of the 25 most recent.
- **Current pace**: Google reviews created in the last 28 days, per week.
- **Chosen pace**: the weekly number the manager picked: Steady, Faster, Push or custom.
- **Climb goal**: a target above the tenth Google shows now, with a pace. **Keep goal**: a watch that Google keeps showing a tenth it shows now; no pace.
- **Baseline**: Google's count and average and the exact average when the goal was set; progress runs from the baseline exact average to θ.

## The maths

With N Google reviews:

- **Reviews needed** n = ⌈N(θ − E) / (m − θ)⌉ when m > θ. When m ≤ θ, no pace reaches the target at this mix.
- **Best case** uses m = 5.
- **Paces**: Steady = max(1, round(p)), Faster = max(2, round(1.5p)), Push = max(3, round(2p)), with p the current pace and rounding half up (open question 7); each at least one above the one before. Per month = round(w × 52 / 12); per day = w / 7 to one decimal.
- **Forecast**: a month range in the Property's time zone. The early end takes the mix 0.1★ better and the pace 10% faster; the late end the mix 0.1★ worse and the pace 10% slower. When the worse mix no longer clears θ, the late end is open.
- **Labels** (at the Faster pace and the recent mix): Realistic within 26 weeks, Stretch within 52 weeks, Out of reach beyond that or never.
- Counts are worked out on exact rationals, not floats: a float subtraction such as 4.45 − 4.35 lands a hair above 0.1 and would ask for one review too many.

### Worked example

812 Google reviews, exact average 4.31 (Google shows 4.3), recent mix 4.70, current pace 7 a week. Faster = round(10.5) = 11 a week.

| Target | Threshold | Reviews needed at mix 4.70 | Best case (every new review 5★) | At Faster (11 a week)   | Label                  |
| ------ | --------- | -------------------------- | ------------------------------- | ----------------------- | ---------------------- |
| 4.4    | 4.35      | 93                         | 50                              | ~8.5 weeks (~2 months)  | Realistic, preselected |
| 4.5    | 4.45      | 455                        | 207                             | ~41 weeks (~9.5 months) | Stretch                |
| 4.6    | 4.55      | 1,300                      | 434                             | ~118 weeks (~2.3 years) | Out of reach           |
| 4.7    | 4.65      | 5,522                      | 789                             | ~10 years               | Out of reach           |
| 4.8    | 4.75      | never at this mix          | 1,430                           | never                   | Out of reach           |
| 5.0    | —         | —                          | —                               | —                       | Disabled               |

- 4.4: 812 × 0.04 / 0.35 = 92.8, so 93. 4.5: 812 × 0.14 / 0.25 = 454.7, so 455; best case 812 × 0.14 / 0.55 = 206.7, so 207. 4.6: 812 × 0.24 / 0.15 = 1,299.2, so 1,300. 4.8: θ = 4.75 is above the mix, so no pace reaches it.
- Forecast ranges if set on 2026-10-14 at 11 a week: 4.4 Nov 2026 – Jan 2027; 4.5 Apr 2027 – Apr 2028 (325 reviews at 12.1 a week to 758 at 9.9 a week).
- DECISIONS.md worked the example at 10 a week (4.4 about 2 months, 4.5 about 10–11 months, 4.6 about 2.5 years, best case for 4.5 about 5 months) and wrote 1,299 for 4.6. The labels are the same either way.

### What the beta data says (read-only, 2026-10-14)

- Google's average arrives already rounded. A Property whose complete cache (261 reviews, Google's 261) averages 3.9119 has `averageRating` 3.9000000953674316. So "Google shows" is Google's own number, and the exact average must come from the cache.
- Half up could not be told apart from truncation (3.9119 shows 3.9 either way). Half up stays one named constant; reached is read from Google's own number, so it is right either way.
- Property A: 261 reviews, shows 3.9, only 8 reviews in 90 days (the mix falls back to the last 25), a pace of 0.25 a week (the 1 / 2 / 3 floor applies), and a recent mix that may sit at or below the next threshold, 3.95: "Can't reach at this mix", offer Keep.
- Property B: 19 reviews, all 5★, shows 5.0: no higher tenth, so Keep 5.0 comes first.

## Statuses

The first that holds wins.

| Status                  | When                                                                                                  | Tone                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| Waiting for Google      | no Google numbers, numbers older than 24 hours, or Google disconnected                                | neutral; numbers "as of"      |
| Reached                 | Google shows the target                                                                               | celebrate; moves to History   |
| Can't reach at this mix | the recent mix is at or below the threshold                                                           | amber, with one suggested fix |
| Getting started         | the first 14 days                                                                                     | neutral                       |
| On pace                 | reviews in the last 28 days (since the goal was set, before day 28) at 90% of the chosen pace or more | green                         |
| Below pace              | otherwise                                                                                             | amber                         |

A keep goal is Holding while Google shows the kept tenth and Dropped below when it does not; it waits for Google the same way.

## Setting a goal

- **Doors**: the last, skippable step of Property setup when Google's numbers are ready (single-Property import only); the Goals page empty state "Set your Google rating goal"; one item in the setup strip.
- **Step 1, "Pick your goal"**: headline "Google shows 4.3 from 812 reviews"; the slider preselected on the Realistic stop with its chip; one live line, "About 93 more reviews"; a "How we work this out" disclosure.
- **Step 2, "Pick your pace"**: Steady / Faster (preselected) / Push cards with the weekly number and the forecast; per month and per day only on the selected card; "type your own number" (whole numbers 1–200; above 2× the current pace shows a surge caution).
- **Done, "Your goal is set"**: a summary, one next step (Create a Portal, or Set portal goals once Portals exist) and "Go to Goals".
- A dialog on desktop, full screen on phones, inside the setup frame at import.
- **Not eligible**: fewer than 10 Google reviews ("Rating goals start at 10 Google reviews. You have 6." and a Portals link). No higher tenth possible or reachable: Keep is offered first.

## Tracking

- **Simple card** (Goals page and Property Overview): "Google shows 4.3 → your goal 4.5", a progress bar, one pace line ("Aim for about 11 new reviews a week" when just set, "This week: 6 of 11 reviews" after), the forecast ("Expected around Apr 2027 – Apr 2028"), "View details".
- **Detail page** (`/properties/$propertyId/goals/google-rating`): weekly bars against the pace line, the star mix since the goal was set, still needed and the best case, the next tenth, the last four weeks, the change log and freshness. Both forecasts (chosen and actual pace).
- **Properties list**: a "Google goal" column, "4.5 · On pace" or "Set goal".
- **Headline ratings everywhere** (Overview tile, Properties list, goal) show Google's own number and count. The Ratings page keeps its period averages.
- **Goals page order**: the Google card, then Portal goals as a separate list with no shared numbers.

## Lifecycle and change log

- Recomputed daily and whenever Review verifies Google's numbers; the chosen pace stays until changed.
- Target, pace and mode can be changed at any time. Each change is logged with who, when, old and new value, and no reason.
- Reached: the date is recorded, the goal moves to History, and the next tenth is offered (preselected) or "Keep 4.5".
- Ends: by a manager at any time; "Ended: Google location changed" when the location is relinked to another place; when the Property is archived. A new goal can then be set.

## Notices

Change-only, in the Goals category (bell and daily digest), to the Property's responsible managers, AccountAdmins as fallback:

1. reached, with "Set your next goal";
2. Google gained or lost a tenth;
3. entered Below pace (at most once every two weeks);
4. entered Can't reach at this mix;
5. a keep goal dropped below.

No weekly summary for now. PR 5 amends ADR 0046 for them.

### PR 5, as built

- **Who.** The Property's responsible managers, AccountAdmins when nobody is responsible (the resolver Goal notices use); never staff. Delivery asks again who is responsible.
- **Where.** The Goals category (`recognition` in the model, in name only: change notices about a Property figure, not workforce recognition), so the bell and the daily digest, with the existing per-channel Goals settings and no new setting. Every notice opens the Property's Goals page.
- **When.** Change only, against what the goal last stored: the tenth Google showed, and the last status that was not "Waiting for Google" (`last_known_status`, migration 0057). Reached replaces the tenth gained; a keep goal's drop replaces the tenth lost; an ended goal tells nobody; the status a goal is set in, or that a manager's change of plan puts it in, is stored without a notice. Below pace at most once in 14 days per goal (`below_pace_noticed_at`).
- **Once.** The evaluation that stores the change writes one `goal.rating_goal.transitioned` fact per notice in the same transaction, compare-and-set on what it read, so a page read, the snapshot consumer and a repeated or late fact never tell the same change twice. The Feed consumer queues one notice per recipient under `${eventId}-${recipient}` and records its receipt after.
- **Daily.** `rating-goal.evaluate` (02:00 UTC, `goal.use`, tenant-cross with a scope authorizer per goal) evaluates every active goal, because Below pace moves with the calendar, not with a new Google fact.
- **Copy** (sentence case; "review" means a Google review):

| Notice                  | Title                                                                      | Body                                                                                                               | Action        |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------- |
| Reached                 | Google now shows 4.5 for Riverside Hotel: goal reached                     | Set your next goal, or keep 4.5.                                                                                   | Set next goal |
| Tenth gained or lost    | Google now shows 4.4 for Riverside Hotel, up from 4.3 (or "down from 4.5") | Your goal is 4.5. (a keep goal: "You’re keeping 4.5.")                                                             | View goal     |
| Below pace              | Riverside Hotel is below its Google review pace                            | 6 new reviews a week over the last 4 weeks; the goal’s pace is 11 a week. ("since the goal was set" before day 28) | View goal     |
| Can't reach at this mix | Riverside Hotel’s Google goal can’t be reached at the recent mix           | Recent reviews average 4.40 stars; to reach 4.5, new reviews need to average above 4.45.                           | View goal     |
| Keep dropped below      | Google now shows 4.4 for Riverside Hotel, below the 4.5 you’re keeping     | Open the goal to see what it takes to get back.                                                                    | View goal     |

"Set your next goal" became "Set next goal": an action label is at most three words. The recent pace is rounded down to a tenth and the recent average down to a hundredth, so neither reads as meeting the mark it misses.

## Access

AccountAdmins and PropertyManagers with access to the Property, under `goal.read`, `goal.create`, `goal.update` and `goal.cancel` and the capability `goal.use`, through the same execution policy as the Goal Program server functions. `goal.use` is one switch shared with the Goal Programs (open question 8). Members never. The guardrails are in ADR 0067.

## Edge cases

1. Fewer than 10 Google reviews: no rating goal ("Rating goals start at 10 Google reviews. You have 6." and a Portals link).
2. No higher tenth possible, or none reachable at the recent mix: Keep is offered.
3. A pace below 1 a week: the cards offer at least Steady 1, Faster 2, Push 3.
4. Google disconnected, numbers older than 24 hours, or Google's review sync failing: "Waiting for Google", numbers shown "as of".
5. The location relinked to another place, or the Property archived: the goal ends ("Ended: Google location changed") and a new one is invited.
6. Google removes reviews or a guest changes stars: the daily recompute takes it in; a lost tenth sends a notice.
7. The rounding rule: verified on beta data where possible; the exact average comes from the cache when Google's figure is not exact.

## Data and storage

- Google's own numbers: the Current on Google snapshot (Reporting), as Review publishes it after a verified run, refreshed every 15 minutes to 6 hours.
- The cache: read only through Review's public API, as counts and star sums of reviews that may be served and were observed under the Property's current Google binding; reviews per Monday-to-Sunday week in the Property's time zone; stars since an instant. No review content leaves Review.
- Stored: the goal (mode, target, pace, state, binding epoch, baselines, the tenth and status last seen, reached or ended date and reason, a version for compare-and-set) and its change log. Exported and purged with the Organization's Goal records.

## Pull requests

| PR  | Content                                                                                                                                                                                                                                                                                                                                                                                                                                  | Visible     | Waits for                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | This plan, ADR 0067, notes in ADRs 0031, 0041 and 0049, `docs/BETA.md`, the Reporting and root CONTEXT, Google Access Disclosure 2.1 and Participation Agreement 2.1                                                                                                                                                                                                                                                                     | legal pages | the owner's OK on the exact wording                                                                                                                                                                                          |
| 2   | Engine: migration 0056 (`property_rating_goals`, `property_rating_goal_changes`), the pure maths test-first, Review's read port (four-week pace, 90-day mix, weekly counts, stars), Google's number, server functions, the evaluation consumer, a read-only beta rounding check, and the `goal.use` explanation in `capability-fate.ts` (it names the rating goal, with any test that pins the string; the fate stays `controlled_beta`) | no          | —                                                                                                                                                                                                                            |
| 3   | Wizard, Goals card and detail page; a new Slider primitive                                                                                                                                                                                                                                                                                                                                                                               | yes         | PR 1 live, PR 2, and the release owner's recheck of Google's current review and Business Profile API policies against the goal (the disclosure's change control), with its "last refreshed" date updated if anything changed |
| 4   | Overview tile, Google's number everywhere, the Properties list column, the setup strip item, the import's last step                                                                                                                                                                                                                                                                                                                      | yes         | PR 3                                                                                                                                                                                                                         |
| 5   | The five notices and the ADR 0046 amendment; migration 0057 and the daily evaluation (`rating-goal.evaluate`)                                                                                                                                                                                                                                                                                                                            | yes         | PR 2, PR 3                                                                                                                                                                                                                   |
| 6   | Portal goal fixes: live progress on Goals list rows, a real "behind pace" (parallel lane)                                                                                                                                                                                                                                                                                                                                                | yes         | — (no Google data)                                                                                                                                                                                                           |

- The order decided is 1 → 2 → 3 → 4 → 5, with 6 in parallel; "Waits for" is the hard dependency.
- PR 1 is published when web deploys it: the legal pages render the documents in `docs/legal/` at build time (`/privacy/google-access-disclosure`, `/privacy/beta-agreement`). "Live" means merged and deployed on web.
- Each PR is auto-merged and deployed under the standing rule, except PR 1, which waits for the owner's OK on the wording.
- PR 2 is additive (two new tables); web runs the migration before it serves. Recovery is forward-only (ADR 0038).
- UI stays out of first paint: the new routes are split, DTO types are type-only, and the bundle budget is measured, never raised without a dated note.
- About 12 agents in all: one builder and one reviewer per PR, at most two lanes at once.

## Docs amended in PR 1

- `docs/adr/0067-property-google-rating-goal.md` (new) and `docs/adr/README.md`.
- Dated notes: ADR 0031 (review-derived staff goals), ADR 0041 (Google facts and Goals), ADR 0049 (rule 2).
- `docs/BETA.md`: §3 (the goal and its guardrails), §2 (the 2.1 documents), §10 (the decision), and the line references into the agreement.
- `src/contexts/reporting/CONTEXT.md` (core model entry, invariant 10) and `CONTEXT.md` (the Reporting row, the ADR table).
- `docs/legal/google-access-disclosure.md` 2.1 (a "Property Google rating goal" subsection under "How Google data is used", and the goal's limits under "Uses the product does not allow") and `docs/legal/internal-beta-agreement.md` 2.1 (§2.2 and §6, the acceptance package, and the version of the Privacy Notice that §2.1, §9 and §12 name), each with a closing Changes section, effective on publication, 2026-10-14.
- Not changed: `docs/legal/privacy-notice.md` stays 2.2 (the goal processes no new class of personal data, and the Goal Programs its purposes name keep their three measures); `gbp.review_solicitation_gamification` keeps its fate and its explanation, which the goal does not contradict.

## Proposed copy

"Review" means a Google review only; Portals collect "private ratings". Sentence case.

- "Google shows 4.3 from 812 reviews" · "About 93 more reviews" · "How we work this out"
- "Pick your goal" · "Pick your pace" · "Steady" / "Faster" / "Push" · "type your own number" · "Your goal is set" · "Go to Goals"
- "Google shows 4.3 → your goal 4.5" · "Aim for about 11 new reviews a week" · "This week: 6 of 11 reviews" · "Expected around Apr 2027 – Apr 2028" · "View details"
- "4.38 of 4.45" · "Google should show 4.5 soon" · "if every new review is 5★: 207, about 4 months"
- "Rating goals start at 10 Google reviews. You have 6." · "Ended: Google location changed" · "Set your Google rating goal" · "Set your next goal" · "Keep 4.5"
- 5.0 disabled: "needs every review from now on to be 5★"

## Defaults taken (owner may object)

From the grilling:

- Weeks run Monday to Sunday in the Property's time zone; "this week" is the current partial week.
- Custom pace: whole numbers 1–200 a week; above 2× the current pace shows a surge caution.
- 5.0 is disabled with the reason "needs every review from now on to be 5★".
- Detail route `/properties/$propertyId/goals/google-rating`; Goals page order: the Google card, then Portal goals.
- Forecast range: the months spanned by the mix ± 0.1★ and the pace ± 10%.
- Migration 0056; ADR 0067.

Taken while writing this plan:

- Reviews needed is a ceiling, so 4.6 in the worked example needs 1,300, not 1,299.
- When the cache does not hold every review Google counts, the plan uses Google's rounded figure and says the numbers are approximate.
- The 2.1 documents take effect on publication, 2026-10-14, and say they are not a material change.
- The agreement adds no Participant duty. Its §6 says the Service does not use the goal as a staff quota, ranking, incentive or employment input; the existing §6 last paragraph and §7(5) already bind Participants on staff use. That keeps version 2.1 non-material (open question 2).
- Agreement 2.1 names Privacy Notice version 2.2 (effective 2026-10-13) in §2.1, §9 and §12, where 2.0 named version 2.0, and says so in its §13 as a correction (open question 4).

## Open questions

1. **The exact legal wording and its date.** The owner approves both version 2.1 texts and the effective date. If PR 1 is published on another day, the date moves in both headers and front matters, both Changes sections, the agreement's §12 and `docs/BETA.md` §2 and §10.
2. **Material or not?** The Privacy Notice's 14-day rule, which the agreement incorporates, applies to material changes. Default: not material (an optional function, no new data class, retention, provider, Guest change or Participant duty). If the owner judges it material, the effective date moves to 14 days after the email announcement and PR 3 waits for it. If the owner also wants an explicit Participant duty not to use the goal as a staff quota, ranking, incentive or employment input, it belongs in §7 and makes version 2.1 material.
3. **Privacy Notice 2.3?** Default: no.
4. **Which Privacy Notice the agreement names.** Version 2.0 of the agreement named Privacy Notice version 2.0 in §2.1, §9 and §12 while the notice is at 2.2. Default: agreement 2.1 names version 2.2, effective 2026-10-13, and says so in §13 as a correction. Alternative: name the notice without a version ("the Privacy Notice in force at `/privacy`"), which stops the reference going stale again.
5. **Forecast width.** At ± 0.1★ the range for 4.5 in the worked example spans 13 months. Default: as decided; narrow the mix drift if the ranges read as useless.
6. **ADR 0049 rule 2** also names scan and private-response facts, which the three Portal Goal measures use under `docs/BETA.md` §3. That predates this plan. Default: left as it is.
7. **Rounding of the paces.** Steady, Faster and Push round half up, so 1.5 × 7 = 10.5 gives 11 a week. The owner's example copy used 10 ("Aim for about 10 new reviews a week", best case "207, ~5 months"). Default: half up (11, best case about 4 months). Alternative: the owner's figures, which round the tie down.
8. **One switch or two.** The rating goal is offered under `goal.use`, so the emergency switch also switches Portal Goal Programs off and the other way round. Default: shared (ADR 0067). Alternative: a separate capability for the rating goal, with its own fate row, so the two switch apart.
9. **A star average in notification storage (PR 5).** The Can't reach notice states the recent average stars of new Google reviews ("Recent reviews average 4.40 stars; to reach 4.5, new reviews need to average above 4.45"), so the event and the notification payload carry it as `ratingMixHundredths`. The ADR 0046 amendment of 2026-09-30 says notification rows carry no star count; the 2026-10-14 amendment narrows that to a review's own rating. Default: narrowed, as decided in the notices spec. Alternative: drop the average from the payload and the Can't reach body (the body then names only the target). The other four notices state only the tenth Google shows, the target and the pace.
