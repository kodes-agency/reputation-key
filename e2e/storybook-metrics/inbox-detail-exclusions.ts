// What is under `src/components/inbox/` and deliberately NOT measured, each
// with the reason. `inbox-detail.metrics.ts` fails on any inbox story that is
// neither measured nor listed here, so every entry is a decision someone made
// and wrote down, never an omission. Every reason was read off a real-browser
// run against Storybook, not assumed.

/**
 * The races are STORY defects, found by this harness and reported rather than
 * fixed here (the story files belong to other PRs). Each play queries by role
 * synchronously straight after choosing a menu row: a `getByRole` for `Choose
 * a reply template` (`reply-assist-menus.stories.tsx:303`), for `Use draft`
 * after `Local safe template` (`reply-composer.stories.tsx:2074`,
 * `reply-editor-compose.stories.tsx` `LocalSafeMenuUsesCataloguePath`), or for
 * the reply textbox and `Use draft` after `Regenerate in Turkish`
 * (`reply-composer.stories.tsx:1972, :1977`, `reply-editor-compose.stories.tsx`
 * `AiDraftTagRegeneratesInTheOtherLanguage`). With Tailwind compiled, Radix
 * keeps the closing menu mounted for its `zoom-out-95` exit and its
 * `hideOthers` keeps `aria-hidden` on `#storybook-root` until then, so the
 * query finds nothing and the play throws. The Vitest project compiles no CSS,
 * so there is no exit animation to race — which is how these plays can be green
 * in that gate and throw here.
 *
 * Measured: the first six threw on three consecutive runs (one parallel, two
 * with `--workers=1`); under `reducedMotion: 'reduce'` 3 of 6 still threw, a
 * different three. The two `Inbox/ReplyCompose` stories threw at 320, 390 and
 * 1440. Nondeterministic, so neither side of the race can be gated. The fix
 * belongs in the stories: after choosing the row,
 * `await waitFor(() => expect(page().queryByRole('menu')).toBeNull())` (or a
 * `findByRole`), then move these ids into their groups.
 */
const MENU_EXIT_RACE =
  'play races the menu exit animation (Radix keeps aria-hidden on the root) and throws in a real browser; see the note above MENU_EXIT_RACE'

/**
 * The same kind of story defect on the way IN: the play asserts a row of a
 * menu it just opened is visible while Radix's entry animation is still
 * running, and jest-dom's `toBeVisible` reads the animating opacity. Measured
 * with `--repeat-each=10`: threw in 15 of 30 runs across 320, 390 and 1440 —
 * nondeterministic, so it cannot be gated either way until the play waits for
 * the animation (or asserts presence rather than visibility).
 */
const MENU_ENTRY_RACE =
  'play asserts a menu row visible during the menu entry animation; threw in 15 of 30 real-browser runs'

const RENDERS_NOTHING =
  'renders nothing: the story proves an absence, and there is no box to measure'

