# Inbox detail panel — analysis and directions

Status: **direction chosen, plan proposed**, 2026-09-12. Direction A was
picked from the design canvas linked from the PR; nothing is implemented yet.

## Scope

The third panel of `/inbox` and `/properties/$propertyId/reviews`: the detail
pane rendered by `src/components/inbox/inbox-detail-panel.tsx` (desktop) and
`inbox-detail-sheet.tsx` (mobile), whose body is `inbox-detail-content.tsx`.
The folder sidebar and the list are out of scope, except where the detail must
agree with them.

## How it was surveyed

Storybook stories `Pages/Inbox`, `Inbox/Detail Content`, `Inbox/ReplyCompose`,
`Inbox/ReplyEditorActions` and `Inbox/Notes Thread`, dark and light, at 1440 px
(pane at its default 50 %, ≈720 px) and at 720 px alone. Every component under
`src/components/inbox/` that the pane renders was read alongside.

## What the panel has to do

A manager opens an item to do four things, in this order:

1. **Read** — who, which property, rating, when, what they said.
2. **Judge** — is it urgent, what is it about, is a reply owed and by when,
   who owns it.
3. **Act** — draft and submit a public reply (or mark private feedback
   handled), leave an internal note, escalate, assign.
4. **Track** — where the reply is in its lifecycle, what has happened so far.

The panel contains everything those steps need. The problem is that the pieces
are laid out by component origin, not by that order, and each piece brought its
own visual grammar.

## Findings

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                            | Where                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Six section grammars in one column.** Header badge; a full `Card` with title, badge, description and body (response target); a bordered section with an icon-in-a-circle band (feedback handling); a tab strip (reply / note); `border-t` + `h2` + badge (every reply view); a `Collapsible` (activity). Each was reasonable alone; stacked they read as six unrelated widgets.                                  | `inbox-detail-content.tsx`, `response-target-card.tsx`, `feedback-handling-card.tsx`, `reply-editor-views.tsx`, `inbox-activity-timeline.tsx` |
| 2   | **Case state is scattered.** Status is a badge when open and a `Select` when closed. The reply deadline is a mid-page card whose body is two sentences of policy prose (“Timing starts from the saved Google publication, meaningful review update, or reopen time for this cycle.”). Assignment does not appear in the detail at all (only in bulk actions). Escalation is a header button.                       | `inbox-detail-manager-actions.tsx`, `response-target-presentation.ts`                                                                         |
| 3   | **The empty composer carries four pieces of explanation.** The “Property reply language not set” alert, “AI drafting is recommended because this review has enough specific text.”, the `n/4096` counter and “Google will receive this reply in English. Nothing is published automatically.” are all visible before a word is typed. The dashboard redesign removed exactly this kind of provenance text (row 8). | `reply-editor-compose.tsx`, `reply-suggestion-controls.tsx`, `reply-composer-footer.tsx`, `reply-language-readiness.tsx`                      |
| 4   | **Two purple buttons compete.** The “recommended” drafting path (`Draft with AI` or `Load template`) renders as `variant="default"`, the same weight as `Submit for approval`. The one-accent rule in `DESIGN.md` says one.                                                                                                                                                                                        | `reply-suggestion-controls.tsx`                                                                                                               |
| 5   | **The reply changes shape with every lifecycle state.** Draft, pending, approved, mirror, published, failed-check, failed-retry and rejected are eight branches over seven components, each with its own heading, badge placement and action row. The list row already summarises the reply with one chip; the detail does not echo it.                                                                            | `reply-status-view.tsx`, `reply-editor-actions.tsx`, `reply-editor-views.tsx`                                                                 |
| 6   | **Vocabulary differs from the dashboard.** The analysis chips say `Service · Negative`, `Mixed sentiment`, `High attention`; the dashboard settled on Topics, Praise / Complaints, Needs attention (row 11).                                                                                                                                                                                                       | `inbox-review-analysis.tsx`                                                                                                                   |
| 7   | **Notes hide behind a tab while a reply is being written; activity is folded at the bottom.** The two things a manager consults while drafting are the least visible.                                                                                                                                                                                                                                              | `inbox-detail-content.tsx`                                                                                                                    |
| 8   | **Purple stars.** `RatingStars` fills with `chart-1` (purple). The dashboard reserved purple for interactive elements and kept stars amber (row 10).                                                                                                                                                                                                                                                               | `inbox-detail-helpers.tsx`, `inbox-list-v2.tsx`                                                                                               |
| 9   | **Line length.** Review and reply text run the full ≈670 px pane at 15 px, ≈110 characters a line; `DESIGN.md` asks for 65–75 ch where prose is present.                                                                                                                                                                                                                                                           | `inbox-detail-source-content.tsx`                                                                                                             |

