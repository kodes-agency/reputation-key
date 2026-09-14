// The declared matrix for the pane's own regions: which toolbar, thread, dock,
// composer and sheet stories are measured, at which widths, and where each
// one's pane is. The vocabulary (widths, panes, the shape of a group) is
// `story-matrix.ts`; the compositions and the parts rendered alone are
// `inbox-detail-compositions.ts`; what is deliberately not measured, and why,
// is `inbox-detail-exclusions.ts`.
//
// ── Completeness ────────────────────────────────────────────────────────────
//
// Every story DEFINED under `src/components/inbox/` is measured here, listed in
// `EXCLUDED_STORIES` with a reason, or belongs to a title in `EXCLUDED_TITLES`
// with a reason (`inbox-detail-exclusions.ts`). `inbox-detail.metrics.ts`
// checks that against the running Storybook's `/index.json`, keyed on each
// entry's `importPath` — so a story under a new title cannot land unmeasured,
// and a renamed one cannot leave a stale id here that 404s into a pass.
//
// The first version keyed completeness on the id prefixes of the groups below,
// which is circular: a title nobody had declared was invisible to it. Review
// counted 160 inbox stories across 16 titles that had never been measured —
// among them the desktop pane composition itself (`Inbox/Detail Content`),
// every feedback pane state, every reply node and the reply editor's own
// stories (`Inbox/ReplyMessage`, `Inbox/ReplyCompose`) — and they are groups
// now.

import { COMPOSITION_GROUPS } from './inbox-detail-compositions'
import {
  DESKTOP,
  FOLLOWS_THE_WINDOW,
  PANE,
  PHONE,
  declarationErrors,
  measuredStories,
  type Group,
  type MeasuredStory,
} from './story-matrix'

export { INBOX_STORY_IMPORT_PREFIX, VIEWPORTS } from './story-matrix'
export type { MeasuredStory, StoryWidth } from './story-matrix'

const TOOLBAR = 'inbox-case-toolbar--'
const THREAD = 'inbox-thread--'
const DOCK = 'inbox-composer-dock--'
const ASSIST = 'inbox-composer-assist-menus--'
const COMPOSER = 'inbox-replycomposer--'
const COLLAPSED = 'inbox-replycomposer-collapsed--'
const MOBILE_SHEET = 'inbox-mobile-390--'
const DETAIL_SHEET = 'inbox-detail-sheet--'
const DETAIL_PANEL = 'inbox-detail-panel--'

