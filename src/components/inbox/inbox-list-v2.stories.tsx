// Inbox list v2 — Gmail-style multi-line rows with per-row checkbox selection
// and row click to open detail. Presentational; rows are React.memo'd. Stories
// cover populated/empty/selected states, reply-state chips, and select +
// row-open interactions. Items use distinct reviewer names so per-row
// aria-labels are unambiguous.
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
  replyState?: InboxItem['replyState']
  assignedTo?: string | null
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
    assignedTo: (opts.assignedTo ?? null) as InboxItem['assignedTo'],
    reviewerName: opts.reviewerName ?? 'Anonymous',
    propertyName: opts.propertyName ?? 'Acme Hotel',
    reviewLanguageCode: opts.reviewLanguageCode,
    attention: opts.attention,
    ...(opts.replyState !== undefined ? { replyState: opts.replyState } : {}),
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

export const AwaitingApprovalReply: Story = {
  args: {
    ...baseArgs,
    items: [
      makeItem({
        id: 'rev-awaiting-approval',
        sourceType: 'review',
        reviewerName: 'Approval Reviewer',
        replyState: {
          status: 'pending_approval',
          publicationState: null,
          publicationLastErrorClass: null,
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Awaiting approval/)).toBeVisible()
    expect(
      canvas.getByRole('button', {
        name: /open review from approval reviewer, awaiting approval/i,
      }),
    ).toBeVisible()
  },
}

export const WaitingForGoogleReply: Story = {
  args: {
    ...baseArgs,
    items: [
      makeItem({
        id: 'rev-waiting-google',
        sourceType: 'review',
        reviewerName: 'Waiting Reviewer',
        replyState: {
          status: 'approved',
          publicationState: 'pending_observation',
          publicationLastErrorClass: null,
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Waiting for Google/)).toBeVisible()
    expect(
      canvas.getByRole('button', {
        name: /open review from waiting reviewer, waiting for google/i,
      }),
    ).toBeVisible()
  },
}

export const NeedsCheckReply: Story = {
  args: {
    ...baseArgs,
    items: [
      makeItem({
        id: 'rev-needs-check',
        sourceType: 'review',
        reviewerName: 'Ambiguous Reviewer',
        replyState: {
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationLastErrorClass: 'ambiguous',
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Needs a check/)).toBeVisible()
    expect(
      canvas.getByRole('button', {
        name: /open review from ambiguous reviewer, needs a check/i,
      }),
    ).toBeVisible()
  },
}

export const NotPublishedReply: Story = {
  args: {
    ...baseArgs,
    items: [
      makeItem({
        id: 'rev-not-published',
        sourceType: 'review',
        reviewerName: 'Retryable Reviewer',
        replyState: {
          status: 'publish_failed',
          publicationState: 'terminal',
          publicationLastErrorClass: 'retryable',
          updatedAt: new Date('2025-01-01T00:00:00Z'),
        },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/Not published/)).toBeVisible()
    expect(
      canvas.getByRole('button', {
        name: /open review from retryable reviewer, not published/i,
      }),
    ).toBeVisible()
  },
}

// No items — the panel-level empty state handles this in composition.
export const Empty: Story = {
  args: { ...baseArgs, items: [] },
}

// One row checked for a bulk action.
export const WithSelection: Story = {
  args: { ...baseArgs, selectedIds: ['rev-1'] },
}

export const AssignedOwnerIsDescribed: Story = {
  args: {
    ...baseArgs,
    items: [
      makeItem({
        id: 'rev-assigned',
        sourceType: 'review',
        reviewerName: 'Assigned Reviewer',
        assignedTo: 'owner-1',
      }),
    ],
    assignmentOptions: [{ userId: 'owner-1', name: 'Ada Owner' }],
  },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole('button', {
      name: 'Open review from Assigned Reviewer',
    })
    expect(row).toHaveAccessibleDescription('Assigned to Ada Owner')
  },
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

// ─── 390 px ──────────────────────────────────────────────────────────────────
// `mobileStaff` really is a 390 px window in this runner, but Tailwind is not
// compiled, so nothing here asserts a rectangle: the row's text start (x = 16),
// the 78 px height and the property's 40% cap are the Playwright metrics gate's.
// These mount the phone states that gate measures, and pin the content.
// Fullscreen, so the list spans the window as it does on the page: a centered
// story shrink-wraps the rows, and the gate could not read x = 16 off them.
const PHONE = {
  layout: 'fullscreen',
  viewport: { defaultViewport: 'mobileStaff' },
} as const

// 158 px of 13px medium text (measured): over the 153 px a 65% cap allowed on
// the 236 px identity line of a 320 px phone, and it still fits there beside
// "· Spa" (158 + 14 star + 9 rating + 29 property + 12 gaps = 222).
const NAME_FITTING_BESIDE_SHORT_PROPERTY = 'Bartholomew Featherstone'

const longNameItem = makeItem({
  id: 'rev-long',
  sourceType: 'review',
  reviewerName: 'Bartholomew Featherstonehaugh-Smythe',
  propertyName: 'The Grand Riverside Hotel and Spa',
})

// A long name beside a SHORT property: name and property fit the line together,
// so the name must not truncate (capping the name at 65% cut it at 320). The
// metrics gate reads that off this row.
const shortPropertyItem = makeItem({
  id: 'rev-short-property',
  sourceType: 'review',
  reviewerName: NAME_FITTING_BESIDE_SHORT_PROPERTY,
  propertyName: 'Spa',
})

// All properties: the guest name is the row's subject, so the PROPERTY is what
// gives way first; both parts stay in the accessible row.
export const AllPropertiesPhone: Story = {
  args: {
    ...baseArgs,
    items: [longNameItem, shortPropertyItem, ...items],
    allProperties: true,
  },
  parameters: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Bartholomew Featherstonehaugh-Smythe')).toBeVisible()
    expect(canvas.getByText(/The Grand Riverside Hotel and Spa/)).toBeVisible()
    expect(canvas.getByText(NAME_FITTING_BESIDE_SHORT_PROPERTY)).toBeVisible()
    expect(canvas.getByText(/· Spa/)).toBeVisible()
    expect(canvas.getByText(/Beachside Resort/)).toBeVisible()
  },
}

// A property name only shows when the list spans properties.
export const SingleProperty: Story = {
  args: { ...baseArgs, items: [longNameItem], allProperties: false },
  parameters: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Bartholomew Featherstonehaugh-Smythe')).toBeVisible()
    expect(canvas.queryByText(/The Grand Riverside/)).toBeNull()
  },
}

// Unread rows carry a dot in the left gutter, announced to screen readers.
export const NewSinceLastVisitPhone: Story = {
  args: { ...baseArgs, viewedUpTo: new Date('2024-12-31') },
  parameters: PHONE,
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByText('New since your last visit')).toHaveLength(
      items.length,
    )
  },
}

// Selecting on a phone: every row shows its checkbox, on the same gutter as the
// bulk bar's select-all.
export const SelectingPhone: Story = {
  args: { ...baseArgs, selectionMode: true, selectedIds: ['rev-1'] },
  parameters: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('checkbox')).toHaveLength(items.length)
    expect(
      canvas.getByRole('checkbox', { name: 'Select item from Alice Reviewer' }),
    ).toBeChecked()
    expect(canvas.queryByText('New since your last visit')).toBeNull()
  },
}
