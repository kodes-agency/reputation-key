# Notifications — UX review and redesign proposal

Status: **proposal, awaiting owner decisions** (2026-09-29). Nothing in product
code changes on this branch; the prototypes are story-only files.

- Prototypes: Storybook › `Design/Notification redesign` and
  `Design/Notification settings redesign`
  (`src/components/features/notification/notification-redesign.stories*.ts(x)`,
  `src/components/features/settings/notifications-settings-redesign.stories.tsx`).
  They render real copy through `renderNotification` and pass the repo's axe
  gate (`pnpm test:storybook`).
- Screenshots: `shots/current-*` (main at 676dd4494) and `shots/proposed-*`.

## 1. What is wrong today

### The bell and the page are cluttered

| #   | Finding                                                                                                                                                                                                                                                                                       | Evidence                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| C1  | Every row is a card with its own filled violet button, so every visible row is a call to action; DESIGN.md's One Accent Rule keeps violet to 10% of a screen. The button repeats what clicking the notification should do anyway.                                                             | `notification-row.tsx` (`Button variant={isUnread ? 'default' : 'outline'}`) |
| C2  | Rows are ~125 px tall: icon, dot, title, Urgent pill, time, body, stars, button, ⋯ and ×. The bell shows **2½ rows** on desktop and 3 on a phone.                                                                                                                                             | `shots/current-bell-open.jpg`, `current-bell-phone.jpg`                      |
| C3  | Most bodies only restate the title ("Open it to read the review and reply."). Payloads are content-free by policy (ADR 0046 r.8), so for ~14 types there is nothing else to say — the line is pure height.                                                                                    | `notification-templates.ts` renderers                                        |
| C4  | Seven filter tabs (All, Unread, Urgent, Account, Action, Workflow, Goals) wrap onto two lines in a 384 px popover and on a phone. Account and Goals are nearly always empty; Urgent and Action overlap. The tabs expose the internal category taxonomy instead of a question the reader asks. | `notification-filters.ts:29-37`                                              |
| C5  | Unread is said three ways (dot, bold, raised card); urgent adds a red pill. Red pill + violet dot + violet button compete in every row.                                                                                                                                                       | `notification-row.tsx`                                                       |
| C6  | The Property is repeated in every title, even under a Property group heading on the page ("Riverside Hotel" › "Escalated: feedback at Riverside Hotel").                                                                                                                                      | `current-page.jpg`                                                           |
| C7  | Separate arrivals of the same kind are listed one by one (three "New review at Harbour View Suites"). The server only coalesces repeats of one item.                                                                                                                                          | `current-bell-phone.jpg`                                                     |
| C8  | Two dismiss controls per row (× and the menu).                                                                                                                                                                                                                                                | `notification-row.tsx:161-170`, `notification-row-menu.tsx:77-80`            |
| C9  | The page stretches rows across 1440 px (title and time ~1100 px apart), groups by Property in first-seen order, and "Load more" drops older rows into groups higher up. It is not in the navigation.                                                                                          | `notification-filters.ts:122-151`, `manager-nav-items.tsx`                   |
| C10 | Settled rows contradict themselves: "Approve a reply" + "Done", a warning triangle, a "Review reply" button, and a menu still offering "Mark as read".                                                                                                                                        | `current-row-settled.jpg`, `notification-row-menu.tsx:42`                    |
| C11 | Icons don't carry meaning: speech bubble for 7 types, warning triangle for 6 (including "Approve a reply"), all grey.                                                                                                                                                                         | `notification-utils.ts:119-160`                                              |

### The preferences page is heavy