## Directions (on the canvas)

**A · Thread + case strip — recommended.** The review, the reply, internal
notes and activity are messages in one thread, oldest first; the composer is
pinned to the bottom of the pane like any inbox. Status, reply-due and assignee
form one 44 px strip under the header, so the response-target card and its
prose disappear; the due chip has five moods (in time · soon · overdue · replied
on time · not measured). The reply is always the same message with a state chip
and its actions beneath it, from “Awaiting approval” to “Live on Google”. Only
Submit is purple. Trade-off: a pinned composer takes about 260 px of every
viewport.

**B · Case rail.** Reading and writing on the left, a 216 px case file on the
right: status, due with a progress bar, assignee, escalation, topics, language,
activity. Nothing about the case is below the fold. Trade-off: at the default
50 % pane the reading column is ≈480 px, and under ≈900 px the rail must collapse
into A’s strip anyway, so it is two layouts to keep.

**C · Stepper-led.** The panel is the workflow: Read → Respond → Wrap up, with a
three-step strip (Draft · Approval · Live on Google) that makes the approval
model legible. Trade-off: rejections and Google failures are loops, not steps,
and Google-mirrored replies skip it entirely.

## Changes that apply whichever direction is picked

- One section grammar. No `Card` inside the pane; sections separate with
  24 px of space or a single 1 px rule.
- Case state in one place, always the same shape, for open and closed items.
- Explanations render by exception: the language alert only when the property
  default is unset and only once per composer, the “recommended because”
  sentence never (the recommended control comes first instead), the
  “nothing is published automatically” line folded into the save state
  (“Draft saved · publishes only after approval”).
- One primary button in the composer.
- Topic chips use the dashboard vocabulary and the green/red-with-sign rule.
- Stars amber; purple only on interactive elements.
- Prose at `max-width: 62ch`.
- Feedback items: “Feedback handling” becomes the same case strip with a
  “Mark as handled” primary in the composer slot; no separate card.

## Decisions

