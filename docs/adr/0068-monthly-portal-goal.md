---
status: accepted
date: 2026-10-17
---

# 0068 — Monthly portal goal

Amends [ADR 0049](0049-beta-local-acceptance.md) (rule 2 is about staff goals)
and [ADR 0041](0041-governed-metric-registry.md) (a note on the reads behind the
recommended number), each by a dated section that points here.
[ADR 0046](0046-notification-policy.md) gains its notes with the code they
describe: the notices' wording and recipients, and the "Portal goals"
notification row. The plan is `docs/plan/monthly-portal-goal.md`.

## Context

A Portal goal is a Goal Program today: a monthly target over one of three
first-party Portal measures (qualified scans, private-rating count, private-rating
average) for a Property, a Portal Group or a Portal (`docs/BETA.md` §3). Setting
one means filling in an admin form with six fields and a blank target box, and a
first visit to the Goals page shows a results table with no results. The
Property Google rating goal next to it (ADR 0067) opens already answered.

Three facts shaped the redesign.

- **There is no data.** A read-only count of the beta on 2026-10-17 found 23
  Properties, 19 of them with no Portal and 4 with one each, 2 published Portals,
  no Portal Group, no Goal Program ever set, and no scan and no private rating
  in the last 90 days. Nothing needs migrating, no rule can be calibrated
  against real use, and every screen needs a path for "no data yet".
