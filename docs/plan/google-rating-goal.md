# Property Google rating goal: plan

Date: 2026-10-14. Status: owner-approved decisions (17), being built in six pull requests. Written from the owner grilling of 2026-10-14 against `origin/main` at `78f4d0b80`. The decision record is [ADR 0067](../adr/0067-property-google-rating-goal.md). Paths are relative to the repository root.

**Amended 2026-10-16 (rounds 3 and 4, the one-screen setup).** Pick a plan gives way to one screen opened already answered: a recommended goal, a proactive pace a day and an automatic planned average. See [Rounds 3 and 4](#rounds-3-and-4-the-one-screen-setup-2026-10-16); where round 2 disagrees, rounds 3 and 4 win.

**Amended 2026-10-15 (round 2, planned review quality).** A plan now also assumes the average stars of new Google reviews, a manager picks one of three complete plans (or builds one), and "New reviews too low" replaces "Can't reach at this mix". See [Round 2](#round-2-planned-review-quality-2026-10-15); where an earlier section disagrees, round 2 wins, and the sections it changes say so.

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
- **Paces**: Steady = max(1, round(p)), Faster = max(2, round(1.5p)), Push = max(3, round(2p)), with p the current pace and rounding half up (open question 7); each at least one above the one before. Per month = round(w × 52 / 12); per day = w / 7 to one decimal. (Amended 2026-10-16, rounds 3 and 4: a goal stores its pace in tenths of a review a week, 10 to 3500, so a pace a day or a month round-trips: 1.5 a day is 105. "Pick a plan" still offers whole paces a week and sends them × 10; on pace is reviews in the window ≥ 90% × tenths / 10 × weeks, compared exactly.)
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

The first that holds wins. (Amended 2026-10-15: "New reviews too low" replaces "Can't reach at this mix", which judged the recent mix; see Round 2.)

| Status              | When                                                                                                  | Tone                        |
| ------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| Waiting for Google  | no Google numbers, numbers older than 24 hours, or Google disconnected                                | neutral; numbers "as of"    |
| Reached             | Google shows the target                                                                               | celebrate; moves to History |
| New reviews too low | at least 10 Google reviews since the goal was set, averaging at or below the target's threshold       | amber                       |
| Getting started     | the first 14 days                                                                                     | neutral                     |
| On pace             | reviews in the last 28 days (since the goal was set, before day 28) at 90% of the chosen pace or more | green                       |
| Below pace          | otherwise                                                                                             | amber                       |

A keep goal is Holding while Google shows the kept tenth and Dropped below when it does not; it waits for Google the same way.

## Setting a goal

Amended 2026-10-15: the two steps below (a slider, then a pace) are replaced by one step, "Pick a plan" (Round 2). The doors, the done screen and the not-eligible cases stay.

- **Doors**: the last, skippable step of Property setup when Google's numbers are ready (single-Property import only); the Goals page empty state "Set your Google rating goal"; one item in the setup strip. The setup strip's item and the Properties list's "Set goal" open the Goals page with `?start=rating-goal`, and the wizard opens on arrival (PR 4). The Overview's one-line prompt opens it in place, and says nothing once a manager chose "Not now" (PR 4, orchestrator call). The setup step counts as decided once a goal was set (active, reached, or ended by a manager) or "Not now" was chosen; a goal ended by a Google location change or an archive does not decide it.
- **Step 1, "Pick your goal"**: headline "Google shows 4.3 from 812 reviews"; the slider preselected on the Realistic stop with its chip; one live line, "About 93 more reviews"; a "How we work this out" disclosure.
- **Step 2, "Pick your pace"**: Steady / Faster (preselected) / Push cards with the weekly number and the forecast; per month and per day only on the selected card; "type your own number" (whole numbers 1–200; above 2× the current pace shows a surge caution).
- **Done, "Your goal is set"**: a summary, one next step (Create a Portal, or Set portal goals once Portals exist) and "Go to Goals".
- A dialog on desktop, full screen on phones, inside the setup frame at import.
- **Not eligible**: fewer than 10 Google reviews ("Rating goals start at 10 Google reviews. You have 6." and a Portals link). No higher tenth possible or reachable: Keep is offered first.

## Tracking

- **Simple card** (Goals page and Property Overview): "Google shows 4.3 → your goal 4.5", a progress bar, one pace line ("Aim for about 11 new reviews a week" when just set, "This week: 6 of 11 reviews" after), the forecast ("Expected around Apr 2027 – Apr 2028"), "View details". (Amended 2026-10-15: while new reviews are too low the chip names the target, "New reviews too low for 4.5".)
- **Detail page** (`/properties/$propertyId/goals/google-rating`): "Your plan" against what happened since it was set (amended 2026-10-15, round 2), weekly bars against the pace line, the star mix since the goal was set, still needed and the best case, the next tenth, the last four weeks, the change log and freshness. Both forecasts (chosen and actual pace).
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
4. entered New reviews too low (at most once every two weeks, like Below pace, and with no star figure; it replaced "entered Can't reach at this mix" on 2026-10-15, see Round 2);
5. a keep goal dropped below.

No weekly summary for now. PR 5 amends ADR 0046 for them.

### PR 5, as built

- **Who.** The Property's responsible managers, AccountAdmins when nobody is responsible (the resolver Goal notices use); never staff. Delivery asks again who is responsible.
- **Where.** The Goals category (`recognition` in the model, in name only: change notices about a Property figure, not workforce recognition), so the bell and the daily digest, with the existing per-channel Goals settings and no new setting. Every notice opens the Property's Goals page.
- **When.** Change only, against what the goal last stored: the tenth Google showed, and the last status that was not "Waiting for Google" (`last_known_status`, migration 0057). Reached replaces the tenth gained; a keep goal's drop replaces the tenth lost; an ended goal tells nobody; the status a goal is set in, or that a manager's change of plan puts it in, is stored without a notice. Below pace at most once in 14 days per goal (`below_pace_noticed_at`), and Can't reach likewise (`cant_reach_noticed_at`, also migration 0057), because a mix that hovers near the threshold would otherwise tell the managers each time it crosses.
- **Once.** The evaluation that stores the change writes one `goal.rating_goal.transitioned` fact per notice in the same transaction, compare-and-set on what it read, so a page read, the snapshot consumer and a repeated or late fact never tell the same change twice. The Feed consumer queues one notice per recipient under `${eventId}-${recipient}` and records its receipt after.
- **Daily.** `rating-goal.evaluate` (02:00 UTC, `goal.use`, tenant-cross with a scope authorizer per goal) evaluates every active goal, because Below pace moves with the calendar, not with a new Google fact.
- **Copy** (sentence case; "review" means a Google review):

| Notice               | Title                                                                      | Body                                                                                                               | Action        |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------- |
| Reached              | Google now shows 4.5 for Riverside Hotel: goal reached                     | Set your next goal. (At 4.9 or 5.0: "Set your next goal, or keep 4.9.")                                            | Set next goal |
| Tenth gained or lost | Google now shows 4.4 for Riverside Hotel, up from 4.3 (or "down from 4.5") | Your goal is 4.5. (a keep goal: "You’re keeping 4.5.")                                                             | View goal     |
| Below pace           | Riverside Hotel is below its Google review pace                            | 6 new reviews a week over the last 4 weeks; the goal’s pace is 11 a week. ("since the goal was set" before day 28) | View goal     |
| New reviews too low  | New Google reviews for Riverside Hotel are too low for 4.5                 | Since you set the goal they average below what 4.5 needs. Open the goal to see what helps.                         | View goal     |
| Keep dropped below   | Google now shows 4.4 for Riverside Hotel, below the 4.5 you’re keeping     | Open the goal to see what it takes to get back.                                                                    | View goal     |

"Set your next goal" became "Set next goal": an action label is at most three words. The recent pace is rounded down to a tenth, so it never reads as meeting the pace it misses. The Can't reach notice states no number of stars: the recent average is not in the event or the notification payload (open question 9).

Amended 2026-10-15 (round 2): the Can't reach notice (`goal.rating_cant_reach`, transition `entered_cant_reach`) is retired, and the table's fourth row is its replacement, New reviews too low (`goal.rating_too_low`, transition `entered_reviews_too_low`), with the same limit of once in 14 days (kept in `cant_reach_noticed_at`), the same recipients and category, and no star figure. Amended again the same day (review fixes): the Reached body offers to keep the number only when Google shows 4.9 or 5.0 (R2-9), so below that it is "Set your next goal." (open question 10).

## Round 2: planned review quality (2026-10-15)

The owner grilled the beta Property that shows 3.9 from 261 reviews (exact 1,021 / 261 = 3.9119): its last 25 reviews average 3.92, under 4.0's threshold of 3.95, so the goal told it a higher number was not reachable "at your recent star mix" and offered Keep. Properties with weak ratings can raise their mix on purpose, so the plan now says what quality it assumes and lets the manager choose it. Decisions R2-1 to R2-12 are in `~/kodes/google-rating-goal/DECISIONS.md`; R2-6 supersedes R2-2 and the round-1 slider. As built in the engine (PR "rating goal plans"):

- **Planned quality q**: the average stars a plan assumes new Google reviews bring, a tenth of a star, stored on a climb goal (`quality_tenths`, migration 0059) and part of its version-checked plan; a keep goal has none. Reviews needed = ⌈N(θ − E) / (q − θ)⌉, the forecast's mix is q (± 0.1★, pace ± 10%, as before).
- **Floor**: q must clear the target's threshold by 0.15★, as a tenth: q ≥ T + 0.1 (4.0 needs 4.1 or more). Near the threshold the count explodes (4.5★ against 4.45 asks about five times what 4.7★ does). The database holds only q ≥ T (above θ) and q ≤ 5.0; the 0.15★ floor is the domain's rule.
- **Evidence anchors** (never arithmetic offsets): "Like now" (the recent mix as a tenth, half up), "Like your best year" (the best calendar year in the Property's time zone with at least 10 reviews, highest exact average, the later year on a tie; Review's new `getYearlyTotals` read, counts and star sums only), "A step above what {T} needs" (θ + 0.3 rounded up to a tenth, at most 5.0; it always clears the floor), "Excellent" (4.8). Anchors under the floor are dropped; two on one tenth keep the earlier of like now, best year, step above, Excellent.
- **Recommended quality of a target** (R2-3): like now if it clears the floor, else the best year if it does, else a step above. The quality options are the recommendation between its nearest anchors below and above, or two from one side when the other has none (at most three).
- **Stops** (R2-4): every tenth from the next one to 4.9 is worked out at its own recommended quality and labelled at the Faster pace (Realistic ≤ 26 weeks, Stretch ≤ 52, Out of reach beyond). No stop is unreachable any more.
- **Recommended target**: the highest Realistic stop at most three tenths up, else the next tenth. **Target row** of Build your own (R2-9): the next tenth and the two above when that is the recommendation, otherwise one below, the recommendation and one above, never above 4.9.
- **Plans** (R2-7): one shared quality, the recommended target's recommended quality. Cautious = the recommended target at Steady; Recommended = the same at Faster (preselected); Ambitious = the highest row target the shared quality clears by 0.15★ whose forecast at Push is within 52 weeks (R2-13, below), or the recommended target at Push when none above it qualifies. Each plan carries its target, quality, pace per week, month and day, reviews needed, best case and forecast. The engine can work the three out again at another shared quality (`ratingGoalPlansAt`); the screens do not (see "Pick a plan, as built" below): "Change" opens Build your own on its quality row.
  - Amended 2026-10-15 (owner, R2-13; amends R2-9): Ambitious stays within a year. It is the highest target of the row that the shared quality reaches (at least 0.15★ above its threshold) and that Push gets to within 52 weeks, the plan's own reach (`stopLabel`, so Realistic or Stretch); if no row target above the recommended one qualifies it is the recommended target at Push. Targets past a year stay in Build your own, which labels them and says "More than a year".
- **Build your own**: any target, quality and pace, worked out on the page from the setup read's exact inputs (`previewRatingGoalPlan`), with the same rules the commands apply: target from the next tenth to 4.9, quality from the floor to 5.0 in tenths, pace 1 to 200 whole a week.
- **Keep** (R2-9): offered only when Google shows 4.9 or 5.0, in place of plans.
- **Tracking** (R2-5, R2-11): until 10 Google reviews arrived since the goal was set there is no verdict on their stars, and the goal's numbers (forecast, still needed, next tenth) assume the planned quality; from the tenth on they assume those reviews' average. The status is New reviews too low when that average is at or below the target's threshold, where Can't reach stood. Trailing the plan's quality is a line on the detail page ("New reviews average 4.2★ · plan 4.5★"), not a status and not a notice. The detail read adds "Your plan": the target and the tenth Google shows, the planned quality and the reviews since the set (count, and their average after 10), the chosen pace and the last four weeks', and the forecast at those so-far values.
- **Notice** (R2-10): `goal.rating_too_low` replaces `goal.rating_cant_reach` (no row of the old type exists): when a goal enters New reviews too low, at most once in 14 days, to the same recipients in the same Goals category. Title "New Google reviews for {Property} are too low for {T}", body "Since you set the goal they average below what {T} needs. Open the goal to see what helps." No star figures. The 14-day mark is stored in the column the retired notice used (`cant_reach_noticed_at`, kept under its name so the release running while web migrates keeps working).
- **Change log**: a new field, quality (tenths as text; NULL when a goal switches to keep).
- **Policy line** under the plans (R2-12, approved verbatim): "Your Portals offer every guest the same Google review link. Asking every guest, not only the ones who would write anyway, and better stays are what move this number."

Worked example (the beta Property, 2026-10-15; about one review in 28 days, so 1 / 2 / 3 a week): the recent mix 3.9 is under 4.0's floor of 4.1 and drops; the best year, 2024 (26 reviews, 4.46), is 4.5; a step above 4.0 is 4.3. Options 4.3 · 4.5 (recommended) · 4.8. 4.0 at 4.5★: ⌈261 × (3.95 − 3.9119) / (4.5 − 3.95)⌉ = 19 reviews, Realistic at 2 a week, so the plans open on 4.0: Cautious 4.0 at 1 a week (Jan – Apr 2027), Recommended 4.0 at 2 a week (Dec 2026 – Jan 2027), Ambitious 4.1 at 3 a week (81 reviews, 27 weeks, Mar – Jul 2027; 4.2 would take 178, 59 weeks, so it stays in Build your own). Target row 4.0 (Realistic) · 4.1 (Stretch, 81) · 4.2 (Out of reach, 178). The healthy property (812 reviews at 4.31, a 4.70 mix, 7 a week, Push 14) opens on 4.4: Ambitious 4.5 at 14 a week (454 reviews, 33 weeks, Mar – Dec 2027); 4.6 clears the margin too but takes 1,298 reviews, 93 weeks.

### Pick a plan, as built (screens, 2026-10-15)

- **One step.** The wizard is "Pick a plan" (title), then "Your goal is set" (unchanged: a summary and one next step). The description under the title is "Google shows 3.9 from 261 reviews." Then the shared quality line, "Plans assume new reviews average 4.5★, like your best year (2024) · Change" (like now reads "like your recent reviews"; a step above reads "a step above what 4.0 needs"); the three plans as radio cards (Cautious, Recommended preselected, Ambitious), each "4.0 on Google", "2 a week · new reviews 4.5★ · 19 reviews" and the forecast ("Around Dec 2026 – Jan 2027"), no Realistic/Stretch label, but "More than a year" (amber) on a plan out of reach at its own pace (the plan's `reach`; not when its forecast already reads "More than ten years away"; Ambitious stays within a year, so it is rare on the cards; open question 12); the policy line (R2-12, verbatim); and "Build your own", folded. Each radio is named by its plan and number ("Recommended 4.0 on Google") and described by the rest. A dialog on desktop, a full-screen sheet on phones, inside the setup frame at import ("Not now"). The dialog opens with the focus on the checked plan; "· Change" is a link in the quality line, kept with its dot.
- **Build your own** is a disclosure under the plans. While it is open it is the plan "Set goal" sets, and no plan card is checked; closing it makes the card it was opened from the plan again; picking a card closes it. It opens on the plan picked and then keeps what was built in it. Three rows, each a radio group named by its label: "Goal on Google" (the target row, each option with its label chip, Recommended marked; Own is the slider of tenths, with the goal picked shown large above it with its label, "4.3 on Google · Out of reach", 5.0 shown and never chosen), "New reviews will average" ("For 4.0 on Google, new reviews need to average above 3.95★. Your last 25 averaged 3.92★."; the evidence anchors for the row's target, each with its cost, "about 19 reviews"; Own is a number in 0.1★ steps held to the floor: "For 4.0, pick 4.1★ or more: any nearer 3.95★ and the reviews needed climb very fast.") and "New reviews a week" (Steady, Faster recommended, Push; Own is a whole number 1 to 200, with the surge caution above twice the pace now). Under them the live total, "19 more reviews · around Dec 2026 – Jan 2027", from `previewRatingGoalPlan`, with "More than a year" beside it when the plan built is out of reach at its pace; while a number cannot be set it names the row to fix ("Fix the average marked above to see what this plan takes."), in a polite live region. Picking another goal keeps an average the new goal also offers and moves one it does not to its recommendation; an average typed as Own stays as typed. An option's chips wrap inside the card. A forecast breaks a line only between the two ends of its range.
- **"Change"** on the quality line opens Build your own and puts the focus on the quality row's checked option. The three plans keep the shared quality: a different quality is a plan of one's own, so the first screen never changes under the manager (owner principle: setup screens stay simple). `ratingGoalPlansAt` stays in the engine, unused by the screens.
- **A change** ("Change plan" on the detail page; "Aim for a higher number" for a keep goal) opens Pick a plan with the goal's own plan as a fourth card, "Your plan", first and checked, and Build your own prefilled from it. It sends only what differs, against the version it opened on; nothing differing disables "Save changes" with "Change the plan to save.", in the pinned footer beside the button it describes. A keep goal has no "Your plan".
- **Keep first** only when Google shows 4.9 or 5.0, everywhere: the Goals page empty state, the Overview prompt, the setup strip's arrival and the import's last step open Pick a plan otherwise. The round-1 sentence "A higher number isn't reachable at your recent star mix, so the goal is to keep it." is gone.
- **"Set your next goal"** after a goal is reached opens Pick a plan, whose recommended target is the next tenth or a realistic one up to three tenths higher; the round-1 next-tenth preselection is gone. Below 4.9 it is the reached news's one next step; at 4.9 the one step is "Keep 4.9" (open question 10). A goal to keep can then only be ended, which the done screen says.
- **Dropped from round 1**: the slider step, the pace step and "How we work this out".
- **Card**: unchanged but for "New reviews too low": the chip reads "New reviews too low for 4.0" (amber) on the card and the detail page's header (the Properties list keeps "New reviews too low" under the target it already prints), and the outlook is "Since you set the goal, new reviews average below what 4.0 needs."
- **Detail page**: "Your plan" sits above the forecasts: "Google shows 3.9 · goal 4.0"; "New reviews average 4.61★ · plan 4.7★" (two decimals, so an average at the threshold never reads as the target's tenth; "after 10 reviews · plan 4.5★" until ten have arrived, with the count since the set as a note); "Pace, last 4 weeks 9.5 a week · plan 11 a week" (the plan per month and day as a note). The round-1 pace line goes when the plan is there. While new reviews are too low the warning adds the policy line as what helps. Where a count is not reachable the page says "at the new reviews' average" (or "at your plan's 4.5★" before ten reviews), no longer "at the recent star mix", and so does a forecast no pace reaches ("No pace reaches 4.0 at the new reviews' average", seen while the goal waits for Google). The change log reads a quality change as "New reviews average 4.5★ → 4.7★". The refusal of a quality under the floor reads "That average is too close to what the goal needs. Pick a higher one, or close this and open it again."; "Nothing has changed. Pick another plan, or cancel." The "Your plan" Goal row repeats the header's two numbers, as R2-11 specifies it.

Defaults taken while building the engine (owner may object):

- The best year is a calendar year in the Property's time zone, the current year to date included, rather than a rolling 12 months: it gives the owner's copy its label ("like your best year (2024)").
- Anchors round half up to a tenth (4.46 is 4.5), and the floor is judged on that tenth.
- With more than one anchor on a side of the recommendation, the nearest is offered.
- A migrated climb goal (none exists on the beta) gets a step above what its target needs as its planned quality.
- A stored "Can't reach at this mix" status is cleared, not translated; the next evaluation writes the status.

## Rounds 3 and 4: the one-screen setup (2026-10-16)

The owner found the model underestimated proactive asking (round 3) and asked for suggested targets that never make a manager set the new reviews' average (round 4). Decisions R3-1 to R3-12 and R4-1 to R4-5 are in `~/kodes/google-rating-goal/DECISIONS.md`; the build plan is `PLAN-R4.md` beside it. The approved mocks are E2 (desktop) and E4 (phone). As built (PR "goals r4 setup"):

- **One screen, opened answered.** "Your Google goal", the Property named under it. The goal is the hero number (a spinbutton between − and +, its digits rolling a step), a rating ruler from four tenths below today to 5.0, then "in about 3 months" (amber past six months), "81 new reviews at 1 a day · likely 9 weeks to 4 months", and the status line. Under it "The plan behind the number": the pace and the planned average. "Aim for 4.1" sets it ("Save changes" on a change); Cancel (or "Not now" at import) beside it. "We count new Google reviews every week, Monday to Sunday." (desktop only), "How we worked this out" and "Why every guest" open two explanations.
- **Pace** (R3-1, R3-3): "New reviews", a day or a month, on stops with "Recommended" under one; the note against today ("About 30 a month, up from about 2 a month now."); "Your own" in either unit (0.2 to 50 a day, clamped with its reason); how to ask (R3-12, verbatim). The proven pace is the busier of the last 90 days and the busiest 30 days of the last year; the recommendation is the nice pace nearest 1.5 times it, at least 1 a day. Quiet: a few a week, 1, 2, 3, 5 a day. Busy: the busiest month, the recommendation and three above.
- **Planned average** (R4-1, R4-3): "New reviews planned at 4.5★, your best year, 2024" (or best month, or "halfway between your 3.9 and 5"), with "Change" for a typed one from two tenths above the shown number to 5.0. The real average takes over after ten new reviews, as before (R2-5).
- **Recommended goal** (R4-4): the highest within six months even at 0.1★ below plan, at least the next tenth; the status names the next one up ("Recommended · 4.2 possible in about 6 months"). − / + pin another goal ("Back to 4.1, recommended"); at the ends they say why once ("4.5 needs new reviews above 4.5 stars, more than planned", "4.0 is the lowest goal, one step up from 3.9"). Past six months the status offers a faster pace ("At 2 a day, about 6 months"), which keeps the goal it names.
- **Keep first from 4.7** (owner, X1): the setup opens on Keep and says why ("4.8 needs new reviews averaging 4.9★ or more, so we suggest keeping 4.7."), with "Raise it anyway" into the climb at a typed average. Keep only at 4.9 and 5.0.
- **Tracking reads per day** (R3-7): "Aim for about 2 new reviews a day", "This week: 9 of 14 reviews", "At your chosen pace, 2 a day", "Pace 2 → 1.5 a day" in the change log, and the Below pace notice per day. The card's and detail's forecasts stay month ranges; the done screen repeats the setup's words.
- **Retired**: Pick a plan, its three plans, Build your own, the quality anchors, Steady / Faster / Push, the surge caution, the Realistic / Stretch labels and the 5.0 stop.

Golden scenarios (pinned in tests): Harborline Suites (3.9 from 261, 2024 at 4.46) → 4.1 at 1 a day, 81 reviews, about 3 months, likely 9 weeks to 4 months; Olive Tree B&B (4.2 from 60) → 4.4, 40, about 6 weeks, 4 weeks to 2 months; Seaview Hotel (4.2 from 640, August at 4.73) → 4.4 at 2 a day, 220, about 4 months, 3–6 months; Tavola (4.5 from 2,100, May at 4.80) → 4.6 at 7 a day, 252, about 5 weeks, 3–10 weeks.

## Access

AccountAdmins and PropertyManagers with access to the Property, under `goal.read`, `goal.create`, `goal.update` and `goal.cancel` and the capability `goal.use`, through the same execution policy as the Goal Program server functions. `goal.use` is one switch shared with the Goal Programs (open question 8). Members never. The guardrails are in ADR 0067.

## Edge cases

1. Fewer than 10 Google reviews: no rating goal ("Rating goals start at 10 Google reviews. You have 6." and a Portals link).
2. No higher tenth possible: Keep is offered. (Amended 2026-10-15, round 2: only when Google shows 4.9 or 5.0; a low rating is offered plans.)
3. A pace below 1 a week: the cards offer at least Steady 1, Faster 2, Push 3.
4. Google disconnected, numbers older than 24 hours, or Google's review sync failing: "Waiting for Google", numbers shown "as of".
5. The location relinked to another place, or the Property archived: the goal ends ("Ended: Google location changed") and a new one is invited.
6. Google removes reviews or a guest changes stars: the daily recompute takes it in; a lost tenth sends a notice.
7. The rounding rule: verified on beta data where possible; the exact average comes from the cache when Google's figure is not exact.

## Data and storage

- Google's own numbers: the Current on Google snapshot (Reporting), as Review publishes it after a verified run, refreshed every 15 minutes to 6 hours.
- The cache: read only through Review's public API, as counts and star sums of reviews that may be served and were observed under the Property's current Google binding; reviews per Monday-to-Sunday week in the Property's time zone; stars since an instant. No review content leaves Review.
- Stored: the goal (mode, target, pace, state, binding epoch, baselines, the tenth and status last seen, reached or ended date and reason, a version for compare-and-set) and its change log. Exported and purged with the Organization's Goal records.
- Stored (round 2, migration 0059): a climb goal's planned quality (`quality_tenths`), part of its version-checked plan and its change log (field `quality`); the status vocabulary without `cant_reach_at_mix` and with `reviews_too_low`. Read (round 2): the totals of the reviews created since a goal was set, in the same summary read, and each Property-local calendar year's totals, both counts and star sums only.
- Stored (rounds 3 and 4, migration 0060): a climb goal's pace in tenths of a review a week (`pace_tenths_per_week`, 10 to 3500), with `pace_per_week` kept for one release as its whole weekly mirror (`GREATEST(1, (tenths + 5) / 10)`, held by the CHECK); the change log's `pace` rows in tenths (the old rows rewritten × 10). For that release the set and change schemas also take a legacy whole weekly `pacePerWeek` (mapped × 10; both together refused), and the fact and the Feed payload carry the tenths beside the widened mirror. A contract migration drops the mirror and the legacy fields afterwards. Read (rounds 3 and 4): each Property-local calendar month's totals with ten reviews and the review count per local date, from which the setup read hands the page the best month of the last twelve and the busiest 30 days of the last 365 (`setupInputs`); dates carry counts only. A reading waits for Google while the cache holds no review.
- Migration 0060 rolls forward, never back (ADR 0038's forward-only recovery; there is no down migration). For the minutes of its release an old web server shows every rewritten pace log row × 10 ("Pace 50 → 110 a week"), because it prints the stored value. Old images left running on a 0060 database cannot insert a climb goal (no tenths fails the plan CHECK), re-pace a goal (mirror mismatch) or switch a goal between keep and climb, and keep showing the × 10 history, until a roll-forward. If a rollback of the images is ever forced, run this first, in one transaction. It is exact only while both checks return 0 (every stored tenths value a multiple of 10 and at most 2000, true until a setup that offers paces a day ships); otherwise roll forward.

  ```sql
  BEGIN;
  SELECT count(*) FROM property_rating_goals
   WHERE pace_tenths_per_week % 10 <> 0 OR pace_tenths_per_week > 2000;   -- must be 0
  SELECT count(*) FROM property_rating_goal_changes WHERE field = 'pace'
     AND (old_value::int % 10 <> 0 OR new_value::int % 10 <> 0
          OR old_value::int > 2000 OR new_value::int > 2000);              -- must be 0
  ALTER TABLE property_rating_goal_changes DROP CONSTRAINT property_rating_goal_changes_value_check;
  UPDATE property_rating_goal_changes SET old_value = (old_value::int / 10)::text
   WHERE field = 'pace' AND old_value IS NOT NULL;
  UPDATE property_rating_goal_changes SET new_value = (new_value::int / 10)::text
   WHERE field = 'pace' AND new_value IS NOT NULL;
  -- re-add property_rating_goal_changes_value_check exactly as drizzle/0059_rating_goal_planned_quality.sql adds it
  ALTER TABLE property_rating_goals DROP CONSTRAINT property_rating_goals_plan_check;
  ALTER TABLE property_rating_goals DROP COLUMN pace_tenths_per_week;
  -- re-add property_rating_goals_plan_check exactly as drizzle/0059_rating_goal_planned_quality.sql adds it
  DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794100000000;  -- 0060, so a roll-forward runs it again
  COMMIT;
  ```

- Stored (PR 4, migration 0058; 0057 is PR 5's): a manager's "Not now" for a Property's goal (`property_rating_goal_deferrals`, who and when, one row per Property), so the setup strip's "Set a Google rating goal" step counts as decided. It sets, changes and blocks no goal. Exported and purged with the Goal records, and gone with its Property.

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
7. **Rounding of the paces.** Closed 2026-10-16: Steady, Faster and Push are retired (rounds 3 and 4); paces are nice values a day. Before: Steady, Faster and Push round half up, so 1.5 × 7 = 10.5 gives 11 a week. The owner's example copy used 10 ("Aim for about 10 new reviews a week", best case "207, ~5 months"). Default: half up (11, best case about 4 months). Alternative: the owner's figures, which round the tie down.
8. **One switch or two.** The rating goal is offered under `goal.use`, so the emergency switch also switches Portal Goal Programs off and the other way round. Default: shared (ADR 0067). Alternative: a separate capability for the rating goal, with its own fate row, so the two switch apart.
9. **A star average in notification storage (PR 5).** Resolved at landing. The Can't reach notice first stated the recent average stars of new Google reviews, which would have put an average of review ratings in the event and the notification payload and narrowed the ADR 0046 amendment of 2026-09-30. It does not: the body says only that new reviews lately average below what the target needs, the figure is gone from the event, the payload, the templates and the tests, and the 2026-09-30 rule stands unchanged. The notices carry the Property-level tenths (the tenth Google shows now and before, the goal's target), the goal's mode and pace, and the recent pace of new reviews, and nothing else. The alternative the plan offered first (narrow the rule) was not taken.
10. **Keep below 4.9 (round 2).** Amended 2026-10-16 by the owner (X1): Keep comes first from a shown 4.7, and the commands accept a keep goal from 4.7. Before: resolved 2026-10-15 at review, by R2-9 as written ("no Keep button otherwise"), which is later than D6: the reached news offers "Keep 4.9" only at 4.9 and nothing to keep below it, the Reached notice drops ", or keep 4.5" below 4.9, and the set and change commands refuse a keep goal while Google shows less than 4.9.
11. **"Change" on the plans' quality (round 2).** Closed 2026-10-16: the plans are retired; "Change" on the one screen's planned average opens a typed average. Before: default: it opens Build your own on its quality row, and the three plans keep their quality (see "Pick a plan, as built"). Alternative: the quality row also works the three plans out again at the new quality (`ratingGoalPlansAt`), so "Change" changes every plan at once.
12. **An Ambitious plan more than a year away (round 2, review 2026-10-15).** Resolved 2026-10-15 by the owner (R2-13, amends R2-9). R2-9 made Ambitious the highest row target the shared quality clears by 0.15★, at Push: on the 3.9 property that was 4.2 (178 reviews at 3 a week, Aug 2027 – Jul 2028), on the healthy one 4.6 (1,300 reviews at 14 a week, Oct 2027 – Sep 2032). The owner took the alternative: Ambitious only among row targets whose forecast at Push is within 52 weeks, else the recommended target at Push. The 3.9 property now gets 4.1 (81 reviews, about 27 weeks) and the healthy one 4.5 (454 reviews, about 33 weeks). Targets beyond a year stay in Build your own with their "More than a year" signal.