Direction **A · Thread + case strip** was chosen on 2026-09-12. Every PR
description cites a row number here. Nothing in this table is re-litigated in
review; a disagreement amends the row first.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Anatomy.** The pane is four fixed regions, top to bottom: **header** (56 px) · **case strip** (44 px) · **thread** (scrolls) · **composer** (pinned to the bottom, never scrolls away). The mobile sheet has the same four regions. No `Card` anywhere inside the pane; sections separate with space or one 1 px rule. Partly superseded 2026-09-13 by docs/plan/inbox-detail-v2.md row 1: the case strip became the 48 px case toolbar (`min-h-12`, `inbox-case-toolbar.tsx:442`); the 56 px header stands (`inbox-detail-header.tsx:65`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | **Header** carries context and item-level actions only: property name · platform on the left; `Escalate` / `Resolve`, the overflow menu (copy review, copy translation) and close on the right. The guest's identity leaves the header and becomes the first message of the thread. Amended 2026-09-12 (PR 6): "close on the right" is the DESKTOP panel only. The mobile sheet is `w-full` below `sm`, so there is no overlay left to tap and no Escape key, and opening an item pushed a history entry — leaving is going BACK. The sheet passes `dismiss="back"`: an `ArrowLeft` at the LEADING edge, named `Back to list`, aligned with the list's own drawer trigger. `InboxDetailHeader` takes `dismiss?: 'close' \| 'back'` and defaults to `close`, so the panel is unchanged. Nothing in the pane is ever named exactly `Close`. Superseded 2026-09-13 by docs/plan/inbox-detail-v2.md row 5. `Escalate` / `Resolve` moved from the header into the case toolbar (`inbox-case-toolbar.tsx:462`); the header keeps property · platform · copy menu · close or back, and the `back` dismissal above still holds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3   | **Case strip** is three chips in a fixed order, always present, same shape open or closed: **Status** (`Open` / `Closed`; on a closed item the chip opens a menu whose `Reopen` action shows the existing reopen dialog) · **Reply due** (row 4) · **Assignee** (`Unassigned` or the person's name; a menu of `assignmentOptions`, wiring `assignInboxItemFn`, which the server already exposes but the pane never consumed). An escalated item adds a fourth chip, `Escalated`. Assignment follows `assign-inbox-item.ts`: `inbox.write` may self-assign or clear their own assignment, `inbox.manage` may assign anyone; the menu offers exactly what the caller may do, and read-only viewers see the chip without a menu. Superseded 2026-09-13 by docs/plan/inbox-detail-v2.md rows 2, 3, 4 and 5. The strip is a toolbar holding one `ButtonGroup` of status, owner and escalation, with facts as plain text rather than chips.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | **The reply-due chip has five moods** derived from `responseTarget.evaluation` and `dueAt`: `Reply due in 31 h` (neutral) · `Reply due in 6 h` (warning, under 12 h) · `Overdue by 2 d` (negative) · `Replied on time` / `Replied late` (positive / neutral, completed) · `Not measured` (tertiary, excluded or cancelled). Feedback items say `Handle within` instead of `Reply due in` (`Handle by 6 h` would read as a clock time, and the literal `Handle by` + `in 6 h` yields `Handle by in 6 h`). The existing sentences in `response-target-presentation.ts` move into the chip's popover with the exact due time and timezone; `response-target-card.tsx` is deleted. Amended 2026-09-12 (PR 6): all eleven description sentences did move verbatim into `response-target-chip.ts`, which left `response-target-presentation.ts` with no production caller and only its own test — so the MODULE is deleted too, not just the card. The two strings that did not move are the card's titles (`Google review response target`, `Private feedback handling target`); the chip's label replaces them. Superseded 2026-09-13 by docs/plan/inbox-detail-v2.md row 6. Reply due is a text detail, and `Not measured` is not rendered (`inbox-case-toolbar.tsx:286`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | **Thread** is one list of messages and events in time order: the guest's review first (avatar, name, stars, date, text at `max-width: 62ch`, Google translation behind a one-line disclosure, topic chips); then handling events as one-line rows (assigned, escalated, resolved, reopened, feedback outcome); internal notes as messages with a lock in the avatar slot; the property's reply as a message (row 6). Events and notes interleave by timestamp. Superseded 2026-09-13 by docs/plan/inbox-detail-v2.md rows 9, 10, 11, 12 and 13. One rail (`ui/timeline.tsx`), the review as its first node, actor-first event sentences, an amber note with its author's initials in place of the lock, and folded histories.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | **The reply is always one message with one shape**: property avatar, `Acme Hotel`, a state chip, a one-line meta (`Submitted by Grace Hopper · 25 min ago`), the text, and its actions underneath. The chip and actions map from `resolveReplyView`: `Awaiting approval` → Confirm & publish · Reject; `Waiting for Google` → Check Google now; `Live on Google` → Edit reply; `Not published` → Try again (amended 2026-09-12: the server refuses an edit unless the reply is published, so there is no edit path for a publish-failed reply); `Rejected` → Edit & resubmit; Google-mirrored → `Live on Google` with no actions. `Draft` never appears in the thread; it lives in the composer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | **Composer** = mode row (segmented `Reply` / `Note`, replacing the tabs; the language control as a ghost button on the right — amended 2026-09-12: the control renders on its own line at the TOP OF THE REPLY SLOT, not on the mode row. Its props (`value`, `options`, `disabled`, `onChange`) exist only inside `useReplyComposer`, which is mounted below the region inside the reply panel, so the node cannot be rendered as the mode row's sibling without either the toolbar portal this PR deleted or hoisting the composer's whole draft state above the region — which would move the autosave lifecycle's reset semantics out of the item-keyed mount. The region's matching `toolbarSlot` prop and the empty flex cell that fed it are deleted rather than left claiming the layout; `reply-composer.stories.tsx` asserts where the control actually is) · text box with an internal toolbar (`Draft with AI ▾` tone, `Template ▾`, `Undo`; counter on the right) · footer (save state on the left, `Delete draft` ghost, `Submit for approval` as the **only** primary). The recommended drafting path is expressed by order (recommended control first) and its tooltip, never by colour or a sentence. `Note` mode reuses the same box and submits a note; notes stay visible in the thread while a reply is being written. Superseded 2026-09-13 by docs/plan/inbox-detail-v2.md rows 14, 15, 16, 17 and 18. One dock with a head row, `Reply` / `Note` labels, the save state in the head, the reply language inside the assist menus and a ghost `Reply language` control, and a result tag.                                                                                                                                                                                                                                                                                                                                  |
| 8   | **Explanations render by exception.** Removed from the resting composer: `AI drafting is recommended because…`, `A template is recommended because…`, and `Google will receive this reply in English. Nothing is published automatically.` The last folds into the save state: `Draft saved · publishes only after approval`. The `Property reply language not set` alert stays, once, above the box, only while the property default is unset. Blocked-submit reasons and errors still render under the footer as today. Partly superseded 2026-09-13 by docs/plan/inbox-detail-v2.md rows 14, 16 and 18: the save state reads `Saved` (`composer-mode-row.tsx:313`), the approval guarantee moved to the Submit tooltip and the success toast (`reply-composer-footer.tsx:36`, `use-reply-actions.ts:70`), and `Property reply language not set` is a menu row, never an alert above the box (`reply-assist-menu-parts.tsx:162`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | **Editing states enter the composer, not the thread.** `Edit & resubmit` on a rejected reply and `Edit reply` on a live one load the text into the composer. Amended 2026-09-13 (PR 6): everything this row said after that clause is the PUBLISHED path only. `Edit reply` raises an edit target, and the target is what renders the one-line band (`Editing a live reply · republishes to Google`), swaps the primary to `Review update`, and leaves the `Live on Google` message visible above it — all three measured in a real browser at 1440 px. `Edit & resubmit` raises no target at all: it is a `draftReplyFn` round trip, and `useActionMutation` awaits the write-through that patches the detail cache to `status: 'draft'` before `mutateAsync` resolves, so the reply has already re-resolved to `compose` by the time the click's own `.then` runs. The rejected path therefore lands on a SEEDED DRAFT, not on an edit: no band renders, the primary is the draft's own `Submit for approval` and never `Review update`, and the thread message unmounts — chip, meta and rejection reason with it — because a draft never appears in the thread (row 6). What the manager is left holding is the refused text in the composer and the caret the unmounted button dropped. `ReplyEditTarget` has no `'rejected'` member; the branch was unreachable and a story can no longer type it. The reason that message takes with it is not acceptable and is not papered over here — it is open question 3. The AI suggestion preview (a personalised or local draft awaiting adoption) renders as the `AI draft` band inside the box with `Use draft` / `Dismiss`, as today.                                                                                                                                                                                                                                                         |
| 10  | **Feedback items** use the same anatomy: the guest message shows the rating and comment; the composer has only `Note` mode plus `Mark as handled` as its primary; the strip's status chip reads `Needs attention` / `Handled · <outcome>` / `Closed — no outcome` (amended 2026-09-12: a withdrawn or source-ineligible cycle can never record a manager outcome, so `Handled` would claim a judgement that never happened); the outcome and any correction appear as events in the thread. `feedback-handling-card.tsx` and its icon band are deleted; the dialog and submit logic stay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 11  | **Topic chips** use the dashboard vocabulary and colour rule (dashboard rows 10–11): `Service · Complaint` in negative tone with a down arrow, `Room · Praise` in positive tone with an up arrow, `Needs attention` in the list row's urgent style for `urgent` and `high`. The sentiment chip is dropped (the polarity chips carry it). `none` / `unavailable` keep their one-line text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 12  | **Stars are amber** in the pane and in the list row; purple stays interactive-only. Amended 2026-09-12 (PR 6): what is shared is the TOKEN, not the component — `STAR_FILLED_CLASS` in `inbox-detail-helpers.tsx`. The pane's `RatingStars` draws five stars filled or empty; the list row's `CompactRating` draws one filled star and a number, so it has no empty state to tone and imports the filled class alone. One `RatingStars` in both places would have put five stars in a list row with no room for them. Partly superseded 2026-09-13 by docs/plan/inbox-detail-v2.md row 7: `RatingStars` is deleted (`inbox-detail-helpers.tsx:3`); the pane draws `ui/star-rating.tsx` with `tone="rating"` (`guest-message.tsx:210`), and `STAR_FILLED_CLASS` survives for `CompactRating` alone (`inbox-list-v2.tsx:9`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 13  | **Events come from Handling History**, not the activity feed: the thread reads `getInboxItemHistoryFn` (already in `InboxServerFns`, consumed by nothing today). Its five kinds map to rows: `cycle_opened` → `Opened from Google` / `Reopened` · `cycle_transition` → `Closed` (with reason) · `assignment` · `escalation` (raised / resolved) · `handling_outcome`. The feed-backed `inbox-activity-timeline.tsx` and `inbox-timeline-helpers.tsx` leave the pane. `truncated: true` renders one end-agnostic line at the foot of the stream, `Not all handling history is shown` — the sources are read `ASC LIMIT 200`, so truncation drops the newest rows, not the oldest. Reply lifecycle events are not duplicated as rows; the reply message carries them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 14  | **Reply vocabulary** in `reply-state-copy.ts` becomes sentence case and matches the chips, for the list row too: `Awaiting approval` · `Waiting for Google` (approved / requested / authorized / sending) · `Live on Google` (published) · `Not published` (publish_failed) · `Rejected`. Descriptions move into the chip popover.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15  | **Mobile (390 px).** The sheet keeps the four regions; the case strip scrolls horizontally; the composer opens collapsed as a `Reply…` bar with the mode toggle and expands on demand. Every target ≥ 44 px. 390 px stories are part of the gate. Amended 2026-09-12 (PR 6), three corrections, all measured in a real Tailwind build. (a) **Not one 44 px row.** At 390 px the segment alone is 291 px with its labels, leaving ~50 px for the bar, so the row WRAPS and the collapsed region is 133 px — two 44 px rows. One row only from ≈520 px of region width up. Wrapping beat the alternatives: truncating `Reply…` to `Repl…`, or an unlabelled lock-and-speech-bubble toggle deciding public-vs-internal. The win is the same either way — region 4 goes 506 px (the `max-h-[60%]` cap, spent in full on an EMPTY composer) to 133, and the thread 237 to 610. (b) **Not "on focus".** It expands on a TAP of the bar or of either half of the segment; focus is what KEEPS an open region open (a `focusin` latch), which is the opposite direction. Latching on the bar's own focus was a real bug — the browser focuses a button on `mousedown`, so the bar unmounted before `click` and the caret landed on `document.body`. (c) **Every target >= 44 px is now true and measured**, not asserted: 188 focusable controls across 20 pane states at 390x844, none under 44. It was not true when the row was written — `reply-message-actions.tsx` (7 buttons), `reply-language-select.tsx`, `reply-language-readiness.tsx`, `inbox-detail-copy-menu.tsx` and the publish confirmation were 24-40 px. The storybook runner compiles no Tailwind, so this is NOT gateable from a story; the evidence is the harness under the PR 6 scratchpad. Superseded 2026-09-13 by docs/plan/inbox-detail-v2.md row 20. Controls are 36 px below `md`, not 44, and the case toolbar wraps instead of scrolling (`inbox-case-toolbar.tsx:442`). |
| 16  | **Structure only** — same tokens, type, radii, surfaces, the existing `Button`, `Badge`, `DropdownMenu`, `Popover`, `Select` primitives. Chips are `Badge` with `rounded-full`, 26 px tall. A look refresh is a separate phase. Amended 2026-09-12 (PR 6): 26 px is the height from `md` up. Row 15's 44 px touch target outranks it below `md`, so every strip chip carries `max-md:h-11` and measures 44 px on a phone (`INBOX_CHIP_TRIGGER_CLASS`). Measured at 767 vs 768 px: the treatment switches off exactly at the breakpoint, so the desktop density this row is about is unchanged. Superseded 2026-09-13 by docs/plan/inbox-detail-v2.md rows 2, 9, 19, 20 and 21. Nothing in the toolbar is a pill (`INBOX_CHIP_TRIGGER_CLASS` is deleted), four `--warn` tokens are new in `styles.css`, toolbar controls are 36 px below `md`, and `ui/timeline.tsx` and `ui/kbd.tsx` are new primitives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 17  | **Keyboard shortcuts** in `use-inbox-keyboard-shortcuts.ts` keep working (`r` focuses the composer in Reply mode, `n` in Note mode, `e` escalates); the e2e triage journey is updated in the same PR that changes a selector, never later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 18  | Six PRs in dependency order (below), each auto-merging on green. PRs 4 and 5 may run in parallel after PR 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Delivery plan

Each PR is one region of the anatomy and leaves the pane shippable. Line
budgets from `coding-style.md` apply (files under 400 lines, functions under
50); the inbox already trips this, so every new file lists its owner concern.

### PR 1 — Case strip and header (rows 2, 3, 4, 12)

- New `inbox-case-strip.tsx` (chips + menus), `response-target-chip.ts`
  (mood, label and popover copy from `ResponseTargetView`; pure, unit-tested),
  `inbox-assignee-chip.tsx` (shipped under that name: it is the chip AND its
  menu, and a menu-only file would have left the chip homeless).
- `InboxServerFns` and `routes/_authenticated/-inbox-fns.ts` gain
  `assignInboxItem`; `use-inbox-detail.ts` gains the mutation with the same
  revision-fence handling as `escalate`.
- `inbox-detail-header.tsx` loses the status badge/select; the guest identity
  is not moved yet (PR 2), so the header keeps the property line only.
- Delete `response-target-card.tsx`; `inbox-detail-manager-actions.tsx` keeps
  only escalation; the reopen dialog is opened from the status chip.
- `RatingStars` and `CompactRating` go amber (one helper).
- Stories: `Inbox/Case Strip` × {open · closed · escalated · due soon ·
  overdue · replied on time · not measured · member view} and the
  `Inbox/Detail Content` set re-rendered. Unit tests for
  `response-target-chip.ts`. e2e `inbox-triage.spec.ts`: `Work status`
  combobox → status chip menu.

### PR 2 — Thread (rows 5, 11, 13)

- New `inbox-thread.tsx` (ordering and interleaving; pure `buildThread()` in
  `inbox-thread-model.ts`, unit-tested), `guest-message.tsx`,
  `note-message.tsx`, `history-event-row.tsx`, `topic-chips.tsx`.
- `inbox-detail-content.tsx` renders header → strip → thread → composer slot;
  `inbox-detail-source-content.tsx` folds into `guest-message.tsx`.
- Wire `getInboxItemHistory` through `InboxDetailFns`; remove
  `inbox-activity-timeline.tsx` and `inbox-timeline-helpers.tsx` from the
  pane (delete if nothing else imports them).
- `inbox-review-analysis.tsx` → `topic-chips.tsx` with the dashboard
  vocabulary; `inbox-notes-thread.tsx` keeps only its form (consumed by PR 4)
  and its list becomes note messages.
- Stories: thread × {review only · with events · with notes · truncated
  history · translation · content expired}. e2e: `Internal note` tab and
  `Add Note` selectors move to the composer (PR 4 finalises them; PR 2 keeps
  the old form mounted below the thread so the journey stays green).

### PR 3 — Reply message (rows 6, 14)

- New `reply-message.tsx` with a chip/actions map keyed by
  `resolveReplyView`; the read-only halves of `reply-editor-actions.tsx` are
  deleted (the whole file went, with its stories); the confirm and reject
  dialogs move with their actions. Amended 2026-09-12 (PR 6):
  `reply-editor-views.tsx` is NOT deleted. Its read-only views went, but it
  still owns the one editor a live reply opens (`ReviewReplyPublishedEditor`)
  and `useEditorOpenFocus`; those belong to the composer, not the thread.
- `reply-state-copy.ts` vocabulary update; list-row chip labels follow.
- Stories: `Inbox/Reply Message` × the six states, and the list row with the
  new labels. Unit tests for the chip map and the copy table.

### PR 4 — Composer (rows 7, 8, 9)

- New `reply-composer.tsx` (mode row, box, footer) replacing the `Tabs` in
  `inbox-detail-content.tsx`; `reply-editor-compose.tsx` keeps
  `useReplyComposer` and the toolbar, loses the explanation sentences and the
  recommended-variant colouring; `reply-composer-footer.tsx` folds the lock
  line into the save state; `reply-toolbar-slot.tsx` (portal) is deleted.
- `Note` mode submits through the form kept from `inbox-notes-thread.tsx`.
- Rejected and published-edit flows load into the composer with the band.
- Stories: composer × {empty · draft · AI draft · suggestion awaiting adoption
  · over limit · language unset · editing live reply · note mode}. e2e:
  final `Note` mode selectors; `r` / `n` shortcuts covered by a Storybook
  play test.

### PR 5 — Feedback items (row 10)

- `feedback-handling-card.tsx` deleted; `feedback-handling-body.tsx`,
  `-dialog.tsx`, `-submit.ts` stay; the strip's status chip and the composer's
  primary render the state; outcomes and corrections become thread events
  (from Handling History).
- Stories: feedback × {open · handled · corrected · withdrawn}.

### PR 6 — Mobile sheet, polish, evidence (rows 15, 17)

- `inbox-detail-sheet.tsx` adopts the four regions; collapsed composer bar;
  horizontally scrolling strip.
- 390 px stories for every state above; axe gate; keyboard-shortcut check.
- Before/after screenshot set from the local stack on **Hotel Elegance** (AI
  on, approval on) and **Urban Move** (AI off) — the screenshots are the
  review.

What actually shipped in PR 6, recorded 2026-09-12:

- The sheet's four regions, the `back` dismissal, `overscroll-x-contain` on
  the strip, and the 320 px header fix (the decorative glyph and the platform
  tag are `max-md:hidden`; without it the property name measured 0 px wide).
- The permanently-closed second `InboxDetailSheet` inside `InboxDetailPane`
  is deleted. `open={isMobile && …}` could never be true there — the mobile
  branch returns before that `Group` renders — so it made "the sheet"
  ambiguous and nothing else.
- `collapse` is wired into `inbox-detail-content.tsx`. It was built in PR 6
  and left unpassed, so row 15's headline behaviour was dormant on the
  product surface until the final gate; `inbox-mobile-390.stories.tsx` had
  pinned that gap as a story that fails when the prop lands.
- New `composer-policy.ts` + test: `offeredModes`, `liveEditTarget` and
  `hasPendingComposerWork` — region 4's three pure rules, out of the pane so
  they can be checked without rendering it. The collapse policy had no unit
  test before.
- **A shipped bug the region measurement found.** `ReplyStatusView` wrapped
  the composer in an unclassed `<div ref={composeRef}>`, needed only to hold
  the caret ref. A block box has `min-height: auto` and cannot shrink below
  its content, so it broke the flex chain PR 4 built: the composer's own
  scroller never absorbed anything and `Submit for approval` was pushed
  46–90 px BELOW the fold at 375 and 390 px whenever the language-readiness
  alert showed. `flex min-h-0 grow basis-auto flex-col` on that wrapper
  restores it; region 4's own scroll range is now 0 in every measured state.
- **Not done:** the before/after screenshot set. It needs the local Docker
  stack (`pnpm local:up`), which the gate session could not run. The
  geometry claims above are measured instead — real components, real
  compiled Tailwind, headless Chromium at 320/375/390/1440.
- **Known and out of scope:** `inbox-list-header.tsx`'s `Open folders`
  trigger is a 32 px target. It is the first control a manager touches on a
  phone and the one the new back arrow aligns with, but "Out of scope" below
  excludes the list panel, so it needs its own row rather than a quiet fix.
  `e2e/critical/accessibility.spec.ts` still registers the 44 px convention
  as unsupported-by-design; row 15 reverses that for this pane, so that
  entry is stale.

## Definition of done, per PR

- Storybook stories for each touched region across the states listed above ×
  {720 pane · 390}; `pnpm test:storybook` green (the `@storybook/addon-a11y`
  axe gate is the accessibility gate).
- `pnpm typecheck`, `pnpm lint`, and the unit suites for `src/components/inbox`
  and `src/contexts/inbox`.
- `e2e/critical/workflows/inbox-triage.spec.ts` and `review-inbox-slo.spec.ts`
  updated in the PR that changes a selector.
- No file under `src/components/inbox` grows past ESLint's `max-lines`, which
  is **300** with `skipBlankLines` and `skipComments` — not the 400 physical
  lines this bullet first said. Long explanatory comments are therefore free;
  code is not. Each deleted file is listed in the PR description.

## Out of scope

- The folder sidebar and the list panel, except the amber stars (row 12) and
  the reply chip labels (row 14).
- A visual refresh of tokens, type or surfaces (row 16).
- Bulk actions, the reopen dialog's content, the feedback handling dialog's
  content.
- Assignment permissions or the assignment model; only the pane's control.

## Open questions

1. Row 14 renames list-row chips too (`Queued for Google` → `Waiting for
Google`, `Publishing stopped` → `Not published`). Any dashboard copy that
   quotes these strings must change with them.

2. Row 10's `Mark as handled` is offered off the CURRENT cycle
   (`status === 'open'`), but `handling-outcome-authority.ts` refuses an
   outcome for any item that has EVER closed a cycle as `guest_withdrawn` or
   `source_ineligible`, and such an item can acquire a later open cycle.
   `FeedbackHandlingState` should carry that item-wide close-reason list,
   populated from `selectSourceUnavailableCloseReasons` — the same selector the
   write path already calls to refuse. With it the pane could drop the button
   for the sentence those states already have (`feedback-handling-body.tsx`)
   instead of opening a dialog whose outcome and internal note are discarded
   when the write transaction refuses. Until then the client mitigation is the
   narrow one: the refusable action no longer takes the composer region's only
   accent, so `Add note` stays primary beside it.

3. **Row 9's rejected path leaves the manager rewriting a reply without the
   reason it was refused for.** `Edit & resubmit` unmounts the thread message
   that was carrying the reason, and `draftReplyFn` writes
   `rejectionReason: null` onto the row in the same transaction
   (`reply-operations.ts:335`), so once the round trip lands the sentence the
   manager is rewriting to satisfy exists nowhere on screen and nowhere in the
   client's state: not in the composer, which is seeded with the text alone;
   not in the thread; and not in Handling History, which has no reply-lifecycle
   kind (row 13). The published path loses nothing, because its message stays.
   This is not new — `reply-rejected-edit.tsx` swapped the rejected view for
   the compose box in exactly the same way — but row 9's "the thread message
   stays visible above" was the clause that would have fixed it, and that
   clause turned out to be true of the published path only. It needs its own
   row rather than an amendment that quietly drops the promise.
   Smallest fix: the composer is the only surface left, so `reopenRejectedReply`
   — which already reads `detail.reply` before issuing the write — snapshots
   `rejectionReason` into the pane's `ReplyEditState` and region 4 renders it as
   a one-line band above the box (`Rejected: <reason>`), in the slot the
   live-edit band already occupies, item-fenced like the rest of that state and
   cleared when the draft is submitted or deleted. It has to be captured BEFORE
   the command; there is no reading it back afterwards. Not done in PR 6:
   `inbox-detail-content.tsx` is at 299 of ESLint's 300 counted lines, so the
   snapshot has to arrive with the extraction that carries it.
