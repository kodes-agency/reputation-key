# Monthly portal goal: plan

Date: 2026-10-17. Status: owner-approved decisions (P-1 to P-8 and the smaller calls), being built in 21 pull requests (PG-01 to PG-21); each records itself under [As built](#as-built) when it lands. The decision record is [ADR 0068](../adr/0068-monthly-portal-goal.md). Paths are relative to the repository root.

**Sources.** The owner's binding log is `~/kodes/portal-goals-redesign/DECISIONS.md` ("go with your recommendations on all 8", 2026-10-17). The proposal the owner approved is `~/kodes/portal-goals-redesign/PROPOSAL.md` and its published page, https://claude.ai/artifact/9qxDqGGzdXNBT8BWwX8nXL. The lead engineer's full implementation plan, with each PR's files, tests and copy deck, is `~/kodes/portal-goals-redesign/PLAN.md`. Precedence: DECISIONS, then the published page (its P-3 lines win over PROPOSAL's earlier ones), then PROPOSAL, then the research. This page keeps what the repository needs to carry: the decisions, the PR map, the number rules and goldens, the deploy order and the risks.

## What changes

A Property gets one recommended monthly number for its Portals, called the **Monthly portal goal**, accepted in one tap. Each Portal's count shows as a plain fact, never as a target of its own. In a Portal's first two weeks there is no number, only readiness steps. A check-in on days 1–7 of each month offers the new recommendation and changes nothing unless a manager chooses. Goals for one Portal or a Portal Group stay possible, one click deeper. The Property Google rating goal ([ADR 0067](../adr/0067-property-google-rating-goal.md)) stays separate, and the surfaces the two still share are split.

## Owner decisions (2026-10-17)

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-1     | Per-Portal counts are allowed as plain counts in name order, on the card and the goal page. No share bars, no per-Portal target or pace, never sorted by count.                                                                                                                                                                                                                                                                      |
| P-2     | Private ratings by default, with "Count scans instead" one tap away. Scans are offered first when the Property has scans but no private ratings.                                                                                                                                                                                                                                                                                     |
| P-3     | The recommended number is the usual +10 % ("a bit more"), rounded up. The other choices are "your usual" and "stretch" (+20 %), each at least one rounding step above the one before.                                                                                                                                                                                                                                                |
| P-4     | First two weeks: readiness steps per Portal (Live · Code made · First scan). No number until a Portal has been live 14 days. Own number allowed; the box starts empty.                                                                                                                                                                                                                                                               |
| P-5     | Single-Portal and group goals live one click deeper, behind "Most properties don't need one" and "Portal goals are about the spot, not the person who works there."                                                                                                                                                                                                                                                                  |
| P-6     | No pace word while fewer than 5 were expected by today. Applies to the card, the Overview chip and the Properties list, Portal goals only.                                                                                                                                                                                                                                                                                           |
| P-7     | Split what the two goals share. The Active/History tabs move inside the Google section. The "Goals" notification row becomes "Google rating goal" and "Portal goals" (ADR 0046 note).                                                                                                                                                                                                                                                |
| P-8     | Wording approved: the notice titles and bodies (PROPOSAL §4.5, recipients line included); "Ask every guest, not only happy ones. Low and high ratings count the same."; "Is it where guests can see it?"; "Portal goals are about the spot, not the person who works there."; ADR 0049 rule 2 narrowed to staff goals.                                                                                                               |
| Smaller | Stop only, no Pause. An ignored check-in keeps the number. A missed month reads a neutral "Not met" and sends no notice. Check-in days 1–7, on the page only. The results matrix gets its own page. The number's source is stored as recommended / own. Explicit no to R4-2 and R4-5. Name "Monthly portal goal". Standing: auto-merge, deploy after green main CI, ask before data-destructive steps, Google-free, no staff quotas. |

## Pull requests

Sizes are non-test production lines, with test lines in brackets. S < 300, M 300–800, L > 800. Every PR is auto-merge; main requires up-to-date branches, so they land one at a time.

