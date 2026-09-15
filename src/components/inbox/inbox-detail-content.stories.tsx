// Inbox detail content — regions 2 and 3 of the detail pane: the case strip
// and the single scroller. Permission-gated: usePermissions() → can('reply.manage')
// decides whether the ReplyEditor mounts for review items. PropertyManager grants
// reply.manage (gate ON); Member does not (gate OFF). The scroller is one
// thread now — guest message, handling events, notes — so stories supply a mock
// getInboxItemHistory alongside the detail fn; the thread's own states live in
// inbox-thread.stories.tsx. Case state (work status, owner, escalation, reply
// due) is the case toolbar's — its own states live in
// inbox-case-toolbar.stories.tsx; here it only has to mount, so every story
// needs the Actions it reads on first render.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { InboxDetailContent } from './inbox-detail-content'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { ComposerFocusBox, DetailContentProps } from './inbox-detail-content'
import type {
  addInboxNoteFn,
  getInboxItemDetailFn,
  getInboxItemHistoryFn,
} from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/feed/server/activity'
import type { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'
import type { requestReviewAnalysisNowFn } from '#/contexts/ai/server/review-analysis'
import { fn } from 'storybook/test'
import { ON_DEMAND_ANALYSIS_DWELL_MILLIS } from './use-on-demand-review-analysis'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'

const reviewItem: InboxItem = makeInboxItem({
  id: 'rev-det',
  sourceType: 'review',
  status: 'open',
  rating: 4,
})
const feedbackItem: InboxItem = makeInboxItem({
  id: 'fb-det',
  sourceType: 'feedback',
  status: 'open',
  rating: 3,
})

const reviewDetail: InboxItemDetailResult = {
  item: reviewItem,
  reviewText: 'Wonderful stay — the front desk went above and beyond!',
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  reviewContentStatus: 'available',
  // Plan row 7: the guest's stars reach the pane on the detail payload, from
  // the same `ReviewSnippet` as `reviewText` and under the same eligibility
  // rule — null for `expired` and `not_found`.
  reviewRating: 4,
  feedbackComment: null,
  feedbackRatingValue: null,
  reply: null,
  analysis: null,
  feedbackHandling: null,
  responseTarget: null,
}

const feedbackDetail: InboxItemDetailResult = {
  item: feedbackItem,
  reviewText: null,
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  reviewContentStatus: null,
  // A review's field, and null on feedback: the feedback node reads
  // `feedbackRatingValue` and never the review path.
  reviewRating: null,
  feedbackComment: 'Loved the breakfast spread.',
  feedbackRatingValue: 5,
  reply: null,
  analysis: null,
  feedbackHandling: {
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 1,
    status: 'open',
    closeReason: null,
    currentOutcome: null,
    history: [],
  },
  responseTarget: null,
}

/**
 * A reply that is LIVE on Google: read-only, so the pane has nothing writable
 * to put in the Public reply tab. That is the state the Reply / Note shell
 * used to be gated on, and the one the story below exists for.
 */
const publishedReply: NonNullable<InboxItemDetailResult['reply']> = {
  id: replyId('66666666-6666-4666-8666-666666666666'),
  reviewId: reviewId('rev-det'),
  organizationId: organizationId('77777777-7777-4777-8777-777777777777'),
  text: 'Thank you for the kind words — we will pass them on to the front desk.',
  replyLanguageTag: 'en-Latn',
  templateId: null,
  templateVersion: null,
  status: 'published',
  source: 'internal',
  createdBy: userId('88888888-8888-4888-8888-888888888888'),
  approvedBy: userId('88888888-8888-4888-8888-888888888888'),
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 4,
  submittedAt: new Date('2025-06-01T09:00:00Z'),
  approvedAt: new Date('2025-06-01T09:05:00Z'),
  publishedAt: new Date('2025-06-01T09:20:00Z'),
  publicationState: 'published',
  publicationAttempts: 1,
  publicationCycle: 1,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: new Date('2025-06-01T08:55:00Z'),
  updatedAt: new Date('2025-06-01T09:20:00Z'),
}

// Google returns its machine translation and the guest's original words in one
// field; ingestion splits them so `reviewText` is always the original.
const BG_ORIGINAL = 'Хотелът беше чист и уютен, а закуската беше много вкусна.'
const EN_TRANSLATION = 'The hotel was clean and cosy, and the breakfast was very tasty.'

const translatedReviewDetail: InboxItemDetailResult = {
  ...reviewDetail,
  reviewText: BG_ORIGINAL,
  reviewTranslatedText: EN_TRANSLATION,
  // The shape every translated Google review has in production: a Bulgarian
  // property default, and NO language on the review, because the only review
  // source hard-codes `languageCode: null` (`google-review-api.adapter.ts:450`).
  // Unknown is not foreign, so plan row 8 (amended) keeps the guest's words
  // as the body.
  reviewReplyLanguage: null,
  propertyDefaultReplyLanguage: 'bg-Cyrl',
}

const notes: ReadonlyArray<InboxNoteView> = [
  {
    id: 'note-1' as InboxNote['id'],
    inboxItemId: reviewItem.id,
    organizationId: 'org-1' as InboxNote['organizationId'],
    userId: 'user-1' as InboxNote['userId'],
    displayName: 'Ada Lovelace',
    text: 'Drafting a reply today.',
    createdAt: new Date('2025-06-01T10:00:00Z'),
  },
]

// mockServerFn + cast bridges the server-fn brand (same as bulk-actions stories).
const detailFns = {
  getInboxItemDetail: mockServerFn(
    async ({ data }: Parameters<typeof getInboxItemDetailFn>[0]) =>
      data.inboxItemId === feedbackItem.id ? feedbackDetail : reviewDetail,
  ) as unknown as typeof getInboxItemDetailFn,
  getActivityTimeline: mockServerFn(
    async () => [],
  ) as unknown as typeof getActivityTimelineFn,
  addInboxNote: mockServerFn(async () => ({
    ok: true,
  })) as unknown as typeof addInboxNoteFn,
  getInboxItemHistory: mockServerFn(
    async ({ data }: Parameters<typeof getInboxItemHistoryFn>[0]) => ({
      inboxItemId: data.inboxItemId,
      entries: [],
      truncated: false,
    }),
  ) as unknown as typeof getInboxItemHistoryFn,
  generateReplySuggestion: mockServerFn(
    async ({ data }: Parameters<typeof generateReplySuggestionFn>[0]) => ({
      status: 'ready' as const,
      profileVersion: 'reply-draft-v2' as const,
      replyText:
        data.targetLanguage.kind === 'review_language'
          ? 'Благодарим Ви за отзива. Радваме се, че престоят Ви е бил приятен.'
          : 'Thank you for your review. We look forward to welcoming you again.',
      provenanceToken: 'storybook-provenance-token',
      expiresAtEpochMillis: Date.now() + 60_000,
      baseReplyStateRevision: 0,
      concreteLanguageTag: 'bg-Cyrl',
    }),
  ) as unknown as typeof generateReplySuggestionFn,
}

// The strip locks on `isHeaderCommandPending`, which reads all six item
// commands on first render, so every one is a required arg — a story that omits
// one throws before any markup exists. They resolve to the unchanged item: no
// story drives a command.
const updateStatus: InboxDetailState['updateStatus'] = Object.assign(
  async (_input: Parameters<InboxDetailState['updateStatus']>[0]) => reviewItem,
  { isPending: false, error: null, isSuccess: false, data: null },
)
const escalate: InboxDetailState['escalate'] = Object.assign(
  async (_input: Parameters<InboxDetailState['escalate']>[0]) => reviewItem,
  { isPending: false, error: null, isSuccess: false, data: null },
)
const resolveEscalation: InboxDetailState['resolveEscalation'] = Object.assign(
  async (_input: Parameters<InboxDetailState['resolveEscalation']>[0]) => reviewItem,
  { isPending: false, error: null, isSuccess: false, data: null },
)
const assign: InboxDetailState['assign'] = Object.assign(
  async (_input: Parameters<InboxDetailState['assign']>[0]) => reviewItem,
  { isPending: false, error: null, isSuccess: false, data: null },
)

const markFeedbackHandled: InboxDetailState['markFeedbackHandled'] = Object.assign(
  async (_input: Parameters<InboxDetailState['markFeedbackHandled']>[0]) => {
    throw new Error('Story action only')
  },
  { isPending: false, error: null, isSuccess: false, data: null },
)
const correctFeedbackHandlingOutcome: InboxDetailState['correctFeedbackHandlingOutcome'] =
  Object.assign(
    async (_input: Parameters<InboxDetailState['correctFeedbackHandlingOutcome']>[0]) => {
      throw new Error('Story action only')
    },
    { isPending: false, error: null, isSuccess: false, data: null },
  )

const meta: Meta<typeof InboxDetailContent> = {
  title: 'Inbox/Detail Content',
  component: InboxDetailContent,
  tags: ['autodocs'],
  args: {
    updateStatus,
    escalate,
    resolveEscalation,
    assign,
    markFeedbackHandled,
    correctFeedbackHandlingOutcome,
  },
}
export default meta
type Story = StoryObj<typeof InboxDetailContent>

// Review item as PropertyManager — reply.manage granted → ReplyEditor renders.
export const ReviewAsPropertyManager: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
}