const REGION_GROUPS: ReadonlyArray<Group> = [
  // ── Region 2: the case toolbar ────────────────────────────────────────────
  {
    prefix: TOOLBAR,
    pane: PANE.toolbar,
    widths: DESKTOP,
    stories: [
      'open-review',
      'closed-review',
      'feedback-open',
      'feedback-handled',
      'feedback-closed-no-outcome',
      'feedback-handling-withheld',
      'escalated',
      'escalated-light',
      'escalation-resolved',
      'due-soon',
      'due-soon-light',
      'overdue',
      'replied-on-time',
      'replied-late',
      'not-measured',
      'unassigned',
      'assigned-to-someone',
      'assigned-unresolved',
      'assigned-to-you',
      'member-view',
      'member-claims-unassigned',
      'member-releases-own-item',
      'member-sees-feedback-owner-as-text',
      'member-sees-colleague-without-directory',
      'command-pending',
    ],
  },
  {
    prefix: TOOLBAR,
    pane: PANE.toolbar,
    widths: PHONE,
    stories: [
      'open-review-390',
      'closed-review-390',
      'feedback-open-390',
      'feedback-handled-390',
      'feedback-closed-no-outcome-390',
      'escalated-390',
      'escalation-resolved-390',
      'due-soon-390',
      'overdue-390',
      'replied-on-time-390',
      'replied-late-390',
      'not-measured-390',
      'assigned-to-someone-390',
      'assigned-unresolved-390',
      'assigned-to-you-390',
      'member-view-390',
      'member-sees-colleague-without-directory-390',
    ],
  },
  // ── Region 3: the thread ──────────────────────────────────────────────────
  {
    prefix: THREAD,
    pane: PANE.thread,
    widths: DESKTOP,
    stories: [
      'review-only',
      'guest-photo-is-the-first-disc',
      'full-rail',
      'with-events',
      'notes-interleaved-between-events',
      'reply-awaiting-approval',
      'reply-waiting-for-google',
      'reply-live-on-google',
      'reply-needs-check',
      'reply-not-published',
      'reply-rejected',
      'reply-draft-draws-no-node',
      'folded-history',
      'expanded-history',
      'six-events-never-fold',
      'note-among-the-oldest-events-keeps-the-rail-open',
      'unsayable-rows-do-not-count-towards-the-fold',
      'fold-belongs-to-the-item',
      'truncated-history',
      'history-loading',
      'history-failed',
      'original-first-when-review-language-unknown',
      'translation-first',
      'original-first-in-the-property-language',
      'original-first-with-no-property-language',
      'foreign-review-with-no-translation',
      'translation-only',
      'rating-only-review',
      'content-expired',
      'anonymous-guest-on-available-review',
      'content-not-found',
      'feedback-item',
      'guest-first-despite-backdated-history',
      'legacy-event-has-no-actor',
      'handling-outcome-note-visibility',
      'assignment-with-unresolved-name',
      'analysis-ready-with-no-signals',
      'analysis-ready-needs-attention-only',
      'unknown-enum-values-render-nothing',
      'unknown-event-kind-renders-nothing',
      'future-entry-kind-does-not-steal-the-guest-key',
      'with-events-light',
      'folded-history-light',
    ],
  },
  {
    prefix: THREAD,
    pane: PANE.thread,
    widths: PHONE,
    stories: [
      'review-only-phone',
      'guest-photo-is-the-first-disc-phone',
      'full-rail-phone',
      'with-events-phone',
      'notes-interleaved-between-events-phone',
      'reply-awaiting-approval-phone',
      'reply-waiting-for-google-phone',
      'reply-live-on-google-phone',
      'reply-needs-check-phone',
      'reply-not-published-phone',
      'reply-rejected-phone',
      'reply-draft-draws-no-node-phone',
      'folded-history-phone',
      'expanded-history-phone',
      'six-events-never-fold-phone',
      'note-among-the-oldest-events-keeps-the-rail-open-phone',
      'truncated-history-phone',
      'history-loading-phone',
      'history-failed-phone',
      'feedback-item-phone',
      'legacy-event-has-no-actor-phone',
      'unknown-event-kind-renders-nothing-phone',
    ],
  },
  // ── Region 4: the dock, its assist group, and the real composer ───────────
  //
  // `Inbox/Composer Dock` renders the REAL `ReplyComposer` around stand-in
  // slots (`composer-dock.stories.tsx:55-106, 146`): a bare textarea and six
  // `Report <status>` ghost buttons for the reply, a 1,200 px spacer and a
  // `size="sm"` `Submit for approval` for the tall column, and a `size="sm"`
  // `Mark as handled` under the tall note. The
  // first run measured exactly those — `Report idle` 93x32, the stand-in submit
  // 147.9x32 — which says nothing about the product. So an expanded dock story
  // is judged on what it exists to prove, the region's bound: no overflow, and
  // the primary inside the viewport and hit-testable (the tall stories' whole
  // point, row 14). The dock's real head and slots are sized in
  // `Inbox/ReplyComposer` and the sheet, which mount `ReplyCompose` itself. The
  // COLLAPSED dock stories show no slot at all, so they are judged on everything
  // — the 44 px pill included.
  {
    prefix: DOCK,
    pane: PANE.region,
    widths: DESKTOP,
    standIns: true,
    stories: [
      'reply-head-at-720',
      'save-state-travels-up-at-720',
      'slot-follows-the-mode-at-720',
      'note-mode-is-private-at-720',
      'single-mode-note-dock-at-720',
      'tall-reply-keeps-its-primary-at-720',
      'tall-feedback-note-keeps-its-primary-at-720',
    ],
    withPrimary: [
      'tall-reply-keeps-its-primary-at-720',
      'tall-feedback-note-keeps-its-primary-at-720',
    ],
  },
  {
    prefix: DOCK,
    pane: PANE.region,
    widths: PHONE,
    standIns: true,
    stories: [
      'reply-head-at-390',
      'save-state-travels-up-at-390',
      'note-mode-is-private-at-390',
      'single-mode-note-dock-at-390',
      'tall-reply-keeps-its-primary-at-390',
      'tall-feedback-note-keeps-its-primary-at-390',
    ],
    withPrimary: [
      'tall-reply-keeps-its-primary-at-390',
      'tall-feedback-note-keeps-its-primary-at-390',
    ],
  },
  {
    prefix: DOCK,
    pane: PANE.region,
    widths: PHONE,
    standInsOnceOpened: true,
    stories: [
      'collapsed-note-bar-is-private-at-390',
      'collapsed-reply-bar-stays-neutral-at-390',
    ],
  },
  {
    // These two render `ReplyComposerFooter` alone, with no region around it.
    prefix: DOCK,
    pane: PANE.story,
    widths: DESKTOP,
    stories: [
      'submit-carries-the-guarantee-at-720',
      'blocked-submit-keeps-its-reason-at-720',
    ],
    withPrimary: [
      'submit-carries-the-guarantee-at-720',
      'blocked-submit-keeps-its-reason-at-720',
    ],
  },
  {
    prefix: ASSIST,
    pane: PANE.story,
    widths: DESKTOP,
    stories: [
      'write-in-switches-without-drafting',
      'tone-pick-drafts-nothing',
      'busy',
      'template-switch-reloads-the-list',
      'template-switch-only-for-listable-languages',
      'template-loading-and-empty',
      'no-default-manager-gets-the-fix',
      'no-default-member-reads-the-sentence',
      'no-default-while-auto-detecting',
      'undo-and-error',
    ],
  },
  {
    prefix: ASSIST,
    pane: PANE.story,
    widths: PHONE,
    stories: [
      'write-in-switches-without-drafting-390',
      'template-switch-reloads-the-list-390',
      'template-switch-only-for-listable-languages-390',
      'no-default-manager-gets-the-fix-390',
      'no-default-member-reads-the-sentence-390',
      'undo-and-error-390',
    ],
  },
  {
    prefix: COMPOSER,
    pane: PANE.region,
    widths: DESKTOP,
    stories: [
      'empty-at-720',
      'reply-with-text-at-720',
      'saved-ai-draft-at-720',
      'suggestion-awaiting-adoption',
      'over-limit',
      'no-property-default-at-720',
      'auto-detect-disabled-at-720',
      'language-pick-on-an-empty-box-at-720',
      'detection-on-a-typed-reply-explains-submit-at-720',
      'editing-band-at-720',
      'note-mode-empty-at-720',
      'note-mode-with-text-at-720',
      'read-only-reply-at-720',
      'feedback-single-mode-composer',
      'feedback-primary-on-an-open-cycle',
      'feedback-primary-on-a-handled-cycle',
      'feedback-primary-refused-for-withdrawn',
      'feedback-primary-without-handle-permission',
      'two-mode-composer-drops-the-handling-primary',
      'single-mode-reply-composer-drops-the-handling-primary',
      'template-is-the-recommended-drafting-control',
      'autosave-states-at-720',
      'note-survives-reply-round-trip',
      'reply-draft-survives-note-round-trip',
      'library-template-tag-at-720',
    ],
    withPrimary: 'all',
  },
  {
    prefix: COMPOSER,
    pane: PANE.region,
    widths: PHONE,
    stories: [
      'empty-at-390',
      'reply-with-text-at-390',
      'saved-ai-draft-at-390',
      'no-property-default-at-390',
      'auto-detect-disabled-at-390',
      'language-pick-on-an-empty-box-at-390',
      'detection-on-a-typed-reply-explains-submit-at-390',
      'editing-band-at-390',
      'note-mode-empty-at-390',
      'note-mode-with-text-at-390',
      'read-only-reply-at-390',
      'autosave-states-at-390',
      'library-template-tag-at-390',
    ],
    withPrimary: 'all',
  },
  // The collapsed-composer harness has stand-in slots too
  // (`reply-composer-collapsed.stories.tsx:57-66`, a bare three-row textarea),
  // but it is judged on everything: what it proves is the bar and the segment
  // beside it, both product, and its stand-ins are a textarea and a
  // default-size `Button`, which clear every floor. Its box follows the window
  // (no inline width), so it runs at 320 as well.
  {
    prefix: COLLAPSED,
    pane: PANE.region,
    widths: FOLLOWS_THE_WINDOW,
    stories: [
      'mobile-opens-collapsed',
      'mobile-bar-expands-onto-reply',
      'mobile-read-only-reply-bar-offers-the-note',
      'mobile-read-only-reply-refuses-the-empty-surface',
      'mobile-bar-opens-from-the-keyboard',
      'mobile-mode-expands-onto-notes',
      'mobile-mode-expands-on-click-not-mouse-down',
      'mobile-selected-mode-expands',
      'mobile-stays-expanded-for-the-item',
      'mobile-next-item-starts-collapsed',
      'mobile-pending-work-opens-expanded',
      'mobile-stays-open-after-the-draft-is-cleared',
      'mobile-collapses-again-if-nothing-was-touched',
      'mobile-edit-target-opens-expanded',
      'mobile-note-only-keeps-its-primary',
    ],
    // Collapsed, a reply or note surface shows only the bar; the one primary
    // that survives the collapse is a note-only item's (row 10).
    withPrimary: ['mobile-note-only-keeps-its-primary'],
  },
  {
    prefix: COLLAPSED,
    pane: PANE.region,
    widths: DESKTOP,
    stories: ['desktop-opens-expanded'],
  },
  // ── The whole pane: the phone sheet and the desktop panel ─────────────────
  {
    prefix: MOBILE_SHEET,
    pane: PANE.sheet,
    widths: FOLLOWS_THE_WINDOW,
    stories: [
      'review-open',
      'review-closed',
      'review-escalated',
      'review-overdue',
      'feedback-open',
      'feedback-handled',
      'feedback-withdrawn',
      'thread-with-events',
      'thread-with-notes',
      'thread-reply-awaiting-approval',
      'thread-reply-waiting-for-google',
      'thread-reply-live-on-google',
      'closed-with-observed-google-reply',
      'thread-reply-not-published',
      'thread-reply-rejected',
      'composer-note-mode',
      'composer-editing-a-live-reply',
      'mobile-composer-opens-collapsed',
      'mobile-bar-opens-the-composer',
      'mobile-draft-reply-opens-expanded',
      'loading-state',
      'error-state',
      'header-at-320',
      'review-open-light',
    ],
    withPrimary: [
      'feedback-open',
      'feedback-handled',
      'feedback-withdrawn',
      'composer-note-mode',
      'composer-editing-a-live-reply',
      'mobile-bar-opens-the-composer',
      'mobile-draft-reply-opens-expanded',
    ],
  },
  {
    prefix: MOBILE_SHEET,
    pane: PANE.sheet,
    widths: DESKTOP,
    stories: ['sheet-at-desktop-width'],
    withPrimary: ['sheet-at-desktop-width'],
  },
  {
    prefix: DETAIL_SHEET,
    pane: PANE.sheet,
    widths: FOLLOWS_THE_WINDOW,
    stories: ['open', 'loading', 'error-state'],
  },
  {
    prefix: DETAIL_PANEL,
    pane: PANE.story,
    widths: DESKTOP,
    stories: ['populated', 'loading', 'error-state'],
    withPrimary: ['populated'],
  },
]

const GROUPS: ReadonlyArray<Group> = [...REGION_GROUPS, ...COMPOSITION_GROUPS]

export const MEASURED_STORIES: ReadonlyArray<MeasuredStory> = measuredStories(GROUPS)

export const DECLARATION_ERRORS: ReadonlyArray<string> = declarationErrors(
  GROUPS,
  MEASURED_STORIES,
)
