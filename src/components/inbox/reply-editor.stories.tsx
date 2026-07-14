// Reply editor stories.
//
// ReplyEditor now receives the reply as a prop (folded into getInboxItemDetail)
// rather than fetching via getReply. Stories supply a reply fixture / loading
// flag directly — no mock server fn needed.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { ReplyEditor } from './reply-editor'
import type { ReplyData } from './reply-form'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

type Reply = NonNullable<ReplyData>

const NOW = new Date('2025-01-15T10:00:00Z')
const REVIEW_ID = '11111111-1111-4111-8111-111111111111'

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId('22222222-2222-4222-8222-222222222222'),
    reviewId: reviewId(REVIEW_ID),
    organizationId: organizationId('33333333-3333-4333-8333-333333333333'),
    text: 'Thanks for reaching out — we will follow up shortly.',
    status: 'pending_approval',
    source: 'internal',
    createdBy: userId('44444444-4444-4444-8444-444444444444'),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: NOW,
    approvedAt: null,
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const pendingReply = makeReply({ status: 'pending_approval' })

const meta: Meta<typeof ReplyEditor> = {
  title: 'Inbox/ReplyEditor',
  component: ReplyEditor,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
  args: { reviewId: REVIEW_ID },
}
export default meta
type Story = StoryObj<typeof ReplyEditor>

// loading=true → "Loading reply..." stays on screen (detail still loading).
export const Loading: Story = {
  parameters: { a11y: { disable: true } },
  args: { loading: true, initialReply: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/loading reply/i)).toBeInTheDocument()
  },
}

// initialReply is the pending-approval reply → its text renders.
export const LoadedWithReply: Story = {
  parameters: { a11y: { disable: true } },
  args: { loading: false, initialReply: pendingReply },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/thanks for reaching out/i)).toBeInTheDocument()
  },
}

// No reply yet → the empty composer (no error UI, no fetch).
export const NoReply: Story = {
  parameters: { a11y: { disable: true } },
  args: { loading: false, initialReply: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByPlaceholderText(/write a reply/i)).toBeInTheDocument()
  },
}