// A review whose analysis still waits in the backlog (`analysis: none`) is
// hurried once the manager has had it open for the dwell time.
const requestReviewAnalysisNow = fn(async () => ({ status: 'queued' as const }))

export const WaitingAnalysisIsRequestedAfterDwell: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    ...ReviewAsPropertyManager.args,
    detail: { ...reviewDetail, analysis: { status: 'none' } },
    detailFns: {
      ...detailFns,
      requestReviewAnalysisNow:
        requestReviewAnalysisNow as unknown as typeof requestReviewAnalysisNowFn,
    },
  },
  play: async () => {
    requestReviewAnalysisNow.mockClear()
    expect(requestReviewAnalysisNow).not.toHaveBeenCalled()

    await waitFor(
      () =>
        expect(requestReviewAnalysisNow).toHaveBeenCalledWith({
          data: { reviewId: reviewItem.sourceId },
        }),
      { timeout: ON_DEMAND_ANALYSIS_DWELL_MILLIS + 2_000 },
    )
    expect(requestReviewAnalysisNow).toHaveBeenCalledOnce()
  },
}

export const ReviewWithMixedAspectPolarities: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    ...ReviewAsPropertyManager.args,
    detail: {
      ...reviewDetail,
      analysis: {
        status: 'ready',
        sentiment: 'mixed',
        aspects: [
          { aspect: 'service', polarity: 'negative', intensity: -82 },
          { aspect: 'room', polarity: 'positive', intensity: 68 },
        ],
        primaryCategory: 'service',
        attention: 'high',
        issueLabel: 'front desk delays',
        generatedAtEpochMillis: Date.parse('2026-08-16T12:00:00Z'),
      },
    },
  },
  // The analysis panel is gone: what the review is about is now a row of topic
  // chips under the guest's words, in the dashboard's vocabulary. The summary
  // sentiment chip went with the panel — a chip per mentioned topic already
  // says which way each one points, and one word over the top of them only
  // disagreed with the detail underneath it.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('list', { name: 'Review topics' })).toBeVisible()
    await expect(canvas.getByText('Service · Complaint')).toBeVisible()
    await expect(canvas.getByText('Room · Praise')).toBeVisible()
    // `high` sits above the "worth a look" line with `urgent`; one chip covers both.
    await expect(canvas.getByText('Needs attention')).toBeVisible()
    // Praise / Complaint, never Positive / Negative (plan rows 11, 14).
    await expect(canvas.queryByText(/·\s*(Positive|Negative)$/)).toBeNull()
    await expect(canvas.queryByText(/sentiment/i)).toBeNull()
  },
}