| #     | Branch                                | Title                                                                       | Size                                 | Depends on   | Migration | Deploy note                                                                                                                                                     |
| ----- | ------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ | ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PG-01 | `feat/portal-goals-01-words`          | Wording and first-visit clean-up                                            | S ~180 [~250]                        | —            | —         | any time; web reads only                                                                                                                                        |
| PG-02 | `feat/portal-goals-02-pace-guard`     | P-6: no pace word under 5 expected                                          | S ~20 [~220]                         | —            | —         | any time; web reads only                                                                                                                                        |
| PG-03 | `docs/portal-goals-03-adr`            | ADR 0068, ADR 0049 rule 2, notes, plan doc                                  | S (docs)                             | —            | —         | none                                                                                                                                                            |
| PG-04 | `feat/portal-goals-04-facts`          | 0062: target source, check-in answer, stop record, Not-now table            | S ~200 [~380]                        | —            | **0062**  | not within 30 min of 02:00 UTC; read-only beta count before and after                                                                                           |
| PG-05 | `feat/portal-goals-05-notices`        | P-8 notice wording and Property recipients                                  | S–M ~300 [~480]                      | —            | —         | **worker change**: web then worker; avoid 01:30–02:30 UTC and the 1st/2nd of a month 19:00–24:00 UTC; target Oct 31, hard deadline Dec 1 19:00 UTC              |
| PG-06 | `feat/portal-goals-06-portal-facts`   | Portal's goal-readiness facts                                               | S ~230 [~320]                        | —            | —         | any time                                                                                                                                                        |
| PG-07 | `feat/portal-goals-07-recommendation` | Recommendation read and rule (Property level)                               | M ~700 [~950]                        | 06           | —         | any time; no UI                                                                                                                                                 |
| PG-08 | `feat/portal-goals-08-section`        | Portal goals section, card read, gates, getting ready                       | M ~720 [~700]                        | 07, 01       | —         | **deploy together with PG-09**                                                                                                                                  |
| PG-09 | `feat/portal-goals-09-use`            | Ready card, Use, minimal goal state, identity, `$goalId` redirect           | M ~560 [~620]                        | 08, 04       | —         | after this deploy beta managers can set real goals                                                                                                              |
| PG-10 | `feat/portal-goals-10-sheet`          | Set sheet (own number, choices, Count scans instead)                        | M ~720 [~720]                        | 09           | —         | any time                                                                                                                                                        |
| PG-11 | `feat/portal-goals-11-done-screen`    | Google done screen: See your portal goal / Create a portal                  | S ~90 [~140]                         | 08           | —         | any time; Google files, own PR                                                                                                                                  |
| PG-12 | `feat/portal-goals-12-running`        | Running card: bar and tick, rows, pace, passed, stopped, updating           | M ~620 [~680]                        | 09           | —         | **target live Oct 31**                                                                                                                                          |
| PG-13 | `feat/portal-goals-13-page`           | Goal page `/goals/portals`                                                  | M ~760 [~720]                        | 12           | —         | bundle checkpoint O-1 likely here                                                                                                                               |
| PG-14 | `feat/portal-goals-14-change-stop`    | Change number, Count scans instead, Stop                                    | M ~480 [~520]                        | 13, 10       | —         | any time; target Nov 6                                                                                                                                          |
| PG-15 | `feat/portal-goals-15-check-in`       | Month-start check-in (Use / Keep / Other number)                            | S–M ~420 [~520]                      | 14, 04       | —         | **live by Nov 30**                                                                                                                                              |
| PG-16 | `feat/portal-goals-16-overview`       | Overview slot and Not now; chip and list links; portal Results line         | S–M ~470 [~460]                      | 15, 04       | —         | CLS check; measure loader bytes                                                                                                                                 |
| PG-17 | `feat/portal-goals-17-notice-row`     | P-7b: `portal_goals` category, carry-over, two settings rows                | M ~260 [~460]                        | 04 (journal) | **0063**  | **worker change**, forward-only: web then worker; avoid 01:30–02:30 UTC, :55–:05 of any hour, and the 1st/2nd 19:00–24:00 UTC; never in the same deploy as 0062 |
| PG-18 | `feat/portal-goals-18-results`        | `/goals/portal-results`; matrix off the Goals page; ended goals             | S–M ~320 [~300]                      | 13           | —         | bundle: route row, offset by the matrix leaving `/goals/`                                                                                                       |
| PG-19 | `feat/portal-goals-19-tabs`           | P-7a: Active/History tabs inside the Google section                         | S ~90 [~160]                         | 18           | —         | highest Google risk; full rating-goal suite                                                                                                                     |
| PG-20 | `feat/portal-goals-20-add`            | Add a portal goal; `/goals/new` redirects; retire the new-goal form         | M–L ~720 new, ~−2,000 deleted [~700] | 13           | —         | e2e rewrites; bundle offset (`new.tsx` shrinks)                                                                                                                 |
| PG-21 | `feat/portal-goals-21-single`         | Single-portal, group and average goal page on `$goalId`; retire old dialogs | M ~520 new, ~−1,500 deleted [~560]   | 20           | —         | e2e rewrite of the `$goalId` journey                                                                                                                            |

