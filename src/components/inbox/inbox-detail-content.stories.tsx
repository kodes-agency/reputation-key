// Inbox detail content — the body of the detail pane. Permission-gated:
// usePermissions() → can('reply.manage') decides whether the ReplyEditor mounts
// for review items. PropertyManager grants reply.manage (gate ON); Staff does
// not (gate OFF). The component also renders the status actions, activity
// timeline, and notes thread, so stories supply mock detailFns for all three.
import type { Meta, StoryObj } from '@storybook/react'
import { InboxDetailContent } from './inbox-detail-content'
import { getStatusActions } from './inbox-detail-helpers'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { Action } from '#/components/hooks/use-action'
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type { getReplyFn } from '#/contexts/review/server/reply'
import type {
  InboxItem,
  InboxItemDetail,
  InboxNote,
} from '#/contexts/inbox/application/public-api'

const reviewItem: InboxItem = makeInboxItem({
  id: 'rev-det',
  sourceType: 'review',
  status: 'new',
  rating: 4,
})
const feedbackItem: InboxItem = makeInboxItem({
  id: 'fb-det',
  sourceType: 'feedback',
  status: 'new',
  rating: 3,
})

const reviewDetail: InboxItemDetail = {
  item: reviewItem,
  reviewText: 'Wonderful stay — the front desk went above and beyond!',
  reviewerProfilePhotoUrl: null,
  feedbackComment: null,
  feedbackRatingValue: null,
}

const feedbackDetail: InboxItemDetail = {
  item: feedbackItem,
  reviewText: null,
  reviewerProfilePhotoUrl: null,
  feedbackComment: 'Loved the breakfast spread.',
  feedbackRatingValue: 5,
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
  getReply: mockServerFn(async () => null) as unknown as typeof getReplyFn,
}

// Mirrors the server fn's { data } payload + status enum (no 'new' — nothing
// transitions TO new). Output is InboxItem, matching the use-case return.
type StatusInput = {
  data: { inboxItemId: string; status: 'read' | 'addressed' | 'escalated' | 'archived' }
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
    statusActions: getStatusActions(reviewItem.status, reviewItem.sourceType),
    updateStatus: makeStatusAction(),
    notes,
    onNoteAdded: () => {},
    statusVersion: 0,
    detailFns,
  },
}

// Review item as Staff — reply.manage denied → ReplyEditor is absent.
export const ReviewAsStaff: Story = {
  decorators: [withRole('Staff')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    statusActions: getStatusActions(reviewItem.status, reviewItem.sourceType),
    updateStatus: makeStatusAction(),
    notes,
    onNoteAdded: () => {},
    statusVersion: 0,
    detailFns,
  },
}

// Feedback item — no reply editor regardless of role (sourceType !== 'review').
export const FeedbackDetail: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: feedbackItem,
    detail: feedbackDetail,
    statusActions: getStatusActions(feedbackItem.status, feedbackItem.sourceType),
    updateStatus: makeStatusAction(),
    notes: [],
    onNoteAdded: () => {},
    statusVersion: 0,
    detailFns,
  },
}

// Status mutation in flight — the transition buttons lock (disabled) until it
// settles, matching the detail panel's isPending gating.
export const StatusUpdating: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    currentItem: reviewItem,
    detail: reviewDetail,
    statusActions: getStatusActions(reviewItem.status, reviewItem.sourceType),
    updateStatus: makeStatusAction({ isPending: true }),
    notes,
    onNoteAdded: () => {},
    statusVersion: 0,
    detailFns,
  },
}
