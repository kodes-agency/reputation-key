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
  propertyName?: string
  reviewLanguageCode?: string
  attention?: InboxItem['attention']
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
    propertyName: opts.propertyName ?? 'Acme Hotel',
    reviewLanguageCode: opts.reviewLanguageCode,
    attention: opts.attention,
    isEscalated: opts.isEscalated ?? false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
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
    reviewLanguageCode: 'en',
  }),
  makeItem({
    id: 'rev-2',
    sourceType: 'review',
    status: 'open',
    rating: 5,
    reviewerName: 'Bob Critic',
    snippet: 'Fantastic experience overall.',
    propertyName: 'Beachside Resort',
    reviewLanguageCode: 'de',
  }),
  makeItem({
    id: 'fb-1',
    sourceType: 'feedback',
    status: 'open',
    attention: 'urgent',
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
  activeItemId: undefined,
  onToggleSelect: fn(),
  onRowClick: fn(),
}

// Compact review and feedback rows with property-first metadata.
export const Default: Story = {
  args: { ...baseArgs },
}

// No items — the panel-level empty state handles this in composition.
export const Empty: Story = {
  args: { ...baseArgs, items: [] },
}

// One row checked for a bulk action.
export const WithSelection: Story = {
  args: { ...baseArgs, selectedIds: ['rev-1'] },
}

// Opening a row is independent of selecting it for a bulk action.
export const ActiveReview: Story = {
  args: {
    ...baseArgs,
    activeItemId: 'rev-2',
    selectedIds: ['rev-1'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', { name: /open review from bob critic/i }),
    ).toHaveAttribute('aria-current', 'true')
    expect(
      canvas.getByRole('checkbox', { name: /select item from alice reviewer/i }),
    ).toBeChecked()
  },
}

export const SelectionLimit: Story = {
  args: {
    ...baseArgs,
    selectedIds: ['rev-1', ...Array.from({ length: 99 }, (_, index) => `other-${index}`)],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('checkbox', {
        name: 'Select item from Bob Critic (100 item limit reached)',
      }),
    ).toBeDisabled()
    expect(
      canvas.getByRole('checkbox', { name: 'Select item from Alice Reviewer' }),
    ).toBeEnabled()
  },
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