/** Stories measured nowhere, by id, and why. */
export const EXCLUDED_STORIES: Readonly<Record<string, string>> = {
  'inbox-detail-sheet--closed':
    'the sheet is closed: there is no pane on screen to measure',
  'inbox-composer-assist-menus--language-block-keeps-menu-reachable': MENU_EXIT_RACE,
  'inbox-composer-assist-menus--language-block-keeps-menu-reachable-390': MENU_EXIT_RACE,
  'inbox-replycomposer--ai-draft-tag-at-720': MENU_EXIT_RACE,
  'inbox-replycomposer--ai-draft-tag-at-390': MENU_EXIT_RACE,
  'inbox-replycomposer--local-safe-template-tag-at-720': MENU_EXIT_RACE,
  'inbox-replycomposer--local-safe-template-tag-at-390': MENU_EXIT_RACE,
  'inbox-replycompose--ai-draft-tag-regenerates-in-the-other-language': MENU_EXIT_RACE,
  'inbox-replycompose--local-safe-menu-uses-catalogue-path': MENU_EXIT_RACE,
  'inbox-replycompose--regenerate-dismissed-changes-nothing': MENU_ENTRY_RACE,

  // `layout: 'centered'` gives the editor no width, and its textarea is
  // `field-sizing: content`, so a 5,000-character draft lays out as ONE line:
  // the story root measured 36,424 px wide at 320 and 390, 34,149 at 1440. No
  // surface mounts the editor unbounded. The same over-limit state is
  // measured in a bounded box: `inbox-replycomposer--over-limit` (720 px).
  'inbox-replycompose--over-limit':
    'centered layout gives the field-sizing textarea no width (root 36,424 px); measured bounded as inbox-replycomposer--over-limit',
  'inbox-replyform--draft-over-limit':
    'centered layout gives the field-sizing textarea no width (root 36,424 px); measured bounded as inbox-replycomposer--over-limit',

  // `ReplyEditorInPane` draws nothing once a reply is past draft: the reply is
  // a thread node now, measured as `Inbox/ReplyMessage` and in the thread.
  'inbox-replyform--pending-approval': RENDERS_NOTHING,
  'inbox-replyform--pending-approval-ignores-edit-target': RENDERS_NOTHING,
  'inbox-replyform--approved-queued': RENDERS_NOTHING,
  'inbox-replyform--approved-sending': RENDERS_NOTHING,
  'inbox-replyform--approved-pending-observation': RENDERS_NOTHING,
  'inbox-replyform--published': RENDERS_NOTHING,
  'inbox-replyform--ambiguous-check-only': RENDERS_NOTHING,
  'inbox-replyform--retryable-terminal': RENDERS_NOTHING,
  'inbox-replyform--retryable-ignores-edit-target': RENDERS_NOTHING,
  'inbox-replyform--rejected': RENDERS_NOTHING,
  'inbox-replyform--loading':
    'a one-line `Loading reply...` paragraph: nothing to press, nothing that can overflow',
  'inbox-replymessage--draft-is-not-in-the-thread': RENDERS_NOTHING,
  'inbox-replymessage--no-reply-is-not-in-the-thread': RENDERS_NOTHING,
  'inbox-notes-thread--without-write-permission': RENDERS_NOTHING,
  'inbox-detail-content-feedback--handling-primary-alone-without-permission':
    RENDERS_NOTHING,

  // The reopen dialog's own stories. Their plays query `Reopen` while the
  // closing reason listbox still keeps `aria-hidden` on the root, and throw at
  // 320, 390 and 1440 — the same exit-animation race as above. The dialog is
  // opened from a MENU ROW (`Reopen` under the closed status), which the
  // harness does not press, so it is measured nowhere; row 20's PR 5 amendment
  // records its one-off measurement.
  'inbox-reopen-dialog--confirms':
    'play throws in a real browser (queries Reopen while the closing listbox keeps aria-hidden on the root)',
  'inbox-reopen-dialog--refused':
    'play throws in a real browser (queries Reopen while the closing listbox keeps aria-hidden on the root)',

  // Page stories with no item open show only the list panel, which is out of
  // scope (plan: "Out of scope"); the item they would open is measured by
  // `pages-inbox--default` and the sheet groups.
  'pages-inbox--escalated-folder': 'no item is open: the page shows only the list panel',
  'pages-inbox--no-org': 'no item is open: the page shows only the list panel',
  'pages-inbox--empty-list': 'no item is open: the page shows only the list panel',
  'pages-inbox--successful-load-stamps-visit':
    'no item is open: the page shows only the list panel',
  'pages-inbox--failed-load-preserves-visit-watermark':
    'no item is open: the page shows only the list panel',
  'pages-inbox--property-scoped-load-preserves-organization-watermark':
    'no item is open: the page shows only the list panel',
  'pages-inbox--loading': 'no item is open: the page shows only the list panel',
  'pages-inbox--long-content': 'no item is open: the page shows only the list panel',
  'pages-inbox--mobile-viewport':
    'no item is open: the phone list with its folders drawer; the detail sheet is measured by Inbox/Mobile 390',
  'inbox-escalation-shortcut--detail-loading':
    'the pane shows only its loading state, measured as inbox-detail-panel--loading; the play is desktop-only',
  'inbox-escalation-shortcut--detail-failed':
    'the pane shows only its failure state, measured as inbox-detail-panel--error-state; the play is desktop-only',
}

/** Whole titles under `src/components/inbox/` measured nowhere, and why. */
export const EXCLUDED_TITLES: Readonly<Record<string, string>> = {
  'Inbox/Real Logic (In-Memory)':
    'renders the in-memory use case’s counts as text: no pane, nothing to press',
}
