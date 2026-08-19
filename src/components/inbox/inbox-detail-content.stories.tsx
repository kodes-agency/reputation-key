// Inbox detail content — the body of the detail pane. Permission-gated:
// usePermissions() → can('reply.manage') decides whether the ReplyEditor mounts
// for review items. PropertyManager grants reply.manage (gate ON); Staff does
// not (gate OFF). The component also renders the status actions, activity
// timeline, and notes thread, so stories supply mock detailFns for all three.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { InboxDetailContent } from './inbox-detail-content'
import { getStatusActions } from './inbox-detail-helpers'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { Action } from '#/components/hooks/use-action'
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
} from '#/contexts/inbox/application/public-api'

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
  feedbackComment: null,
  feedbackRatingValue: null,
  reply: null,
  analysis: null,
}

const feedbackDetail: InboxItemDetailResult = {
  item: feedbackItem,
  reviewText: null,
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  reviewContentStatus: null,
  feedbackComment: 'Loved the breakfast spread.',
  feedbackRatingValue: 5,
  reply: null,
  analysis: null,
}

// Google returns its machine translation and the guest's original words in one
// field; ingestion splits them so `reviewText` is always the original.
const BG_ORIGINAL = 'Хотелът беше чист и уютен, а закуската беше много вкусна.'
const EN_TRANSLATION = 'The hotel was clean and cosy, and the breakfast was very tasty.'

const translatedReviewDetail: InboxItemDetailResult = {
  ...reviewDetail,
  reviewText: BG_ORIGINAL,
  reviewTranslatedText: EN_TRANSLATION,
}

const notes: ReadonlyArray<InboxNote> = [
  {
    id: 'note-1' as InboxNote['id'],
    inboxItemId: reviewItem.id,
    organizationId: 'org-1' as InboxNote['organizationId'],
    userId: 'user-1' as InboxNote['userId'],
    text: 'Drafting a reply today.',
    createdAt: new Date('2025-06-01T10:00:00Z'),
  },
]

// mockServerFn + cast bridges the server-fn brand (same as bulk-actions stories).
const detailFns = {
  getActivityTimeline: mockServerFn(
    async () => [],
  ) as unknown as typeof getActivityTimelineFn,
  addInboxNote: mockServerFn(async () => ({
    ok: true,
  })) as unknown as typeof addInboxNoteFn,
}

// Mirrors the server fn's { data } payload + status enum (no 'new' — nothing
// transitions TO new). Output is InboxItem, matching the use-case return.
type StatusInput = {
  data: { inboxItemId: string; status: 'open' | 'closed' }
}
type IdInput = {
  data: { inboxItemId: string }
}

// Controllable Action mock — same shape the component's useMutationAction
// produces (Action<StatusInput, InboxItem>), so it's directly assignable to the
// updateStatus prop with no casts.
function makeStatusAction(
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<StatusInput, InboxItem> {
  const impl = async (_input: StatusInput): Promise<InboxItem> => reviewItem
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

function makeIdAction(
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<IdInput, InboxItem> {
  const impl = async (_input: IdInput): Promise<InboxItem> => reviewItem
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const meta: Meta<typeof InboxDetailContent> = {
  title: 'Inbox/Detail Content',
  component: InboxDetailContent,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof InboxDetailContent>

// Review item as PropertyManager — reply.manage granted → ReplyEditor renders.
export const ReviewAsPropertyManager: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
}

export const ReviewWithAnalysis: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    ...ReviewAsPropertyManager.args,
    detail: {
      ...reviewDetail,
      analysis: {
        status: 'ready',
        sentiment: 'positive',
        primaryCategory: 'service',
        attention: 'high',
        generatedAtEpochMillis: Date.parse('2026-08-16T12:00:00Z'),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'AI review analysis' })).toBeVisible()
    await expect(canvas.getByText('high attention')).toBeVisible()
    await expect(canvas.getByText('positive sentiment')).toBeVisible()
    await expect(canvas.getByText('Service')).toBeVisible()
  },
}

// BQC-6.8: light-theme variant — axe runs on it too (light contrast proof).
export const ReviewAsPropertyManagerLight: Story = {
  decorators: [withRole('PropertyManager')],
  parameters: { theme: 'light' },
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
}

// Review item as Staff — reply.manage denied → ReplyEditor is absent.
export const ReviewAsStaff: Story = {
  decorators: [withRole('Staff')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
}

// Feedback item — no reply editor regardless of role (sourceType !== 'review').
export const FeedbackDetail: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: feedbackItem,
    detail: feedbackDetail,
    statusActions: getStatusActions(feedbackItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
    notes: [],
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
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
    statusActions: getStatusActions(longTextItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
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

// Status mutation in flight — the transition buttons lock (disabled) until it
// settles, matching the detail panel's isPending gating.
export const StatusUpdating: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction({ isPending: true }),
    escalate: makeIdAction({ isPending: true }),
    resolveEscalation: makeIdAction({ isPending: true }),
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
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
      reviewContentStatus: 'expired',
    },
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
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
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
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

// A foreign-language review — the guest's original words stay primary and
// Google's translation renders beneath them, labelled with its provenance.
export const ReviewWithGoogleTranslation: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: translatedReviewDetail,
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
    notes,
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    detailFns,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(BG_ORIGINAL)).toBeInTheDocument()
    await expect(canvas.getByText(EN_TRANSLATION)).toBeInTheDocument()
    await expect(canvas.getByText('Translated by Google')).toBeInTheDocument()
  },
}

// No translation available (an English review) — only the original renders,
// with no caption and no empty translation block.
export const ReviewWithoutTranslation: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    statusActions: getStatusActions(reviewItem.status),
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
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
  },
}
