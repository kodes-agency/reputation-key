// The declared matrix for the pane as its compositions mount it — the desktop
// pane (`Inbox/Detail Content`), the feedback pane, the page — and for the
// pane's parts rendered alone: the reply node, the reply editor and its views,
// the composer footer and the note form. Added by PR 5's review, which found
// 160 stories under `src/components/inbox/` that the first harness never
// loaded (`inbox-detail-stories.ts`, "Completeness").

import {
  DESKTOP,
  EVERY_WIDTH,
  FOLLOWS_THE_WINDOW,
  PANE,
  type Group,
} from './story-matrix'

const DETAIL_CONTENT = 'inbox-detail-content--'
const FEEDBACK_PANE = 'inbox-detail-content-feedback--'
const REPLY_MESSAGE = 'inbox-replymessage--'
const REPLY_COMPOSE = 'inbox-replycompose--'
const REPLY_FORM = 'inbox-replyform--'
const EDITOR_VIEWS = 'inbox-replyeditorviews--'
const COMPOSER_FOOTER = 'inbox-replycomposerfooter--'
const NOTE_FORM = 'inbox-notes-thread--'
const PAGE = 'pages-inbox--'
const SHORTCUT = 'inbox-escalation-shortcut--'

export const COMPOSITION_GROUPS: ReadonlyArray<Group> = [
  // The desktop pane composition itself: header, toolbar, thread and composer
  // as `InboxDetailContent` mounts them, with no width of its own, so it spans
  // the window. Desktop only. Below `md` this component is only ever mounted
  // inside the sheet, which the `inbox-mobile-390` group measures. Loaded bare
  // at 320 and 390, 5 of these 18 plays throw (they drive the expanded
  // composer, which a phone opens collapsed), and the 13 that play have no
  // height bound, so the document grows with the thread and "the primary is
  // inside the viewport" stops meaning anything: at 320, 10 of them put the
  // opened composer's primary below the 568 px window (`Submit for approval`
  // at y 551.3, 36 px tall) in a column no surface mounts unbounded.
  {
    prefix: DETAIL_CONTENT,
    pane: PANE.story,
    widths: DESKTOP,
    stories: [
      'review-as-property-manager',
      'review-with-mixed-aspect-polarities',
      'review-as-property-manager-light',
      'reply-toolbar-with-languages',
      'reply-toolbar-detects-missing-review-language',
      'review-as-member',
      'feedback-detail',
      'long-review-text',
      'status-updating',
      'escalation-pending-locks-toolbar',
      'review-content-expired',
      'review-content-not-found',
      'review-with-google-translation',
      'review-without-translation',
      'read-only-reply-keeps-the-note-tab',
      'note-survives-mode-switch',
      'note-shortcut-is-refused-during-a-live-edit',
      'selecting-another-item-carries-nothing-over',
    ],
    // The live edit's final frame shows the published reply's editing band,
    // and no composer primary.
    withPrimary: { allBut: ['note-shortcut-is-refused-during-a-live-edit'] },
  },
  // Every feedback pane state, desktop only for the reason above: at 320 and
  // 390, 9 of these 13 plays throw on the collapsed note form. Three plays
  // end with the handling dialog open, so that dialog is measured as an open
  // layer over the pane.
  {
    prefix: FEEDBACK_PANE,
    pane: PANE.story,
    widths: DESKTOP,
    stories: [
      'feedback-open',
      'feedback-handled',
      'feedback-corrected',
      'feedback-withdrawn',
      'feedback-source-ineligible',
      'feedback-closed-and-reopenable',
      'feedback-outcome-this-build-cannot-read',
      'feedback-internal-note-withheld',
      'feedback-as-member-reads-but-cannot-handle',
      'feedback-action-is-permission-gated-not-state-gated',
      'feedback-handled-light',
    ],
    withPrimary: 'all',
  },
  {
    // The handling primary rendered alone: its box follows the window.
    prefix: FEEDBACK_PANE,
    pane: PANE.story,
    widths: EVERY_WIDTH,
    stories: ['handling-primary-alone-with-permission'],
    withPrimary: 'all',
  },
  // ── Components of the pane, rendered alone ────────────────────────────────
  //
  // `layout: 'centered'`, no width of their own: at 320 and 390 the component
  // is the window less Storybook's centring padding (288 and 358 px, narrower
  // than the sheet gives it), at 1440 its content width. All of these play at
  // all three widths, so all three are measured.
  {
    prefix: REPLY_MESSAGE,
    pane: PANE.story,
    widths: EVERY_WIDTH,
    stories: [
      'awaiting-approval',
      'confirm-and-publish-asks-first',
      'publish-blocked-by-template-slot',
      'reject-reveals-reason-field',
      'rejecting-closes-the-panel',
      'a-different-reply-gets-a-clean-panel',
      'awaiting-approval-while-saving',
      'waiting-for-google',
      'waiting-for-google-while-sending',
      'waiting-for-google-after-google-accepted',
      'live-on-google',
      'live-on-google-while-editing',
      'live-on-google-while-saving',
      'google-mirrored-reply',
      'needs-check',
      'needs-check-while-saving',
      'not-published',
      'not-published-after-google-rejection',
      'not-published-while-saving',
      'rejected',
      'rejected-without-reason',
      'rejected-while-saving',
      'unnamed-property',
    ],
  },
  {
    prefix: REPLY_COMPOSE,
    pane: PANE.story,
    widths: EVERY_WIDTH,
    stories: [
      'new-reply',
      'editing-draft',
      'saving',
      'unfilled-template-slot-blocks-submit',
      'submit-flow',
      'legacy-draft-persists-default-language-on-submit',
      'ai-suggestion-adoption',
      'local-fallback-requires-adoption',
      'ai-detects-missing-review-language',
      'choose-review-language-when-metadata-is-missing',
      'rating-only-uses-property-template',
      'short-review-uses-property-template',
      'library-template-loads-as-manual-draft',
      'short-review-needs-property-language',
      'unsupported-language',
      'manual-edit-wins-over-delayed-suggestion',
      'ai-replies-not-enabled',
      'public-display-name-missing',
      'public-display-name-missing-for-manager',
      'detected-language-survives-a-template',
      'undo-after-a-template-drops-its-tag',
      'use-draft-returns-the-caret-to-the-text',
      'template-switch-back-while-loading-keeps-the-composer-live',
    ],
    // `saving`'s footer shows the saving state in the primary's place.
    withPrimary: { allBut: ['saving'] },
  },
  {
    prefix: REPLY_FORM,
    pane: PANE.story,
    widths: EVERY_WIDTH,
    stories: [
      'new-reply',
      'draft',
      'published-being-edited',
      'reopened-rejected-takes-focus',
    ],
    withPrimary: 'all',
  },
  {
    // Includes the republish confirmation: `Review update` is an
    // `AlertDialogTrigger`, so the probe opens that dialog at every width.
    prefix: EDITOR_VIEWS,
    pane: PANE.story,
    widths: EVERY_WIDTH,
    stories: [
      'published-edit-requires-confirmation',
      'published-edit-with-unfilled-slot',
      'published-edit-labels-the-field-and-repeats-nothing',
      'published-edit-while-saving',
    ],
    withPrimary: 'all',
  },
  {
    prefix: COMPOSER_FOOTER,
    pane: PANE.story,
    widths: EVERY_WIDTH,
    stories: [
      'idle',
      'pending',
      'saving',
      'saved',
      'unsaved',
      'save-failed',
      'with-deletable-draft',
      'submit-blocked',
      'submitting',
    ],
    // `submitting` shows the pending state instead.
    withPrimary: { allBut: ['submitting'] },
  },
  {
    prefix: NOTE_FORM,
    pane: PANE.form,
    widths: EVERY_WIDTH,
    stories: ['empty', 'add-note'],
    withPrimary: 'all',
  },
  // ── The page: the pane where `InboxPageV2` puts it ────────────────────────
  //
  // The only stories that measure the pane in the real three-panel layout (a
  // 714 px column at 1440) and in the page's own sheet on a phone. The list
  // panel beside it is out of scope, so the pane is `PANE.detail`.
  {
    prefix: PAGE,
    pane: PANE.detail,
    widths: FOLLOWS_THE_WINDOW,
    // The phone opens the composer collapsed: no primary on screen.
    stories: ['default'],
  },
  {
    prefix: PAGE,
    pane: PANE.detail,
    widths: DESKTOP,
    stories: ['default', 'approved-panels'],
    withPrimary: 'all',
  },
  {
    // Desktop only, the only width the shortcut is bound at
    // (`inbox-escalation-shortcut.stories.tsx:26-28`).
    prefix: SHORTCUT,
    pane: PANE.detail,
    widths: DESKTOP,
    stories: ['detail-ready'],
    withPrimary: 'all',
  },
]