- **ADR 0049 rule 2 conflicts with the product contract.** Read literally ("No
  Portal response, private response, Google, AI, scan, click, or named-mention
  fact may drive Goals"), it forbids the three measures that `docs/BETA.md` §3
  and §6 of the Participation Agreement allow. The Google rating goal plan
  noticed and left it as it was (its open question 6).
- **The two goals stay apart** (the owner's rule (a)). The Monthly portal goal
  and the Google rating goal have their own names, rhythm (calendar months
  against Mon–Sun weeks), numbers, places and notices, and neither feeds the
  other. Four things were still shared: the `goal.use` switch, the "Goals"
  notification row, the Active/History tabs, and the words "below pace" with
  their 90 % rule. (Amended 2026-10-19: the goals share their design parts
  too, never their data; see below.)

A Portal often has one person behind it: there is at most one active Primary
Staff Participant per Portal, and each guest response snapshots that person
(ADR 0052). A target for one Portal can therefore read as that person's quota,
which is why ADR 0067 rejected per-Portal Google review goals.

The owner approved decisions P-1 to P-8 and the smaller calls of the proposal on
2026-10-17 ("go with your recommendations on all 8"). This record states them.

## Decision

1. **One goal for the Property, named "Monthly portal goal".** It is an
   ordinary Goal Program: a Property subject, one count measure, calendar
   months, and a target each month may carry (ADR 0066). A Property's monthly
   goal is found on the server by Program id: the earliest-created Property goal
   on a count measure that has not ended; else the most recently ended one whose
   window still covers a month that is open or reconciling. One goal per
   Property is a screen rule plus a pre-check in the set command, which refuses
   while a Property count goal that has not ended exists on either measure. There
   is no domain rule, no database constraint and no lock.
2. **Each Portal's count is a fact (P-1).** The card and the goal page show each
   Portal's count as a plain number, in name order, and never sort by count.
   There are no share bars and no target or pace for a Portal. The rows are drawn
   only when they and "Other portals" (readings of Portals that are not live, and
   readings with no Portal) add up to the goal's own figure. D4 of the flexible
   goal months plan holds: no total that Portals share and no per-Portal target
   inside one goal.
3. **Private ratings by default (P-2).** The goal counts private ratings, with
   "Count scans instead" one tap away. Scans are offered first when the
   Property's Portals had scans but no private ratings in the basis. Where the
   goal counts private ratings, the ready card and the set sheet carry the line
   "Ask every guest, not only happy ones. Low and high ratings count the same."
4. **The recommended number is the usual plus 10 % (P-3).** The basis is the 28
   whole Property-local days ending yesterday. A Portal's rate is its count over
   its live days; the Property's rate R is the sum over Portals with at least 14
   live days. For a whole month of D days, x = R × D, and the three choices are
   "your usual" `roundUp(x)`, "a bit more" (recommended)
   `max(roundUp(1.1x), up(usual))` and "stretch"
   `max(roundUp(1.2x), up(a bit more))`. For the current month, with S counted
   so far (today included) and L days left (today included), x = R × L and the
   choices are `max(roundUp(S + x), up(S))`, `max(roundUp(S + 1.1x), up(usual))`
   and `max(roundUp(S + 1.2x), up(a bit more))`.
   `roundUp` and the − and + steps use one grid: every whole number to 29, then
   every 5 to 100, every 10 to 500 and every 50 above. A measure with a rate of
   0, or with no Portal of 14 live days, has no choices. The maths is exact
   rationals in BigInt; no float decides a number. The default month is this
   month through the 20th local day, then the next (`defaultGoalStartMonth`).
   Worked example: two Portals live 14 days with 11 and 5 private ratings give
   R = 16/14, so November (30 days) is about 34 and the choices are 35, 40
   and 45, recommended 40; on October 23 with 12 counted and 9 days left they
   are 23, 24 and 25. The plan holds the full set of goldens.
5. **No number before 14 live days (P-4).** Until a Portal has been live 14 days
   the card shows readiness steps for each Portal (Live · Code made · First scan)
   and no number. A manager may set their own number; the box starts empty. A
   live day is a Property-local day of the basis, on or after the measure
   version's first day (2026-08-01), on which a publication activation was open
   for any part of the day. The go-live day counts as day 1 although it is
   partial, which lowers a new Portal's rate by up to 1/14. A short disable does
   not restart the clock: only the whole days it covers drop out. "Live since"
   is the start of the current unbroken run, and a republish does not break it.
   Draft, disabled and archived Portals are not in the rate, but their readings
   still count in the month.
6. **Goals for one Portal and for a group are one click deeper (P-5).** They
   sit behind "Most properties don't need one" and the line "Portal goals are
   about the spot, not the person who works there." An average goal has no
   recommended number: its box starts empty and states the 10-rating floor.
7. **No pace word while fewer than 5 were expected (P-6).** `goalPace` gains a
   state after the quiet days: a month is not judged while
   target × elapsed days < 5 × days in the month. It is one rule for the card,
   the Overview chip and the Properties list. The Google rating goal's pace and
   its own below-pace rule (`rating-goal-pace.ts`, `rating-goal-status.ts`) are
   not touched.
8. **A month-start check-in, on the page only.** On local days 1 to 7 the card
   and the Overview slot offer "Use N" (the recommendation, when it differs from
   the current number), "Keep" and "Other number". It is never a notice and never
   automatic; an ignored check-in keeps the number and nothing rolls forward.
   Keep is stored on the goal for that month, with no version and no change-log
   row. The check-in reads the same 28 days ending yesterday, so on the 1st of a
   month it can miss a few readings of the last day of the month before, which
   may arrive up to 24 hours after the month ends
   (`append_by_source_event_time_reconcile_24h_after_month_end`). That is
   accepted: the previous month's own result still waits for them, and the next
   check-in or a change corrects the number. (Amended 2026-10-19: it is a strip
   above the card, not the card's body; see below.)
9. **Stop only.** A goal can be stopped, not paused: resuming would judge the
   paused months. A stopped goal keeps its running month and stays the
   Property's monthly goal until that month closes. Who stopped it and when is
   stored.
10. **A missed month is neutral.** It reads "Not met" in a neutral tone and sends
    no notice. The notices stay the two existing types, met and result revised,
    with the approved wording (P-8), and go to the Property's responsible
    managers whatever the goal's subject, with AccountAdmins as the fallback.
    There is no missed, below-pace, number-ready or check-in notice.
11. **The number's source is stored.** A version and a month-target change record
    `recommended` or `own` (NULL for one written before this or by an older
    web). It is `recommended` when the number set equals the recommended number
    for that month and measure, and `own` otherwise. It is for learning from the
    beta; no rule reads it.
12. **The recommendation reads its own versions.** It is a `goal` consumer of the
    qualified-scan and private-rating-count versions (…1301, …1302) at Portal
    scope, read in one set-based statement with the latest correction applied. A
    reading the governed read would quarantine makes its Portal and measure
    unreadable. It skips only the outbox completeness proof, as the behind-pace
    count does (`goal-running-months.ts`). The figure a running goal shows always
    comes from the governed read: a suggestion is never a result.
13. **Nothing mixes the two goals.** The owner said no to R4-2 (Portal ratings as
    the Google rating goal's planned average) and R4-5 (learning the asked share
    from Portal scans). No number of one goal is derived from the other. The
    shared surfaces split (P-7): the Active/History tabs move inside the Google
    section, and the "Goals" notification row becomes "Google rating goal" and
    "Portal goals" (ADR 0046 note, with that change). Two things stay shared:
    `goal.use` stays one switch (Consequences), and "below pace" stays a word
    both goals use over two separate rules, `goalPace` with the P-6 guard here
    (decision 7) and the Google rating goal's own (`rating-goal-status.ts`).
    (Amended 2026-10-19: "below pace" is now one shared pill over those two
    rules; see below.)
14. **The results table has its own page.** The monthly results table of Portal
    goals moves off the Goals page to its own page, `/goals/portal-results`,
    which also lists the ended Portal goals. (Amended 2026-11-01: a card and a
    chart for each goal, not a table; see the last amendment.)

## Guardrails

- **Managers only.** AccountAdmins and PropertyManagers with access to the
  Property, under `goal.use`. Every Portal-goal read authorizes `goal.create`, so
  the narrowed reader view of `withGoalProgramVisibility` (an actor without
  `goal.create` sees only "their" Portals' goals) is never reached; changes and
  the check-in need `goal.update`, and Stop needs `goal.cancel`. Members hold no
  `goal.*`. No role holds `goal.update` without `goal.create` today.
- **No staff goal.** No subject is a person or a team. Nothing ranks or rewards
  people or Portals, and nothing sorts Portals by count (`docs/BETA.md` §3;
  ADR 0049 rule 2 as amended 2026-10-17). `employment_decision_eligible` stays
  `false`. A one-Portal Property is covered under Consequences.
- **Google-free.** The goal reads only its own first-party measures. No Google,
  AI, click or named-mention fact reaches it, and it reads nothing of the Google
  rating goal.
- **The guest journey is unchanged.** A goal changes nothing a guest sees.

## Consequences

- **No legal document changes.** The goal uses two of the three named measures,
  the same three scopes, managers only, no Google data and no new class of
  personal data. The Google Access Disclosure ("Portal Goals use the Portal's own
  qualified scans and private rating metrics"), §6 of the Participation
  Agreement and the purposes of Privacy Notice 2.5 stay true as written. Name
  order and no share bars keep "no ordinal ranking".
- **Migration 0062** adds the target source, the answered check-in month, the
  stop record and a table for the Overview's "Not now"; **0063** copies the
  "Goals" preferences, defaults and unsubscribe scopes to the new "Portal goals"
  row. They never deploy together.
- **The basis is thin at first.** Two weeks of a few ratings is a shaky number,
  and seasons lag by about a month. The check-ins correct both; nothing raises a
  number on its own.
- **On a one-Portal Property the Property goal is, in effect, that Portal's
  goal**, and every beta Property with a Portal has exactly one today
  (`docs/plan/monthly-portal-goal.md`, Risks). Where one person runs that
  Portal, the number can still read as theirs. That is accepted: the subject is
  the Property, not a person or a team, so it is not a staff goal under ADR 0049
  rule 2 as amended; the Portal's count is a fact, with no target or pace of its
  own; the goal is shown to managers only; and the ask-every-guest and
  spot-not-person lines stand.
- **Goal counts can differ a little from Portal Results.** Scans do not:
  Goals and Results read the same qualified-scan version, effective from
  2026-08-01. Private ratings can: Goals count them from 2026-08-01 on their
  own versions, Results from 2026-08-08 on the Portal rating version, so a
  window that opens before 2026-08-08 can hold up to a week more ratings in a
  Goal than in Results. Results also show an average only from 5 ratings
  (`portal-results-thresholds.ts`). (Corrected 2026-10-22: this said Results
  counted scans from 2026-08-08 too.)
- **Gaming is not detected.** Staff can scan their own code or rate on a shared
  device. The ask-every-guest line, the spot-not-person line and the absence of
  per-Portal targets are the controls.
- **A same-second race can give a Property two goals** (two managers on
  different measures). There is no lock. The read-only beta check after each UI
  deploy counts Properties with more than one, and the owner decides which to
  stop.
- **`goal.use` stays one switch** for both goals (ADR 0067; open question 8 of
  the Google rating goal plan).

## Amended 2026-10-19 — one goal design system

After a side-by-side audit of the two goals' screens the owner decided (U-1 to
U-3, "Proceed with the recommendations") that the Monthly portal goal moves onto
the look of the Google rating goal, the reference that was approved over five
rounds. This changes what "The two goals stay apart" and decision 13 mean for
how the goals are drawn, and nothing else in them.

1. **Design parts are shared; data, names, notices and rhythm are not.** The
   card frame (title and status pill), the headline, the progress meter and the
   check-in strip are drawn by neutral modules, `src/components/goals/goal-*`,
   that the Google rating goal calls today and the Monthly portal goal moves
   onto (its card, Overview slot and page header draw with the first three, its
   month-start check-in with the strip, its set, change and add sheets with the
   sheet frame and the setup parts, its pages with the detail layout, the tiles
   and the History list). Each part was cut from the Google rating goal in the
   step that gave it its first Portal caller. A
   shared part imports no `rating-goal-*` or `portal-goal-*` module and no
   server context, and says no product word: a goal passes in its own words, so
   the other goal's words cannot come out (`goal-shared-sources.test.ts`). The
   Portal goal's own sources still import nothing of the Google rating goal and
   say none of its words or lines (`portal-goal-sources.test.ts`). Names,
   calendar months against Mon–Sun weeks, notices, Overview slots, server
   modules and query keys stay apart, and no number of one goal is derived from
   the other (decision 13).
2. **"Below pace" is one pill.** The Portal goal shows the Google rating goal's
   status pill with the three pace states (`GOAL_PACE_STATUS`: Getting started,
   On pace, Below pace), including a green "On pace". This replaces the Portal
   goal's inline amber "below pace" word and its rule that it is never "on
   pace" (`portal-goal-running-view.ts`; U-1), when the Portal card moves onto
   the pill. Decision 7 still holds: after the quiet days a month that is not
   yet judged shows no pill. The two pace rules stay separate: `goalPace` with
   the P-6 guard here, `rating-goal-status.ts` there.
3. **One signature visual per goal.** The Google rating goal keeps its ladder and
   its climb chart; the Portal goal keeps its month meter and its per-Portal
   counts. Both headlines say what is left ("18 new reviews to 4.1", "17 private
   ratings to 40", U-2). (Amended 2026-11-01: both goals draw how far along they
   are on the same ruler; see the last amendment.)
4. **A part is cut from the Google rating goal first.** Each shared part is
   extracted from the Google files in a commit that changes none of their output
   (checked by a DOM and pixel comparison of every Google goal story), in the
   slice of its first Portal caller; the Portal then calls it.
5. **The month-start check-in is a strip above the card (decision 8).** On local
   days 1 to 7 it is drawn as the Google rating goal's Monday check-in is, as
   a strip above the card on the Goals page and the Overview slot, where it took
   the card's body before (`goal-check-in.tsx`). It is a region named for the
   month ("For December"), not a heading in the page's outline. It says how the
   month before went, what is recommended and what it stands on, and offers
   "Use N" (the one to take), "Keep N" and "Other number", in that order; with no
   number to use, "Keep N" is the one to take. The card under it shows the
   running month and its pill and leaves the month before to the strip. What the
   check-in does is unchanged: nothing is automatic, a refusal is a toast, and
   Use and Keep send the same commands.
6. **The setup sheets are one frame.** The set, change and add sheets are the
   Google rating goal's setup frame (`goal-sheet-frame.tsx`: a dialog on a
   desktop, a full-screen sheet on a phone) and its parts (`goal-setup-parts.tsx`):
   the number as the hero between round steppers with what it counts under it,
   the line under it (the recommendation's tag and its words, or the way back),
   the suggested numbers as radio rows in a muted panel with the asking line
   quoted in it, and a row of links. The number stays a typed box (the arrow
   keys step along the goal grid, Enter writes it), what Set sends is unchanged,
   and the rows of "a goal for each portal" keep their small square steppers.
7. **The goal pages are one layout.** The Monthly portal goal's page (and a
   Portal's or a group's goal on `$goalId`) and the average's page are laid out
   as the Google rating goal's page (`goal-detail-layout.tsx`, `goal-history-list.tsx`):
   a column of blocks that the page orders itself, here in the Google page's order:
   a stopped goal's state first, as a notice; what is left to the number
   and the days left, then what the goal counts and from where; the signature
   visual (the month meter, with its first and last day, in a card titled by the
   month so far, as the Google goal's climb chart is); the tiles, titled "Your
   goal, so far"; what each Portal brought in and each month; the History list;
   and how the goal counts. The pace is the pill in the page's header (the
   average has none: a month's average is not judged against a pace). What changed
   is the shared History list, a card with each date in a column of its own and the
   words beside it, still the region named "Changes", with "Show all" after twelve.
   Its words, rows, the "How this goal counts" disclosure, "More portal goals" and
   the plain page of a goal for several subjects are the Portal goal's own.
   (Amended 2026-11-01: the Monthly portal goal's page is where the goal stands and
   three questions, with no signature visual card and no tiles; its change log is
   the region "What changed", closed until asked; see the last amendment.)
8. **The Goals page's rows wear the pill too.** A row of a Portal goal with one
   subject on a count measure (`GoalLiveLine`) draws the same pill where `goalPace`
   judged the month, "On pace" or "Below pace", in place of the quiet amber
   "below pace" note: on the sentence's own line where the row's cell has room,
   beside the bar where it has not, and in a row kept as high as the pill whether
   it is there or not, so the placeholder shown while the month is read is as high
   as the line that replaces it. A month the rule does not judge (the first days,
   too few expected by today), an average and a figure that cannot be read have no
   pill. "Getting started" stays the card's and the page's: a row's read carries no
   flag for the quiet days and adding one is a server change. A goal with several
   subjects keeps "3 subjects · 2 below pace" as words (it has several paces, a pill
   is one), and the attention band's "Portal goal below pace" chip and the
   Properties list keep their words.

## Amended 2026-11-01 — the page, the card and the results are a check-in

The Google rating goal's tracking became a check-in the same day (ADR 0067, amended
2026-11-01: the owner found the progress screens poor), and the Monthly portal goal's
card, page and results page follow it. This changes how they are drawn and what they
say, and nothing else: the numbers, the counts' rule (P-1), the pace (decision 7),
the month-start check-in, the sheets, the notices and the reads are untouched. It
replaces the signature visuals (item 3) and the page's order and tiles (item 7) of
the 2026-10-19 amendment, and the table of decision 14.

1. **One ruler, with a steady stop that says what it is.** The card and the top of
   the page draw how far along the month is on the shared ruler (`goal-ruler.tsx`,
   the Google rating goal's too): from none on the month's first day to the month's
   number, "23 so far" at the place the month stands and, after the first quiet days
   and until the number is passed, one stop labelled "steady pace" where a steady
   month would stand today. The meter's tick and axis and the "November so far"
   section are gone. Under the headline ("17 private ratings to 40") the days line
   now says what a day takes: "9 days left in November. About 2 a day gets you
   there." ("Under 1 a day" when it is less); the pace itself stays the pill's word.
2. **The page is where it stands, then three questions.** What is left, the days
   left and the ruler come first, in a card of their own (a stopped goal's notice
   above it). Then the bands Guest voice, Portal Results and the Google rating
   goal's page use, each with its answer first: "Where are they coming from?" (each
   Portal's count in name order, "Other portals" when the rest brought something in,
   and the total), "How does this month compare?" (each month as a bar against its
   own number from the second month; what the Property usually gets in a month; and,
   from the seventh day, where the month would end at its pace so far) and "What can
   you do this week?" (rows: check the code of a Portal gone quiet, open your
   portals, change the number). "What changed" and "How this goal counts" are one
   closed card each, closed until asked; "What changed" is still the region of that
   name, with "Show all" after twelve. The tiles ("Your goal, so far"), "Month by
   month" and the line "Private ratings from all 3 portals at …" are gone from this
   page. A goal for one Portal or group has the same page without the first band.
3. **It never names a winner (P-1 stands).** The first band answers how many Portals
   are bringing ratings in ("All 3 portals are bringing them in", "From 2 of your 3
   portals") and the one Portal it names is one that has gone quiet, with the fact
   the read already had and the way to its code. Counts stay plain numbers in name
   order with no bar, share or rank, and are listed only when they add up to the
   month's figure. On the card the list "From your portals" is drawn at every width;
   the narrow card's one line is gone.
4. **Results are one chart and one list.** `/goals/portal-results` has a card for
   each goal, titled by its name (and, for a goal of one Portal or group, whom it
   counted), a bar chart of its months against their own numbers once it has two
   counted months (an average has none), and a row for each month, newest first, in
   a manager's words: "41 of 40" with Met, Missed by 4, Still counting, The final
   figure is on its way, More ratings needed: 6 of 10 or No result for this month.
   The audit fields are one tap away on the row: the day the figure was counted
   through, the number and when it was set, who changed the month's own number, a
   correction. The matrix is still what decides every figure; the table, its five
   columns and its "Monthly results" heading are gone, and the ended Portal goals
   below it are as they were.
5. **The average goal's page waits.** It keeps its tiles and its month strip for
   now; only its change log became the closed "What changed" card, which every goal
   page shares.
6. **Shared parts, still neutral.** The ruler, the bars (`goal-columns.tsx`), the
   whole-row actions (`goal-action-row.tsx`), the card that says where a goal
   stands and the card that is closed until asked (`GoalWhere`, `GoalClosedCard`)
   are `goal-*` modules like the other design parts: they say no product word,
   import no `rating-goal-*` or `portal-goal-*` module and no server context, and
   each goal passes in its own words. Names, notices, calendar months against
   Monday-to-Sunday weeks and every number stay apart (decision 13).

## Rejected alternatives

- **A goal per Portal by default** (direction A). Each Portal's goal becomes the
  person's quota where one person runs an outlet, and a fixed starter number
  would read "Not met" everywhere in the first month.
- **An own-usual monitor with an optional target** (direction B). It replaces
  the goal with a second monitoring product beside Portals and Results, and one
  card would show two numbers that can disagree.
- **An early estimate after 7 days.** False precision from one week of data.
- **Automatic roll-forward or raises.** A month's number changes only when a
  manager chooses.
- **A server lock for one goal per Property** (an advisory lock, a domain or a
  database rule). The proposal dropped a new server guard and the owner approved
  that; the remaining race is monitored instead.

## Related

[ADR 0041](0041-governed-metric-registry.md) (the registry and the versions the
recommendation reads), [ADR 0046](0046-notification-policy.md) (Goal notices and
categories), [ADR 0049](0049-beta-local-acceptance.md) (rule 2),
[ADR 0066](0066-goal-months-carry-their-own-target.md) (a month's own target),
[ADR 0067](0067-property-google-rating-goal.md) (the Property Google rating goal).

## Amendment 2026-11-01 — staff accounts and personal Portals

[ADR 0076](0076-staff-accounts-and-personal-portals.md) amends this decision.

“No staff goal” gains one exception: a scan target on a person's personal Portal or a Portal Group holding one. It counts `qualified_scans` only, never a rating, Google fact or click. `STAFF_SCAN_TARGETS_ENABLED` defaults off; off, no new personal target can be set and staff see none. Person and Team subjects remain absent from Goal Programs; the subject is still a Portal or Portal Group. There is no leaderboard, badge, reward or automatic consequence. The Property Google rating goal remains manager-only and is never split across people.
