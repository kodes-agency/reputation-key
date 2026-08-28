import type { Meta, StoryObj } from '@storybook/react'
import type {
  bulkAssignInboxItemsFn,
  bulkUpdateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
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
  makeInboxItem({ id: 'fb-1', sourceType: 'feedback', status: 'closed' }),
  makeInboxItem({ id: 'fb-2', sourceType: 'feedback', status: 'closed' }),
]

type BulkInput = {
  data: {
    items: Array<{ inboxItemId: string; expectedCommandRevision: number }>
    status: string
    reopenReason: string
    reopenExplanation?: string | null
  }
}
type BulkResult = {
  updated: number
  results: Array<{
    inboxItemId: string
    outcome: 'reopened' | 'already_open' | 'revision_conflict' | 'unavailable'
  }>
}

// mockServerFn returns a plain callable; the prop type is `typeof serverFn`
// (carries createServerFn metadata the component never reads). The cast bridges
// that unexpressible server-fn brand.
const reopenedResult = (input: BulkInput): BulkResult => ({
  updated: input.data.items.length,
  results: input.data.items.map((item) => ({
    inboxItemId: item.inboxItemId,
    outcome: 'reopened',
  })),
})

const bulkUpdateFn = mockServerFn(async (input: BulkInput): Promise<BulkResult> =>
  reopenedResult(input),
) as unknown as typeof bulkUpdateInboxStatusFn

type BulkAssignmentInput = {
  data: {
    items: Array<{ inboxItemId: string; expectedCommandRevision: number }>
    assignedToUserId: string | null
  }
}
type BulkAssignmentResult = {
  updated: number
  bulkId: string | null
  results: Array<{
    inboxItemId: string
    outcome: 'assigned' | 'reassigned' | 'released' | 'unchanged'
  }>
}

const assignedResult = (input: BulkAssignmentInput): BulkAssignmentResult => ({
  updated: input.data.items.length,
  bulkId: '11111111-1111-4111-8111-111111111111',
  results: input.data.items.map((item) => ({
    inboxItemId: item.inboxItemId,
    outcome: input.data.assignedToUserId === null ? 'released' : 'assigned',
  })),
})

const bulkAssignFn = mockServerFn(
  async (input: BulkAssignmentInput): Promise<BulkAssignmentResult> =>
    assignedResult(input),
) as unknown as typeof bulkAssignInboxItemsFn

const assignmentOptions = [
  { userId: 'manager-1', name: 'Morgan Manager' },
  { userId: 'manager-2', name: 'Riley Reviewer' },
]

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
    onSelectAll: fn(),
    onClearSelection: fn(),
    bulkUpdateFn,
    bulkAssignFn,
    assignmentOptions,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /^close$/i })).toBeNull()
    expect(canvas.getByRole('button', { name: /^reopen$/i })).toBeDisabled()
  },
}

export const OnlyReviewsSelected: Story = {
  args: {
    ...ThreeSelected.args,
    selectedIds: ['rev-1', 'rev-2'],
  },
}

// Closed feedback remains eligible for the one beta bulk transition: reopen.
export const AllFeedback: Story = {
  args: {
    selectedIds: ['fb-1', 'fb-2'],
    items: feedbackItems,
    onDone: () => {},
    onSelectAll: fn(),
    onClearSelection: fn(),
    bulkUpdateFn,
    bulkAssignFn,
    assignmentOptions,
  },
}

export const Empty: Story = {
  args: {
    selectedIds: [],
    items,
    onDone: () => {},
    onSelectAll: fn(),
    onClearSelection: fn(),
    bulkUpdateFn,
    bulkAssignFn,
    assignmentOptions,
  },
}

// never-settling impl → after a click the mutation stays pending and the
// reopen action locks until it resolves.
const pendingBulkFn = mockServerFn(
  async (): Promise<BulkResult> => Promise.withResolvers<BulkResult>().promise,
) as unknown as typeof bulkUpdateInboxStatusFn