// BQC-6.8: light-theme variant — axe runs on it too (light contrast proof).
export const ReviewAsPropertyManagerLight: Story = {
  decorators: [withRole('PropertyManager')],
  parameters: { theme: 'light' },
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
}

/**
 * Plan v2.1 row 17: the reply language is no longer a combobox in the reply
 * slot. It lives inside `Draft with AI ▾` as the `Write in` group, and — like
 * every assist control — it is part of the reply surface, so note mode hides it.
 *
 * The menu is OPENED here on purpose. The whole point of the row is where the
 * language went; a story that only checked the combobox is gone would pass
 * with the language deleted outright.
 */
export const ReplyToolbarWithLanguages: Story = {
  tags: ['ai-language-regression'],
  decorators: [withRole('PropertyManager')],
  parameters: { theme: 'light' },
  args: {
    currentItem: reviewItem,
    detail: {
      ...reviewDetail,
      propertyDefaultReplyLanguage: 'bg-Cyrl',
      reviewReplyLanguage: 'tr-Latn-TR',
    },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const publicTab = canvas.getByRole('tab', { name: 'Public reply' })
    const noteTab = canvas.getByRole('tab', { name: 'Internal note' })

    await expect(publicTab).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.queryByRole('combobox', { name: 'Reply language' })).toBeNull()
    const chevron = canvas.getByRole('button', {
      name: 'AI tone and language: Professional, Bulgarian',
    })
    await userEvent.click(chevron)
    const writeIn = await body.findByRole('group', { name: 'Write in' })
    await expect(
      within(writeIn).getByRole('menuitem', { name: 'Bulgarian · property default' }),
    ).toHaveAttribute('aria-current', 'true')
    await expect(
      within(writeIn).getByRole('menuitem', { name: 'Turkish · review language' }),
    ).not.toHaveAttribute('aria-current')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())

    await userEvent.click(noteTab)
    await expect(noteTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      canvas.queryByRole('button', { name: /^AI tone and language/ }),
    ).toBeNull()
    await expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()

    await userEvent.click(publicTab)
    await expect(canvas.getByRole('textbox', { name: 'Public reply' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /^AI tone and language/ }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: /draft with ai/i })).toBeEnabled()
    publicTab.blur()
  },
}

