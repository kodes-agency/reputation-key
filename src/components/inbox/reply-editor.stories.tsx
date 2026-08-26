// Reply editor stories.
//
// ReplyEditor now receives the reply as a prop (folded into getInboxItemDetail)
// rather than fetching via getReply. Stories supply a reply fixture / loading
// flag directly — no mock server fn needed.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { ReplyEditor } from './reply-editor'
import type { ReplyData } from './reply-form'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

type Reply = NonNullable<ReplyData>

const NOW = new Date('2025-01-15T10:00:00Z')
const REVIEW_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '55555555-5555-4555-8555-555555555555'

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
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationCycle: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const pendingReply = makeReply({ status: 'pending_approval' })
const approvedReply = makeReply({ status: 'approved' })
const publishedReply = makeReply({
  status: 'published',
  approvedAt: NOW,
  publishedAt: NOW,
  publicationState: 'published',
})

function ServerRefreshHarness() {
  const [reply, setReply] = useState<Reply>(approvedReply)
  return (
    <div className="space-y-4">
      <button type="button" onClick={() => setReply(publishedReply)}>
        Apply server refresh
      </button>
      <ReplyEditor
        propertyId={PROPERTY_ID}
        reviewId={REVIEW_ID}
        initialReply={reply}
        loading={false}
        propertyDefaultReplyLanguage="en-Latn"
        reviewReplyLanguage={null}
        canDetectReviewLanguage
      />
    </div>
  )
}

const meta: Meta<typeof ReplyEditor> = {
  title: 'Inbox/ReplyEditor',
  component: ReplyEditor,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
  args: {
    propertyId: PROPERTY_ID,
    reviewId: REVIEW_ID,
    propertyDefaultReplyLanguage: 'en-Latn',
    reviewReplyLanguage: null,
    canDetectReviewLanguage: true,
  },
}
export default meta
type Story = StoryObj<typeof ReplyEditor>

// loading=true → "Loading reply..." stays on screen (detail still loading).
export const Loading: Story = {
  args: { loading: true, initialReply: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/loading reply/i)).toBeInTheDocument()
  },
}

// initialReply is the pending-approval reply → its text renders.
export const LoadedWithReply: Story = {
  args: { loading: false, initialReply: pendingReply },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/thanks for reaching out/i)).toBeInTheDocument()
  },
}

// No reply yet → the empty composer (no error UI, no fetch).
export const NoReply: Story = {
  args: { loading: false, initialReply: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByPlaceholderText(/write a reply/i)).toBeInTheDocument()
  },
}

// The polling query is authoritative: when it observes provider publication,
// the editor must leave the transient publishing state without remounting.
export const FollowsServerRefresh: Story = {
  args: { loading: false, initialReply: approvedReply },
  render: () => <ServerRefreshHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Publishing...')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Apply server refresh' }))

    expect(await canvas.findByText('Published')).toBeVisible()
    expect(canvas.queryByText('Publishing...')).not.toBeInTheDocument()
  },
}
