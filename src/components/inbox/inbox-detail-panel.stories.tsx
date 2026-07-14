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
import type { addInboxNoteFn } from '#/contexts/inbox/server/inbox'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'

type StatusInput = { data: { inboxItemId: string; status: string } }

function makeStatusAction(
  overrides: { isPending?: boolean; error?: unknown; isSuccess?: boolean } = {},
): Action<StatusInput, unknown> {
  const impl = async (_input: StatusInput): Promise<unknown> => ({ ok: true })
  return Object.assign(impl, {
    isPending: overrides.isPending ?? false,
    error: overrides.error ?? null,
    isSuccess: overrides.isSuccess ?? false,
    data: null,
  }) as Action<StatusInput, unknown>
}

const detailFns = {
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

// Named InboxDetailState (exported) — not ReturnType<typeof useInboxDetail>.
function makeDetailState(overrides: Partial<InboxDetailState> = {}): InboxDetailState {
  return {
    detail: null,
    notes: [],
    isLoading: false,
    currentItem: item,
    updateStatus: makeStatusAction(),
    refresh: () => {},
    error: null,
    lastMarkedId: null,
    statusVersion: 0,
    ...overrides,
  } as unknown as InboxDetailState
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
        reviewerProfilePhotoUrl: null,
        feedbackComment: null,
        feedbackRatingValue: null,
        reply: null,
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

// detailState.error → destructive message + Retry (calls refresh).
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