**Merge order.** 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 18 → 19 → 20 → 21. PG-17 takes any free slot after PG-04. PG-05 may take any earlier slot.

**Dates.**

| Date             | What it means                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oct 31           | PG-12 should be live: goals set after Oct 20 default to Nov 1, and PG-09's minimal running lines are the fallback. PG-05 should be live too: an October goal set from PG-09 could close on Nov 1–2. |
| Nov 30           | PG-15 must be live: the first check-in window is Dec 1–7.                                                                                                                                           |
| Dec 1, 19:00 UTC | PG-05's hard deadline: the first November close for a Sofia Property is about Dec 1 22:00 UTC.                                                                                                      |

## The number rules (exact)

For a Portal p and measure m: W is the 28 whole Property-local days ending yesterday. `liveDays_p` = local days d ∈ W, d ≥ the measure version's first day (2026-08-01 local), on which an activation interval overlaps d. `count_p,m` = Σ that Portal's readings on those days. p is established when `liveDays_p ≥ 14`. The go-live day counts as day 1.

- **Rate:** `R_m = Σ_{p established} count_p,m / liveDays_p` (exact). `about = halfUp(R·D)`.
- **Full month** (D days), x = R·D:
  - `usual = roundUp(x)`
  - `aBitMore = max(roundUp(x·11/10), up(usual))` (recommended)
  - `stretch = max(roundUp(x·6/5), up(aBitMore))`
- **From today** (current month), S = Property month to date including today, L = `daysLeft + 1`, x = R·L:
  - `usual = max(roundUp(S + x), up(S))`
  - `aBitMore = max(roundUp(S + 1.1x), up(usual))`
  - `stretch = max(roundUp(S + 1.2x), up(aBitMore))`
