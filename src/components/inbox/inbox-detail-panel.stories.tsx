// Inbox detail panel — the desktop (md+) side pane. Branches on detailState:
// isLoading → skeleton, error → retry CTA, otherwise renders InboxDetailContent
// (which itself is permission-gated). Stories build a mock InboxDetailState to
// hit each branch. The panel uses `hidden md:flex`, so a desktop viewport is
// required for it to be visible.
import type { Meta, StoryObj } from '@storybook/react'
import { InboxDetailPanel } from './inbox-detail-panel'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import type { Action } from '#/components/hooks/use-action'
import type { InboxDetailState } from './use-inbox-detail'
import type { addInboxNoteFn, getInboxItemDetailFn } from '#/contexts/inbox/server/inbox'
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
  // Never invoked in these stories: detailState is mocked, so the only caller
  // (the revision-conflict retry) cannot run.
  getInboxItemDetail: mockServerFn(async () => {
    throw new Error('Story action only')
  }) as unknown as typeof getInboxItemDetailFn,
  getActivityTimeline: mockServerFn(
    async () => [],
  ) as unknown as typeof getActivityTimelineFn,
  addInboxNote: mockServerFn(async () => ({
    ok: true,
  })) as unknown as typeof addInboxNoteFn,
}

const item = makeInboxItem({
  id: 'rev-panel',
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

const meta: Meta<typeof InboxDetailPanel> = {
  title: 'Inbox/Detail Panel',
  component: InboxDetailPanel,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktopManager' },
  },
}
export default meta
type Story = StoryObj<typeof InboxDetailPanel>

// Populated review — renders InboxDetailContent (PM grants reply.manage).
export const Populated: Story = {
  decorators: [withRole('PropertyManager')],
  args: {
    selectedItem: item,
    detailState: makeDetailState({
      detail: {
        item,
        reviewText: 'Great location and very clean rooms.',
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
    onClose: () => {},
    detailFns,
  },
}

// detailState.isLoading → skeleton placeholders.
export const Loading: Story = {
  args: {
    selectedItem: item,
    detailState: makeDetailState({ isLoading: true, currentItem: null, detail: null }),
    onClose: () => {},
    detailFns,
  },
}

// detailState.error → destructive message + Retry (calls refetch).
export const ErrorState: Story = {
  args: {
    selectedItem: item,
    detailState: makeDetailState({
      error: 'Failed to load inbox detail.',
      currentItem: item,
      detail: null,
    }),
    onClose: () => {},
    detailFns,
  },
}