/**
 * No property default and no recorded review language: the draft starts on
 * automatic detection. After the AI draft is adopted, the detected language
 * becomes the review language — the result tag names it (row 18) and the
 * `Write in` group checks it (row 17).
 */
export const ReplyToolbarDetectsMissingReviewLanguage: Story = {
  tags: ['ai-language-regression'],
  decorators: [withRole('PropertyManager')],
  parameters: { theme: 'light' },
  args: {
    currentItem: reviewItem,
    detail: {
      ...reviewDetail,
      reviewText: 'Много уютно място, а закуската по време на престоя беше чудесна.',
      propertyDefaultReplyLanguage: null,
      reviewReplyLanguage: null,
    },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const aiButton = canvas.getByRole('button', { name: /draft with ai/i })

    await expect(aiButton).toBeEnabled()
    await userEvent.click(aiButton)
    // Generating only previews the suggestion — adopting it is a deliberate
    // second step, so the detected review language reaches the composer once
    // "Use draft" is pressed.
    await expect(canvas.findByText('Personalized AI suggestion')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /use draft/i }))
    // Nothing else to regenerate in (no property default), so the tag is a
    // fact, not a menu.
    await waitFor(() =>
      expect(
        canvas.getByText(
          (_, element) =>
            element?.tagName === 'P' && element.textContent === 'AI draft · Bulgarian',
        ),
      ).toBeVisible(),
    )
    await userEvent.click(canvas.getByRole('button', { name: /^AI tone and language/ }))
    const writeIn = await body.findByRole('group', { name: 'Write in' })
    await expect(
      within(writeIn).getByRole('menuitem', { name: 'Bulgarian · review language' }),
    ).toHaveAttribute('aria-current', 'true')
    await userEvent.keyboard('{Escape}')
  },
}

// Review item as Member — reply.manage denied → ReplyEditor is absent.
export const ReviewAsMember: Story = {
  decorators: [withRole('Member')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
}

/**
 * Feedback item — no reply editor regardless of role (sourceType !== 'review').
 *
 * This story's first assertion used to be `getByText('Feedback handling')`, the
 * heading of the bordered section `feedback-handling-card.tsx` drew beside the
 * thread. The card is deleted (row 10) and its parts went four ways: the badge
 * is the case strip's chip, the outcome record is a `handling_outcome` thread
 * event, the description is deleted outright, and the ACTION is region 4's
 * `singleModePrimarySlot` — which is what the click below now reaches.
 *
 * So the assertion is inverted rather than dropped: the card's chrome must be
 * gone, and the one thing that survived it must be in the composer, next to the
 * note form rather than in a section of its own halfway up the scroller. The
 * four handling states this pane can be in — open, handled, corrected,
 * withdrawn — are `inbox-feedback-pane.stories.tsx`; what stays here is that a
 * feedback item mounts in the same pane as every review story above it, against
 * the same fixtures.
 */
export const FeedbackDetail: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: feedbackItem,
    detail: feedbackDetail,
    notes: [],
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // None of the card's own chrome, in any region.
    await expect(canvas.queryByText('Feedback handling')).toBeNull()
    await expect(canvas.queryByText('Current outcome')).toBeNull()
    await expect(canvas.queryByText('Outcome history')).toBeNull()
    // The action moved into region 4, beside the note form's own submit —
    // whose two pinned names are unchanged by the move.
    await expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add note' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Mark as handled' }))
    const dialog = within(document.body)
    // The dialog fades/zooms in, so it is mounted (and named) a frame before it
    // is painted — retry the visibility assertions instead of sampling once.
    await waitFor(() =>
      expect(
        dialog.getByRole('heading', { name: 'Mark feedback as handled' }),
      ).toBeVisible(),
    )
    await waitFor(() =>
      expect(dialog.getByText(/never shown to the guest/i)).toBeVisible(),
    )
  },
}

