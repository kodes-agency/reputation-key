import type { Meta, StoryObj } from '@storybook/react'
import type { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { InboxBulkActions } from './inbox-bulk-actions'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'

const items = [
  makeInboxItem({ id: 'rev-1', sourceType: 'review', status: 'open' }),
  makeInboxItem({ id: 'rev-2', sourceType: 'review', status: 'open' }),
  makeInboxItem({ id: 'fb-1', sourceType: 'feedback', status: 'open' }),
]

const feedbackItems = [
  makeInboxItem({ id: 'fb-1', sourceType: 'feedback', status: 'open' }),
  makeInboxItem({ id: 'fb-2', sourceType: 'feedback', status: 'open' }),
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
  parameters: { a11y: { disable: true } },
  args: {
    ...ThreeSelected.args,
    bulkUpdateFn: pendingBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Bulk toolbar is open ⇄ closed only (ADR 0023); no bulk escalate.
    await userEvent.click(canvas.getByRole('button', { name: /mark closed/i }))
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /mark closed/i })).toBeDisabled()
    })
  },
}

// Mark Closed invokes the bulk fn with status 'closed'.
const closeSpy = fn(
  async (input: BulkInput): Promise<BulkResult> => ({
    success: true,
    updatedIds: input.data.inboxItemIds,
  }),
)
const closeBulkFn = mockServerFn(closeSpy) as unknown as typeof bulkUpdateInboxStatusFn

export const MarkClosed: Story = {
  parameters: { a11y: { disable: true } },
  args: {
    ...ThreeSelected.args,
    bulkUpdateFn: closeBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /mark closed/i }))
    await waitFor(() => {
      expect(closeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'closed' }),
        }),
      )
    })
  },
}