- **Grid:** one grid for rounding and the steppers, `G = {1…29} ∪ {30, 35…100} ∪ {110, 120…500} ∪ {550, 600, …}`. `roundUp(x) = min{g ∈ G : g ≥ x}`, `up(n) = min{g > n}`, `down(n) = max{g < n}` (null at 1).
- **Exact arithmetic:** rationals `{num, den}` in BigInt; the grid is integers. No float decides a number.
- **Null choices** when `R_m = 0` or no Portal is established.
- **Basis weeks** = ⌊max established liveDays / 7⌋ ∈ {2, 3, 4}.
- **`readyOn`** = today + (14 − max liveDays) for the closest live Portal. **`joinsOn_p`** = today + (14 − liveDays_p).
- **States:** per measure `unreadable` (flag), `nothing` (R = 0), `ready`. The top state: ratings `ready` → `ready`; else ratings `nothing` with scans `ready` → `scans_only`; else ratings `nothing` with scans `nothing` → `nothing_counted`; else `unreadable`. `no_live_portal` and `getting_ready` come first.
- **Default month:** `defaultGoalStartMonth(now, tz)` (`goal-start.ts`), i.e. this month through day 20.
- **Pace:** behind when `value·total·100 < 90·target·elapsed`. Quiet days ≤ 3. P-6: not judged when `target·elapsed < 5·total`.
- **Days left:** shown as `daysAfterToday + 1`; "last day" when 1.
- **Tick:** `elapsed / total`.
- **Quiet facts:** "no scans since" when the Portal is established, `silentDays × scans_p/liveDays_p ≥ 5` and rate > 0; `usualPerWeek = halfUp(7·scans_p/liveDays_p)`. "No scan since code" when the code is ≥ 14 local days old and no scan has arrived since it was made.
- **Times note:** half-up(typed/usual) when typed ≥ 3·usual; under half when 2·typed < usual.

### Goldens