// BQC-6.8 content robustness: emoji-dense long-form review text plus a
// missing reviewer name (null) — the detail must wrap long text and render
// the name fallback without horizontal overflow.
const longTextItem: InboxItem = {
  ...makeInboxItem({ id: 'rev-long', sourceType: 'review', status: 'open', rating: 5 }),
  reviewerName: null,
}

export const LongReviewText: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: longTextItem,
    detail: {
      ...reviewDetail,
      item: longTextItem,
      reviewText:
        'Absolutely magical stay! 🎉✨ From check-in 🛎️ to checkout 🧳 everything ' +
        'was flawless. The pool 🏊 was heated, the breakfast 🥐🍳☕ was fresh ' +
        'every morning, and the staff 👏 remembered our names. The room had ' +
        'a view of the harbor 🌅 that photos cannot do justice. We celebrated ' +
        'our anniversary 💍 here and the team left champagne 🍾 and a ' +
        'handwritten note ✍️ in the room. Ten out of ten 💯 — we will be ' +
        'back every year. '.repeat(3),
    },
    notes: [],
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The full emoji-dense text renders (wrapped, not clipped)...
    await expect(await canvas.findByText(/absolutely magical stay/i)).toBeVisible()
    // ...and the missing reviewer name renders the detail WITHOUT the
    // reviewer block (no broken placeholder, no layout break) — the list
    // row's Anonymous fallback is covered by the Pages/Inbox LongContent story.
    expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

// Status mutation in flight — the strip's interactive chips lock until it
// settles. A closed item is the one that carries a work-status control, so the
// lock is only observable there; an open item's status is a static badge.
const closedReviewItem: InboxItem = { ...reviewItem, status: 'closed' }

export const StatusUpdating: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: closedReviewItem,
    detail: { ...reviewDetail, item: closedReviewItem },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
    updateStatus: Object.assign(
      async (_input: Parameters<InboxDetailState['updateStatus']>[0]) => closedReviewItem,
      { isPending: true, error: null, isSuccess: false, data: null },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Regex: the chip's accessible name carries its value (`Work status: Closed`),
    // and Testing Library matches names exactly.
    await expect(canvas.getByRole('button', { name: /^Work status/ })).toBeDisabled()
  },
}

// Escalation in flight — every item command shares one revision fence, so the
// toolbar's controls lock on it, and since plan v2.1 row 5 the Escalate button
// is one of them. Without the shared predicate the status control stayed live
// here and a second command went out on a revision that was already about to
// go stale.
export const EscalationPendingLocksToolbar: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: closedReviewItem,
    detail: { ...reviewDetail, item: closedReviewItem },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
    escalate: Object.assign(
      async (_input: Parameters<InboxDetailState['escalate']>[0]) => closedReviewItem,
      { isPending: true, error: null, isSuccess: false, data: null },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toolbar = within(canvas.getByRole('region', { name: 'Case status' }))
    await expect(toolbar.getByRole('button', { name: /^Work status/ })).toBeDisabled()
    await expect(toolbar.getByRole('button', { name: 'Escalate' })).toBeDisabled()
  },
}

// Expired source content — the source cache expired, so the review text is
// gone for good. The detail renders the honest unavailable state instead of
// stale content (BQC-1.2: raw copies are never stored, no snippet fallback).
export const ReviewContentExpired: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: {
      ...translatedReviewDetail,
      reviewText: null,
      // BQC-1.2: no words, and no score either — the rating is provider-owned
      // content exactly like the prose.
      reviewRating: null,
      reviewContentStatus: 'expired',
    },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/review content unavailable \(source cache expired\)/i),
    ).toBeInTheDocument()
    // No stale review text may render alongside the unavailable notice.
    await expect(
      canvas.queryByText(/wonderful stay — the front desk went above and beyond/i),
    ).toBeNull()
    // The translation lives inside the reviewText branch, so an ineligible
    // source renders neither the original nor Google's translation of it.
    await expect(canvas.queryByText(EN_TRANSLATION)).toBeNull()
    await expect(canvas.queryByText(/translated by google/i)).toBeNull()
  },
}

