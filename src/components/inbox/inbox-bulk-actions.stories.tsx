import type { Meta, StoryObj } from '@storybook/react'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { InboxBulkActions } from './inbox-bulk-actions'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'

const items = [
  makeInboxItem({ id: 'rev-1', sourceType: 'review', status: 'new' }),
  makeInboxItem({ id: 'rev-2', sourceType: 'review', status: 'new' }),
  makeInboxItem({ id: 'fb-1', sourceType: 'feedback', status: 'new' }),
]

const feedbackItems = [
  makeInboxItem({ id: 'fb-1', sourceType: 'feedback', status: 'new' }),
  makeInboxItem({ id: 'fb-2', sourceType: 'feedback', status: 'new' }),
]

type BulkInput = { data: { inboxItemIds: string[]; status: string } }
type BulkResult = { success: true; updatedIds: string[] }

// mockServerFn returns a plain callable; the prop type is `typeof serverFn`
// (carries createServerFn metadata the component never reads). The cast bridges
// that unexpressible server-fn brand.
const bulkUpdateFn = mockServerFn(
  async (input: BulkInput): Promise<BulkResult> => ({
    success: true,
    updatedIds: input.data.inboxItemIds,
  }),
) as unknown as typeof bulkUpdateInboxStatusFn

const meta: Meta<typeof InboxBulkActions> = {
  title: 'Inbox/Bulk Actions',
  component: InboxBulkActions,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof InboxBulkActions>

export const ThreeSelected: Story = {
  args: {
    selectedIds: ['rev-1', 'rev-2', 'fb-1'],
    items,
    onDone: () => {},
    bulkUpdateFn,
  },
}

export const OnlyReviewsSelected: Story = {
  args: {
    ...ThreeSelected.args,
    selectedIds: ['rev-1', 'rev-2'],
  },
}

// All selected items are feedback → "Mark Addressed" (feedback-only transition)
// is enabled, unlike OnlyReviewsSelected where it's disabled.
export const AllFeedback: Story = {
  args: {
    selectedIds: ['fb-1', 'fb-2'],
    items: feedbackItems,
    onDone: () => {},
    bulkUpdateFn,
  },
}

export const Empty: Story = {
  args: {
    selectedIds: [],
    items,
    onDone: () => {},
    bulkUpdateFn,
  },
}

// never-settling impl → after a click the mutation stays pending and the
// toolbar's action buttons lock (disabled) until it resolves.
const pendingBulkFn = mockServerFn(
  async (): Promise<BulkResult> => Promise.withResolvers<BulkResult>().promise,
) as unknown as typeof bulkUpdateInboxStatusFn

export const Pending: Story = {
  args: {
    ...ThreeSelected.args,
    bulkUpdateFn: pendingBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /escalate/i }))
    // The never-resolving mutation flips isPending → Escalate disables.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /escalate/i })).toBeDisabled()
    })
  },
}

// Escalate interaction: clicking Escalate invokes the bulk fn with
// status 'escalated'. `fn()` records the call so the play fn can assert it.
const escalateSpy = fn(
  async (input: BulkInput): Promise<BulkResult> => ({
    success: true,
    updatedIds: input.data.inboxItemIds,
  }),
)
const escalateBulkFn = mockServerFn(
  escalateSpy,
) as unknown as typeof bulkUpdateInboxStatusFn

export const Escalate: Story = {
  args: {
    ...ThreeSelected.args,
    bulkUpdateFn: escalateBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /escalate/i }))
    await waitFor(() => {
      expect(escalateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'escalated' }),
        }),
      )
    })
  },
}