| #   | Finding                                                                                                                                                                                                                               | Evidence                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| P1  | Four stacked cards mix scopes: a Property picker at the top, then two personal cards (timezone, quiet hours — with a per-Property override inside), then the per-Property categories. The picker is far from the section it controls. | `notifications-settings-view.tsx`          |
| P2  | Three save models on one page: "Save formatting", "Save quiet hours", and toggles that save instantly.                                                                                                                                | `current-settings.jpg`                     |
| P3  | Everything is configured per Property; "Apply to all my properties" appears three times, and nothing summarises which properties differ.                                                                                              | `notifications-category-row.tsx`           |
| P4  | Implementation copy: "Email is evaluated again against this property, your preferences, and current policy before every provider call."                                                                                               | `notifications-settings-view.tsx`          |
| P5  | Controls that never do anything: in-app "Always on" switch, fixed Goals cadence, and — where the beta email switch is off — every email control plus "Daily at 08:00".                                                                | `notifications-category-row.tsx:53-97,232` |

### Partly built

| #   | Gap                                                                                                                                                              | Evidence                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| G1  | **"Apply to all my properties" silently deletes per-Property rows — including mutes made from the bell.** Deliberate in the server, invisible to the user.       | `src/contexts/feed/build.ts` ("the rows that would have overridden it go") |
| G2  | No undo for dismiss, dismiss all or mute, and no place to see dismissed or muted items. The mute toast only links to settings.                                   | `notification-mutations.ts:196-213`                                        |
| G3  | The daily digest exists only as email; organizations without beta email see "Daily at 08:00" that never sends, and quiet hours stay editable where email is off. | `digest-email.tsx`, `bootstrap.ts:828`                                     |
| G4  | New urgent items arrive by 30 s polling with no visible cue (the announcement is screen-reader only); the badge caps at 9+.                                      | `notification-feed-pagination.ts:12-17`                                    |
| G5  | Account notices (role changed, access removed, purge pending) link to `/settings/profile`, which shows none of that.                                             | `notification-templates.ts:956`                                            |
| G6  | One category, two names: "Account and safety" (settings) vs "Account and security" (page group).                                                                 | `notifications-type-rows.ts:17`, `notification-filters.ts:105`             |
| G7  | Phones get the desktop popover; the Updates the bell can't fit are one "View all" away, and the page isn't in the nav.                                           | `notification-panel.tsx:167`                                               |

## 2. Directions

All three share one row design: **the whole row is the link**, no per-row
button, one facts line (Property · ★ · waited · ×3 · Target passed), compact
time, icon tinted by what the row asks (red = critical, white = needs you,
grey = news, green check = done), and the ⋯ menu revealed on hover/focus
(always visible on touch).

### A — Refined list (smallest change)

`shots/proposed-a-bell.jpg`. Keep one chronological list; date groups
(Today / Yesterday / Earlier this week); filters reduced to All / Unread;
mark-all-read and preferences behind ⋯. Fixes the clutter; keeps the bell a
second, weaker Inbox. **Effort: S**, UI only.

### B — Needs you / Updates (recommended)

`shots/proposed-b-bell.jpg`, `proposed-b-page.jpg`, `proposed-b-phone.jpg`,
`proposed-b-caughtup.jpg`. The bell answers "what do I have to do?" before
"what happened?":

- **Needs you** — the domain's `ACTIONABLE_NOTIFICATION_TYPES` still waiting,
  sorted target passed → urgent → newest; same-kind arrivals stack
  ("3 new reviews").
- **Updates** — outcomes and news (approved, published, goals, notes, import
  finished) and settled items with a green check; collapsible, stacked.
- The badge counts only Needs you.
- Page: tabs Needs you / Updates / All + a Property filter, 768 px column,
  date groups.

The domain already separates work from news (the actionable set, `resolvedAt`
settlement); today's UI is the only layer that doesn't. **Effort: M** —
a `needs_you` list filter so paging stays correct, the feed head's count, a
template flag for bodies that only restate the title, client stacking.

### C — By property

`shots/proposed-c-bell.jpg`. One block per Property with its waiting count and
"Open inbox". Suits a manager of many properties, but an overdue item at the
seventh property sits below the fold. **Effort: M.** Recommended only as the
page's Property filter inside B.