export const Pending: Story = {
  args: {
    ...AllFeedback.args,
    bulkUpdateFn: pendingBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^reopen$/i }))
    const body = within(document.body)
    await userEvent.click(body.getByRole('combobox', { name: /reason for reopening/i }))
    await userEvent.click(body.getByRole('option', { name: /new information/i }))
    const dialog = body.getByRole('dialog')
    const confirmButton = within(dialog).getByRole('button', { name: /^reopen$/i })
    await userEvent.click(confirmButton)
    await waitFor(() => {
      expect(confirmButton).toBeDisabled()
    })
  },
}

// Reopen invokes the bulk fn with the only accepted beta target, `open`.
const reopenSpy = fn(async (input: BulkInput): Promise<BulkResult> => ({
  ...reopenedResult(input),
}))
const reopenBulkFn = mockServerFn(reopenSpy) as unknown as typeof bulkUpdateInboxStatusFn

export const ReopenClosed: Story = {
  args: {
    ...AllFeedback.args,
    bulkUpdateFn: reopenBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /^close$/i })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /^reopen$/i }))
    const body = within(document.body)
    await userEvent.click(body.getByRole('combobox', { name: /reason for reopening/i }))
    await userEvent.click(body.getByRole('option', { name: /new information/i }))
    await userEvent.click(
      within(body.getByRole('dialog')).getByRole('button', { name: /^reopen$/i }),
    )
    await waitFor(() => {
      expect(reopenSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'open',
            reopenReason: 'new_information',
            reopenExplanation: null,
          }),
        }),
      )
      expect(reopenSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: feedbackItems.map((item) => ({
              inboxItemId: item.id,
              expectedCommandRevision: item.commandRevision,
            })),
          }),
        }),
      )
    })
  },
}

const failingBulkFn = mockServerFn(async (): Promise<BulkResult> => {
  throw new Error('The selected items changed. Reload and try again.')
}) as unknown as typeof bulkUpdateInboxStatusFn

export const ReopenError: Story = {
  args: {
    ...AllFeedback.args,
    bulkUpdateFn: failingBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^reopen$/i }))
    const body = within(document.body)
    await userEvent.click(body.getByRole('combobox', { name: /reason for reopening/i }))
    await userEvent.click(body.getByRole('option', { name: /new information/i }))
    await userEvent.click(
      within(body.getByRole('dialog')).getByRole('button', { name: /^reopen$/i }),
    )
    expect(
      await canvas.findByText(/selected items changed\. reload and try again/i),
    ).toBeVisible()
  },
}

const assignmentSpy = fn(
  async (input: BulkAssignmentInput): Promise<BulkAssignmentResult> =>
    assignedResult(input),
)
const assignmentBulkFn = mockServerFn(
  assignmentSpy,
) as unknown as typeof bulkAssignInboxItemsFn

export const AssignSelected: Story = {
  args: {
    ...ThreeSelected.args,
    bulkAssignFn: assignmentBulkFn,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^assign$/i }))
    const body = within(document.body)
    await userEvent.click(body.getByRole('combobox', { name: /^assignment$/i }))
    await userEvent.click(body.getByRole('option', { name: /morgan manager/i }))
    await userEvent.click(
      within(body.getByRole('dialog')).getByRole('button', { name: /apply to all/i }),
    )
    await waitFor(() => {
      expect(assignmentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            items: items.map((item) => ({
              inboxItemId: item.id,
              expectedCommandRevision: item.commandRevision,
            })),
            assignedToUserId: 'manager-1',
          },
        }),
      )
    })
  },
}

const overLimitItems = Array.from({ length: 101 }, (_, index) =>
  makeInboxItem({ id: `review-${index}`, sourceType: 'review', status: 'open' }),
)

export const BulkLimit: Story = {
  args: {
    ...ThreeSelected.args,
    items: overLimitItems,
    selectedIds: ['review-0'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('100 maximum')).toBeVisible()
    expect(
      canvas.getByRole('checkbox', { name: 'Select first 100 loaded reviews' }),
    ).toBeVisible()
  },
}
