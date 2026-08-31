// Inbox detail sheet — the mobile slide-over detail view. Same detailState
// branching as the desktop panel (loading / error / populated), mounted inside
// a Sheet. Renders InboxDetailContent when loaded, which is permission-gated.
import type { Meta, StoryObj } from '@storybook/react'
import { InboxDetailSheet } from './inbox-detail-sheet'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { Action } from '#/components/hooks/use-action'
import type { InboxDetailState } from './use-inbox-detail'
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

// Mirrors the server fns' { data } payloads (same as the detail-content
// stories): updateStatus takes a status, escalate/resolveEscalation take only
// the id. Output is InboxItem, matching the use-case returns.
type StatusInput = {
  data: {
    inboxItemId: string
    status: 'open' | 'closed'
    expectedCommandRevision: number
  }
}
type IdInput = { data: { inboxItemId: string; expectedCommandRevision: number } }

function makeStatusAction(
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<StatusInput, InboxItem> {
  const impl = async (_input: StatusInput): Promise<InboxItem> => item
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
  const impl = async (_input: IdInput): Promise<InboxItem> => item
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  })
}

const unusedFeedbackAction = Object.assign(
  async () => {
    throw new Error('Story action only')
  },
  { isPending: false, error: null, isSuccess: false, data: null },
)

const detailFns = {
  getActivityTimeline: mockServerFn(
    async () => [],
  ) as unknown as typeof getActivityTimelineFn,
  addInboxNote: mockServerFn(async () => ({
    ok: true,
  })) as unknown as typeof addInboxNoteFn,
}

const item = makeInboxItem({
  id: 'rev-sheet',
  sourceType: 'review',
  status: 'open',
  rating: 4,
})

// Faithful InboxDetailState (the useInboxDetail return shape, post-5.7) —
// every key the hook returns, no dead keys, no casts.
function makeDetailState(overrides: Partial<InboxDetailState> = {}): InboxDetailState {
  return {
    detail: null,
    notes: [],
    isLoading: false,
    currentItem: item,
    updateStatus: makeStatusAction(),
    escalate: makeIdAction(),
    resolveEscalation: makeIdAction(),
    markFeedbackHandled: unusedFeedbackAction,
    correctFeedbackHandlingOutcome: unusedFeedbackAction,
    refetch: () => {},
    onNoteAdded: () => {},
    onReplyMutated: () => {},
    error: null,
    lastMarkedId: null,
    ...overrides,
  }
}

const meta: Meta<typeof InboxDetailSheet> = {
  title: 'Inbox/Detail Sheet',
  component: InboxDetailSheet,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobileStaff' },
  },
}
export default meta
type Story = StoryObj<typeof InboxDetailSheet>

// Open + loaded review → InboxDetailContent inside the slide-over (PM grants
// reply.manage, so the editor renders).
export const Open: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    open: true,
    onOpenChange: () => {},
    item,
    detailState: makeDetailState({
      detail: {
        item,
        reviewText: 'Quick and friendly check-in.',
        reviewTranslatedText: null,
        reviewerProfilePhotoUrl: null,
        reviewContentStatus: 'available',
        feedbackComment: null,
        feedbackRatingValue: null,
        reply: null,
        analysis: null,
        feedbackHandling: null,
        responseTarget: null,
      },
      notes: [],
    }),
    detailFns,
  },
}

// Open + loading → skeleton placeholders in the sheet body.
export const Loading: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    item,
    detailState: makeDetailState({ isLoading: true, currentItem: null, detail: null }),
    detailFns,
  },
}

// Open + error → destructive message + Retry.
export const ErrorState: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    item,
    detailState: makeDetailState({
      error: 'Failed to load inbox detail.',
      currentItem: item,
      detail: null,
    }),
    detailFns,
  },
}

// Closed — the sheet is dismissed (renders null since item gates render too,
// but open=false keeps the trigger state visible for documentation).
export const Closed: Story = {
  args: {
    open: false,
    onOpenChange: () => {},
    item,
    detailState: makeDetailState(),
    detailFns,
  },
}
