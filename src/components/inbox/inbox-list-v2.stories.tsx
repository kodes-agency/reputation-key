// Inbox list v2 — Gmail-style multi-line rows with per-row checkbox selection
// and row click to open detail. Presentational; rows are React.memo'd. Stories
// cover populated/empty/selected states plus select + row-open interactions.
// Items use distinct reviewer names so the per-row aria-labels are unambiguous.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { InboxListV2 } from './inbox-list-v2'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

// Minimal local factory — distinct names/snippets so getBy* queries are unique.
// Mirrors the makeInboxItem field shape from .storybook/in-memory/inbox-container.
function makeItem(opts: {
  id: string
  sourceType: 'review' | 'feedback'
  status?: InboxItem['status']
  rating?: number
  reviewerName?: string
  snippet?: string
  isEscalated?: boolean
}): InboxItem {
  return {
    id: opts.id as InboxItem['id'],
    organizationId: 'org-1' as InboxItem['organizationId'],
    propertyId: 'prop-1' as InboxItem['propertyId'],
    sourceType: opts.sourceType,
    sourceId: opts.id as InboxItem['sourceId'],
    status: opts.status ?? 'open',
    rating: opts.rating ?? 4,
    sourceDate: new Date('2025-01-01'),
    platform: 'google',
    snippet: opts.snippet ?? 'Great service, highly recommend!',
    assignedTo: null,
    reviewerName: opts.reviewerName ?? 'Anonymous',
    propertyName: 'Acme Hotel',
    isEscalated: opts.isEscalated ?? false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  }
}

const items: ReadonlyArray<InboxItem> = [
  makeItem({
    id: 'rev-1',
    sourceType: 'review',
    status: 'open',
    rating: 4,
    reviewerName: 'Alice Reviewer',
  }),
  makeItem({
    id: 'rev-2',
    sourceType: 'review',
    status: 'open',
    rating: 5,
    reviewerName: 'Bob Critic',
    snippet: 'Fantastic experience overall.',
  }),
  makeItem({
    id: 'fb-1',
    sourceType: 'feedback',
    status: 'open',
    isEscalated: true,
    rating: 2,
    reviewerName: 'Carol Guest',
    snippet: 'Slow response from support.',
  }),
]

const meta: Meta<typeof InboxListV2> = {
  title: 'Inbox/Item List',
  component: InboxListV2,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof InboxListV2>

const baseArgs = {
  items,
  selectedIds: [] as ReadonlyArray<string>,
  onToggleSelect: fn(),
  onSelectAll: fn(),
  onDeselectAll: fn(),
  onRowClick: fn(),
}

// Three items across statuses — "new" rows get the bold + left accent.
export const Default: Story = {
  args: { ...baseArgs },
}

// No items — the header still renders, showing "0 items".
export const Empty: Story = {
  args: { ...baseArgs, items: [] },
}

// One row checked — header reflects "1 selected".
export const WithSelection: Story = {
  args: { ...baseArgs, selectedIds: ['rev-1'] },
}

// Toggling a row checkbox fires onToggleSelect with that item's id.
// Module-level spies + mockClear keep the assertion stable across re-runs.
const toggleSpy = fn()
export const SelectRow: Story = {
  args: { ...baseArgs, onToggleSelect: toggleSpy },
  play: async ({ canvasElement }) => {
    toggleSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'Select item from Alice Reviewer' }),
    )
    expect(toggleSpy).toHaveBeenCalledWith('rev-1')
  },
}

// Clicking a row body fires onRowClick with the full item.
const rowClickSpy = fn()
export const OpenRow: Story = {
  args: { ...baseArgs, onRowClick: rowClickSpy },
  play: async ({ canvasElement }) => {
    rowClickSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: /open review from alice reviewer/i }),
    )
    expect(rowClickSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'rev-1' }))
  },
}