// Source content not found — the review was deleted at the source. Same
// unavailable contract, without the cache-expired qualifier.
export const ReviewContentNotFound: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: {
      ...reviewDetail,
      reviewText: null,
      reviewContentStatus: 'not_found',
    },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Review content unavailable')).toBeInTheDocument()
    // The exact expired-variant copy must NOT render here.
    await expect(canvas.queryByText(/source cache expired/i)).toBeNull()
    await expect(
      canvas.queryByText(/wonderful stay — the front desk went above and beyond/i),
    ).toBeNull()
  },
}

// A translated review, seen from the whole pane rather than the thread alone
// (`inbox-thread.stories.tsx` owns every side of plan row 8). What this story
// adds is that the arrangement survives the pane's own chrome on the input
// production actually sends: the guest's words are the body, Google's copy is
// one disclosure away, and BOTH are in the DOM, so nothing the pane does around
// them drops half of a review.
export const ReviewWithGoogleTranslation: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: translatedReviewDetail,
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(BG_ORIGINAL)).toBeVisible()
    await expect(canvas.queryByText(/^Translated/)).toBeNull()
    // In the DOM while folded, which is why `<details>` and not a Collapsible.
    await expect(canvas.getByText(EN_TRANSLATION)).toBeInTheDocument()
    await expect(canvas.getByText(EN_TRANSLATION)).not.toBeVisible()
    await expect(canvas.getByText('Google translation')).toBeInTheDocument()
  },
}

// No translation available (an English review) — only the original renders,
// with no caption and no empty translation block.
export const ReviewWithoutTranslation: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/wonderful stay — the front desk went above and beyond/i),
    ).toBeInTheDocument()
    await expect(canvas.queryByText(/translated by google/i)).toBeNull()
    await expect(canvas.queryByText('Google translation')).toBeNull()
  },
}

/**
 * A read-only reply, at the PANE level — the only level where this is
 * observable, because it is the pane that decides whether the Reply / Note
 * shell exists at all.
 *
 * The composer is mounted for the whole of a review the caller may reply to, in
 * EVERY reply state; only the reply SLOT is gated on there being something to
 * type into. When the whole shell was gated on that, a published reply left the
 * pane with no control named `Internal note` anywhere — two pinned e2e journeys
 * reach for exactly that name (`inbox-triage.spec.ts:182,231`,
 * `activity-notification-facts.spec.ts:167`).
 */
export const ReadOnlyReplyKeepsTheNoteTab: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: { ...reviewDetail, reply: publishedReply },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // The reply is a thread message with its own action...
    await expect(
      canvas.getByRole('article', { name: 'Reply from Acme Hotel' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Edit reply' })).toBeVisible()
    // ...and the writable half of the pane is closed, which is precisely the
    // condition that used to unmount the tabs.
    await expect(canvas.queryByRole('textbox', { name: 'Public reply' })).toBeNull()

    // The shell is still here, and the note is still reachable through it.
    await expect(canvas.getByRole('tab', { name: 'Public reply' })).toBeVisible()
    const noteTab = canvas.getByRole('tab', { name: 'Internal note' })
    await userEvent.click(noteTab)
    await expect(noteTab).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByPlaceholderText('Add a note…')).toBeVisible()
  },
}

/**
 * A half-typed internal note survives a look at the reply box.
 *
 * The composer's mode segment is a real Radix tab set, and Radix unmounts the
 * panel it is not showing — so the note form used to be destroyed and rebuilt
 * on every flip, and the same click threw away an unsaved reply draft, which
 * has no hoisted copy to seed from. Both panels are force-mounted now, with an
 * explicit `hidden` on the inactive one, so neither surface is torn down by a
 * glance at the other. The pane's `noteDraft` above that boundary is still what
 * carries a note across a change of SELECTION, which
 * `SelectingAnotherItemCarriesNothingOver` is the other side of.
 *
 * The middle assertion is therefore `not.toBeVisible()` and not `toBeNull()`,
 * and the two are not interchangeable: `null` is what the defect produced, so
 * asserting it would pin the bug. `hidden` is stronger than invisible anyway —
 * `display: none` from the UA stylesheet, out of the accessibility tree, out of
 * the tab order and out of every `getByRole` query the two pinned e2e journeys
 * use, which the role query beside it states directly.
 *
 * Deliberately a published (read-only) reply: the reply slot is then empty, so
 * the flip involves nothing but the note form. With a draft there it would also
 * exercise the language `Select`, whose Radix popper settles asynchronously —
 * noise this story has no reason to carry, and which `ReplyToolbarWithLanguages`
 * covers on purpose.
 *
 * `fireEvent.change` rather than `userEvent.type`: the same path
 * (`Textarea.onChange` → the field's `handleChange` → the pane), in one update
 * instead of fourteen.
 */