| #   | Case (Europe/Sofia)                                                                                                  | Expected                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Oct 23; W = Sep 25–Oct 22; Reception and Restaurant live Oct 9 (14 d; 11 and 5 ratings); Spa Oct 15 (8 d); R = 16/14 | `ready`; Nov (30 d): about **34**; **35 · 40 · 45**, recommended **40**; default month 2026-11; Spa joins 2026-10-29; 2 weeks, 2 portals                    |
| G2  | Same, October current, S = 12, L = 9                                                                                 | **23 · 24 · 25**, recommended **24**                                                                                                                        |
| G3  | Oct 17; W = Sep 19–Oct 16; 8 live days                                                                               | `getting_ready`, `readyOn` 2026-10-23, default month 2026-10                                                                                                |
| G4  | Dec 1; W = Nov 3–30; 34 ratings, all 28 d; R = 34/28                                                                 | Dec (31 d): about **38**; **40 · 45 · 50**, recommended **45**; check-in "Use 45" / "Keep 40"                                                               |
| G5  | 0 ratings, 23 scans in 14 d                                                                                          | `scans_only`; Nov **50 · 55 · 60**, recommended **55** (the published page's "50 scans" is pre-P-3)                                                         |
| G6  | roundUp                                                                                                              | 0.2→1, 9→9, 20.1→21, 29.3→30, 30→30, 34.29→35, 37.71→40, 49.3→50, 100→100, 100.2→110, 499.1→500, 500.5→550                                                  |
| G7  | up / down                                                                                                            | up(29)=30, up(30)=35, up(97)=100, up(100)=110, up(500)=550; down(30)=29, down(35)=30, down(110)=100, down(550)=500, down(1)=null; typed 37 → up 40, down 35 |
| G8  | x = 27.3                                                                                                             | **28 · 35 · 40**                                                                                                                                            |
| G9  | x = 2.1                                                                                                              | **3 · 4 · 5**                                                                                                                                               |
| G10 | Nov 22: 23 of 40                                                                                                     | behind (69,000 < 79,200); "17 to go · 9 days left"; tick 22/30                                                                                              |
| G11 | Target 10, 30-day month                                                                                              | day 14 `too_few_expected`; day 15 judged (4 → behind, 5 → on pace); target 8 in 31 days judged from day 20; target 4 never judged                           |
| G12 | A reading at 2026-10-25 03:30 local (the repeated hour)                                                              | counted on Oct 25; W still holds 28 days                                                                                                                    |
| G13 | Ratings has one approximate live reading, scans ready                                                                | top `unreadable`; scans choices present                                                                                                                     |
| G14 | Live 20 d, 0 ratings, 0 scans                                                                                        | `nothing_counted`; both measures' choices null                                                                                                              |
| G15 | 3 readings with null portal_id this month                                                                            | in S and in `elsewhere`; parity with `queryGoalAggregate`                                                                                                   |
| G16 | An archived Portal with 2 readings this month                                                                        | in S and in `elsewhere`; not in rows, not in the rate                                                                                                       |
| G17 | Reception live Oct 1, disabled Oct 10 14:00 to Oct 13 09:00                                                          | on Oct 23, live days = 20 (Oct 11, 12 excluded); established                                                                                                |
| G18 | Passed: 41 of 40 on Nov 27                                                                                           | "Goal passed · 4 days left", no tick                                                                                                                        |
| G19 | A Portal moves from group A to B on Nov 10 (PG-20)                                                                   | B's S counts from Nov 10; A keeps Nov 1–9                                                                                                                   |

## Deploy order

- **Every deploy:** a green-CI main SHA, then `pnpm ops deploy-ci-images --sha X --apply`. It rolls web (migrations in preDeploy), then the worker, is idempotent (rerun it on Railway flakes) and ends with the Google OAuth check. Auto-merge and deploy follow the standing rule.
- **Migrations:** not within 30 min of 02:00 UTC (`rating-goal.evaluate`). 0062 (PG-04) and 0063 (PG-17) never deploy together. Each journal `when` must exceed main's last at rebase time.
- **Worker PRs (PG-05, PG-17):** web then worker; also not on the 1st or 2nd of a month between 19:00 and 24:00 UTC (the Sofia month close). PG-17 also avoids :55–:05 of any hour (the hourly digest). Read the BullMQ phase of `goal-program.maintain` on the beta before each and avoid that minute.
- **PG-08 and PG-09** deploy together, after PG-09's main CI.
- **Rollback of PG-17** is data-destructive: ask the owner first.

**Read-only beta checks** (`railway ssh` into the worker, base64 node script, one READ ONLY transaction, aggregates only; the result goes in the PR body):

| When                                 | Check                                                                                                      | Expect                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Before and after PG-04               | goal programs, versions and target changes; the new columns exist; non-null `target_source`; deferral rows | 0 / 0 / 0; yes; 0; 0                               |
| After PG-09 and each later UI deploy | Properties with more than one non-ended Property-subject count goal                                        | 0                                                  |
| After PG-15                          | goals with `check_in_answered_month` set (informational)                                                   | —                                                  |
| Before and after PG-17               | per-category rows in preferences, defaults and unsubscribe scopes                                          | `recognition` = `portal_goals`; stale-copy count 0 |
| Before PG-05 and PG-17               | the BullMQ phase of `goal-program.maintain` on the beta                                                    | read it, and avoid that minute                     |

## Risks

- **"A bit more" may read as pressure, "your usual" as easy.** The owner chose +10 % over the research agents' "usual" (P-3). The check-ins move the number only when a manager chooses.
- **Two weeks of a few ratings is a shaky basis.** Whether it gives a steady number is unknown without data; the first check-ins correct it.
- **Seasons are ignored.** The number lags a season change by about a month.
- **The go-live day biases the rate down** by up to 1/14, because a partial day counts as a live day.
- **Goal counts can differ a little from Results counts.** Goals count from Aug 1 on their own versions; Results count private ratings from Aug 8 and show an average from 5 ratings.
- **Gaming is not detected.** Staff can scan their own code or rate on a shared device ("Start over" starts a new visit).
- **On a one-Portal Property, the Property goal is that Portal's goal.** Every beta Property with a Portal has exactly one. The counts are facts, the spot-not-person line stands, and nothing targets the Portal.
- **A same-second race can give a Property two goals** (two managers on different measures). No lock; the beta check after each UI deploy counts them, an extra shows in "More portal goals", and the owner decides which to stop.
- **Late readings.** A check-in on the 1st can miss readings of the previous month's last day that arrive within the 24 hours the measure allows. Accepted (ADR 0068 decision 8).
- **Results arrive about 25 hours after month end.** Day 1 shows "so far".
- **Bundle.** 170 B of first-paint headroom on 2026-10-17 (307,530 of 307,700 B). One owner ceiling for the whole build (O-1), asked once at the first PR that crosses it, likely PG-13.
- **Separation drift.** The Goals page, `goal.use` and (until PG-17) the notification row are shared. Each PR that touches a shared surface proves the Google rating goal is unchanged.

## Open questions (default built)

| #         | Question                                                                                                          | Default built                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Q-1 / O-1 | A bundle ceiling for the whole build                                                                              | Ask once at the first PR that crosses 307,700 B (likely PG-13), suggesting 308,300 B (+600). Only that PR waits |
| Q-2       | A `docs/BETA.md` §3 sentence describing the Monthly portal goal                                                   | Not added; only a §10 record of the approvals                                                                   |
| Q-3       | An approved line for the average step (the ask-every-guest second sentence is false for an average)               | "Portal goals are about the spot, not the person who works there." only                                         |
| Q-4       | What the Overview shows for a scheduled goal                                                                      | Nothing                                                                                                         |
| Q-5       | New or derived copy (marked D or N in the copy deck)                                                              | Built as written; each line flagged in its PR body for a nod                                                    |
| Q-6       | The scans-only example (the published page shows the pre-P-3 50)                                                  | 55 (P-3)                                                                                                        |
| Q-7       | Visible deviations: 512 px dialog, square steppers, a tick overlay, tiles 2+1 on phones, Met in the positive tone | As listed                                                                                                       |
| Q-8       | The Overview waits for the slower of the two goal reads (≤ 300 ms)                                                | Accepted; the e2e journey measures CLS                                                                          |
| Q-9       | `changeGoalProgramAssignments` after PG-21                                                                        | Kept in `.fallowrc.json` `ignoreExports` with a reason                                                          |
| Q-10      | Two Property goals from a same-second race                                                                        | No lock; monitored by the beta count                                                                            |
| Q-11      | Whether two weeks gives a steady number                                                                           | Unknown without data; the check-ins correct it                                                                  |

## As built

Each PR replaces its own "Not recorded yet" when it lands.

### PG-01 — Wording and first-visit clean-up

Not recorded yet.

### PG-02 — P-6 pace guard

Not recorded yet.

### PG-03 — Docs

ADR 0068; ADR 0049 rule 2 narrowed to staff goals (amendment of 2026-10-17); pointers in ADR 0067; a note in ADR 0041; `docs/BETA.md` §10; this page; the notes in `docs/plan/google-rating-goal.md` (open question 6) and `docs/plan/goals-flexible-months.md` (D4, open question 6); the root `CONTEXT.md` ADR row. The ADR 0046 notes ship with PG-05 and PG-17. No legal document changes.

### PG-04 — Migration 0062

Not recorded yet.

### PG-05 — Notices

Not recorded yet.

### PG-06 — Portal's goal-readiness facts

Not recorded yet.

### PG-07 — Recommendation read and rule

Not recorded yet.

### PG-08 — Portal goals section, card read, gates and getting ready

Not recorded yet.

### PG-09 — Ready card, Use, minimal goal state, `$goalId` redirect

Not recorded yet.

### PG-10 — Set sheet

Not recorded yet.

### PG-11 — Google done screen

Not recorded yet.

### PG-12 — Running card

Not recorded yet.

### PG-13 — Goal page `/goals/portals`

Not recorded yet.

### PG-14 — Change number, Count scans instead, Stop

Not recorded yet.

### PG-15 — Month-start check-in

Not recorded yet.

### PG-16 — Overview slot and Not now; chip and list links; portal Results line

Not recorded yet.

### PG-17 — The notification row split

Not recorded yet.

### PG-18 — `/goals/portal-results`

Not recorded yet.

### PG-19 — Tabs inside the Google section

Not recorded yet.

### PG-20 — Add a portal goal; `/goals/new` redirects

Not recorded yet.

### PG-21 — Single-portal, group and average goal page

Not recorded yet.