### Preferences — your setup, plus exceptions

`shots/proposed-s-settings.jpg`, `proposed-s-exception.jpg`,
`proposed-s-phone.jpg`. One matrix (category × in the app / email), with
cadence folded into the email choice (Off / Right away / Daily at 08:00);
quiet hours as one row; **Property exceptions** listed with a one-line summary
and an editor that marks cells still on "Default"; autosave with one "Saved"
mark; timezone and date format become one line linking to Profile. The backend
already stores personal defaults (ADR 0046, 2026-09-23) and per-Property rows,
so this is mostly UI — plus one semantic change: **changing a default must keep
exceptions** (today it deletes them, G1); "Remove exception" is the explicit
reset. **Effort: M.**

## 3. Quick wins (any direction)

1. Make the row the link; remove the per-row filled button and the × (dismiss stays in ⋯).
2. Stop rendering bodies that only restate the title.
3. Filters: All / Unread (plus Needs you under B).
4. Settled rows: green check, "Done" in the facts line, no warning icon, correct menu.
5. Undo in a toast for dismiss and mute.
6. Warn before "Apply to all" removes property-specific settings (G1), or stop it removing them.
7. Page: 768 px column, date groups.
8. One name for the Account category.
9. Hide — don't disable — email controls where email can't be sent.

## 4. Owner decisions

1. Direction: A, **B (recommended)**, or C?
2. Badge: count only Needs you (recommended), or every unread row?
3. Does "Assigned to you" need its reader? It isn't actionable today, so it never settles.
4. Should arrivals (new review, new feedback) reach the bell by default, given the Inbox is the queue? Option: arrivals off in-app by default, escalations and low ratings on.
5. Stacking: may "3 new reviews" open the Property's Inbox queue instead of each item?
6. Move timezone and date format to Profile?
7. Changing a default keeps exceptions (recommended) — or keep today's "apply to all resets"?
8. Phones: open the bell as a full-screen sheet?
9. A visible cue for urgent arrivals (toast or tab-title count)?

### Answers (owner, 2026-09-29)

| #   | Answer                                                                 |
| --- | ---------------------------------------------------------------------- |
| D1  | **B** — Needs you / Updates                                            |
| D2  | Badge counts **Needs you** only                                        |
| D3  | Open — proposed: yes, and it settles (see below)                       |
| D4  | Arrivals **off in the app by default**; escalations and low ratings on |
| D5  | Yes — a stack opens the Property's Inbox queue                         |
| D6  | Yes — timezone and date format move to Profile                         |
| D7  | Exceptions **stay** when a default changes                             |
| D8  | Yes — full-screen sheet on phones                                      |
| D9  | Maybe — a toast for urgent arrivals                                    |

**D3 proposal.** "Assigned to you" joins Needs you and settles when the item's
handling cycle closes, when its Property is archived, or — for the previous
holder only — when the item is reassigned. A bulk assignment settles once none
of its items is still open (the rule `grouped-reopen-settlement.ts` already
applies to bulk reopens). For a reader who also got the arrival for the same
item, the assignment replaces the arrival row.

**D4 follow-up.** Google/provider ratings are forbidden in notification
payloads (`notification-payload.ts:20`), so "low ratings on" can be decided
from the payload only for Portal feedback. Low-rated Google reviews need the
decision made at fan-out, from the Inbox's rating, without storing it.

## 5. Constraints for the build

- **Bundle budget.** The bell renders in the first-paint closure and Tailwind
  emits one global stylesheet, so any new utility class costs first-paint CSS
  (≈514 B headroom after #593). Prefer classes the stylesheet already has.
- **Content-free payloads** (ADR 0046 r.8): rows show facts, never review text
  or names.
- **Keep the existing accessibility behaviour** the current stories encode:
  focus lands on the list when the bell opens, focus recovery when a row is
  removed, manual tab activation, busy-not-disabled "Load more", named dialog.