export const NoteSurvivesModeSwitch: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: { ...reviewDetail, reply: publishedReply },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    const noteField = canvas.getByPlaceholderText('Add a note…')
    fireEvent.change(noteField, { target: { value: 'Half a thought' } })

    // Out of the manager's view and out of every role query — but still there,
    // still holding the words, because it was never torn down.
    await userEvent.click(canvas.getByRole('tab', { name: 'Public reply' }))
    await expect(noteField).not.toBeVisible()
    await expect(noteField).toHaveValue('Half a thought')
    await expect(canvas.queryByRole('textbox', { name: 'Add a note' })).toBeNull()

    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await expect(canvas.getByRole('textbox', { name: 'Add a note' })).toHaveValue(
      'Half a thought',
    )
    // The form's own store agrees, so its submit is live again.
    await expect(canvas.getByRole('button', { name: 'Add note' })).toBeEnabled()
  },
}

// ── region 4's focus wire, and the two things fenced to the item ────────────

/**
 * The box the page's `r` / `n` shortcuts reach this pane through.
 *
 * They are bound on `window` by `InboxPageV2`, which is above the pane and
 * cannot see `mode`; the pane is below the page and cannot see the binding. So
 * the pane writes its "set the mode and take the caret" callback into a box
 * passed down, and calling `box.current(mode)` from a play function is exactly
 * what pressing the key does — the whole of it, not a stand-in for it.
 */
const editLockCaret: ComposerFocusBox = { current: null }
const selectionCaret: ComposerFocusBox = { current: null }

const EDITING_BAND = 'Editing a live reply · republishes to Google'

/**
 * Row 9's lock, at the level that owns the state it protects.
 *
 * `reply-composer.tsx` refuses a mode switch while an edit is open, but it can
 * only refuse the ones that arrive through `onValueChange` — a click or an
 * arrow key on the segment. `focusComposer` writes `mode` directly, so `n`
 * went straight past that refusal: nothing visible happened (the region's
 * `resolveMode` still forces `reply` while the lock holds), and then Cancel
 * dropped the manager into the note form on a review they were mid-edit on,
 * with the edit closed and no sign of where their words went.
 *
 * Which is why the proof is the CANCEL, not the keypress. A refused `n` is
 * silent by design — the screen is identical either way — so the only
 * observable difference between fenced and unfenced is which surface the pane
 * lands on when the editor closes. The positive control first is what makes
 * that silence mean something: the same call with no edit open moves the mode
 * AND takes the caret, so the wire is demonstrably live before it is asked to
 * refuse.
 */
export const NoteShortcutIsRefusedDuringALiveEdit: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: { ...reviewDetail, reply: publishedReply },
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
    composerFocusRef: editLockCaret,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const replyTab = canvas.getByRole('tab', { name: 'Public reply' })
    const noteTab = canvas.getByRole('tab', { name: 'Internal note' })

    // Positive control: with no edit open, `n` moves the mode and the caret.
    editLockCaret.current?.('note')
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Add a note' })).toHaveFocus(),
    )
    await expect(noteTab).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(replyTab)
    await expect(replyTab).toHaveAttribute('aria-selected', 'true')

    // Now open row 9's editor from the thread's own message.
    await userEvent.click(canvas.getByRole('button', { name: 'Edit reply' }))
    const band = await canvas.findByText(EDITING_BAND)
    await expect(
      canvas.getByRole('textbox', { name: 'Edit published reply' }),
    ).toBeVisible()
    await expect(noteTab).toHaveAttribute('aria-disabled', 'true')
    await expect(noteTab).toHaveAttribute('aria-describedby', band.id)

    // `n` during the edit. Refused at the source, so the mode does not move.
    editLockCaret.current?.('note')
    // ...and the region refuses the click for the same reason.
    await userEvent.click(noteTab)
    await expect(replyTab).toHaveAttribute('aria-selected', 'true')
    await expect(noteTab).toHaveAttribute('aria-selected', 'false')

    // The payload: closing the editor lands back on the reply surface. If the
    // keypress had been honoured, `mode` would be `note` here and this is the
    // commit that would have shown it.
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(canvas.queryByText(EDITING_BAND)).toBeNull())
    await expect(replyTab).toHaveAttribute('aria-selected', 'true')
    await expect(noteTab).toHaveAttribute('aria-selected', 'false')
    await expect(noteTab).not.toHaveAttribute('aria-disabled')
    await expect(canvas.getByPlaceholderText('Add a note…')).not.toBeVisible()
  },
}

/** A second review, so a change of selection is a real one. */
const nextReviewItem: InboxItem = makeInboxItem({
  id: 'rev-det-next',
  sourceType: 'review',
  status: 'open',
  rating: 5,
})

/**
 * Two selections in one mounted pane, which is the only way the per-item
 * fences are observable: `mode`, `caret` and `noteDraft` all outlive a change
 * of selection by design, so nothing about them can be seen from a story whose
 * `currentItem` never changes.
 */
function PaneAcrossTwoSelections(args: DetailContentProps) {
  const [selected, setSelected] = useState(0)
  const item = selected === 0 ? reviewItem : nextReviewItem
  return (
    <>
      <button type="button" onClick={() => setSelected(1)}>
        Open the next review
      </button>
      <InboxDetailContent
        {...args}
        currentItem={item}
        detail={{ ...reviewDetail, item }}
      />
    </>
  )
}

const FIRST_DRAFT = 'Thank you for the kind words about the front desk.'
const FIRST_NOTE = 'Ring the guest about the spa booking'

/**
 * Nothing typed about one review reaches the next one — not the caret, not the
 * reply draft, not the note.
 *
 * All three are pane state that deliberately outlives a selection, and all
 * three needed a fence for a different reason:
 *
 *   * `caret` is a bumped counter, and both consumers' effects fire on mount
 *     whenever it is non-zero. Unfenced, one `r` and then a `j` down the list
 *     handed the caret to the NEXT item's reply box — so the keystrokes after
 *     it were typed into, and autosaved onto, a review nobody had opened.
 *   * the reply draft lives in `useReplyComposer`, below `ReplyEditor key=
 *     {currentItem.id}`, so the remount is what clears it.
 *   * `noteDraft` is hoisted above the composer, so the item id travels with
 *     the text and the form seeds from it only on a match.
 *
 * The caret half is what the extra button is here for: without the fence the
 * new item's box takes focus on mount, and `not.toHaveFocus()` is the
 * difference. The positive control immediately above it — the same request
 * honoured on the item it was made for — is what stops that assertion passing
 * for the trivial reason that the wire is dead.
 *
 * Autosave never runs in this story and that is not incidental: this review
 * has no property default and no stored reply language, so the draft's
 * language is to be DETECTED, and `updateDraft` schedules with
 * `eligible: false`. No timer, no save, no re-seed from a cache — what is
 * asserted is the remount alone.
 */
export const SelectingAnotherItemCarriesNothingOver: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
    composerFocusRef: selectionCaret,
  },
  render: (args) => <PaneAcrossTwoSelections {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // A note about the first review...
    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    fireEvent.change(canvas.getByRole('textbox', { name: 'Add a note' }), {
      target: { value: FIRST_NOTE },
    })
    // ...and a reply draft about it.
    await userEvent.click(canvas.getByRole('tab', { name: 'Public reply' }))
    const firstBox = canvas.getByRole('textbox', { name: 'Public reply' })
    fireEvent.change(firstBox, { target: { value: FIRST_DRAFT } })

    // The caret request, honoured on the item it was made for.
    selectionCaret.current?.('reply')
    await waitFor(() => expect(firstBox).toHaveFocus())

    await userEvent.click(canvas.getByRole('button', { name: 'Open the next review' }))

    // A different reply box, empty, and it does NOT steal the caret: the
    // standing request belongs to the review that made it.
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Public reply' })).toHaveValue(''),
    )
    const nextBox = canvas.getByRole('textbox', { name: 'Public reply' })
    await expect(nextBox).not.toBe(firstBox)
    await expect(nextBox).not.toHaveFocus()

    // And the note did not follow either — it would have been filed against
    // this review, fenced on this review's revision.
    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await expect(canvas.getByRole('textbox', { name: 'Add a note' })).toHaveValue('')
    await expect(canvas.getByRole('button', { name: 'Add note' })).toBeDisabled()
  },
}
