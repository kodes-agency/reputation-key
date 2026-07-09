// Reply status action views — pending_approval / publish_failed / rejected.
//
// These three sibling views each take plain callbacks + an isSaving flag (not
// Action objects), so stories inject fn() spies. render-based stories let one
// file cover all three exported components under a single CSF title.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  ReplyPendingApproval,
  ReplyPublishFailed,
  ReviewReplyRejected,
} from './reply-editor-actions'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const replyText = 'Thank you for your review! We appreciate your feedback.'

const onApprove = fn(async () => undefined)
const onReject = fn(async (_reason?: string) => undefined)
const onRetry = fn(async () => undefined)
const onEditResubmit = fn(() => {})

const meta: Meta<typeof ReplyPendingApproval> = {
  title: 'Inbox/ReplyEditorActions',
  component: ReplyPendingApproval,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof ReplyPendingApproval>

// ── pending_approval ─────────────────────────────────────────────────

// Awaiting approval → Approve + Reject actions.
export const PendingApproval: Story = {
  render: () => (
    <ReplyPendingApproval
      reply={{ text: replyText, publishedAt: null, rejectionReason: null }}
      isSaving={false}
      onApprove={onApprove}
      onReject={onReject}
    />
  ),
}

// isSaving → Approve + Reject both disabled.
export const PendingApprovalSaving: Story = {
  render: () => (
    <ReplyPendingApproval
      reply={{ text: replyText, publishedAt: null, rejectionReason: null }}
      isSaving={true}
      onApprove={onApprove}
      onReject={onReject}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /approve/i })).toBeDisabled()
    expect(canvas.getByRole('button', { name: /^reject$/i })).toBeDisabled()
  },
}

// Reject flow → reveal reason input → Confirm Reject → onReject receives reason.
export const RejectWithReason: Story = {
  render: () => (
    <ReplyPendingApproval
      reply={{ text: replyText, publishedAt: null, rejectionReason: null }}
      isSaving={false}
      onApprove={onApprove}
      onReject={onReject}
    />
  ),
  play: async ({ canvasElement }) => {
    onReject.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^reject$/i }))
    await userEvent.type(
      canvas.getByPlaceholderText(/reason for rejection/i),
      'Needs personalisation',
    )
    await userEvent.click(canvas.getByRole('button', { name: /confirm reject/i }))
    expect(onReject).toHaveBeenCalledWith('Needs personalisation')
  },
}

// ── publish_failed ────────────────────────────────────────────────────

// Publish failed → error note + Retry action.
export const PublishFailed: Story = {
  render: () => (
    <ReplyPublishFailed
      reply={{ text: replyText, publishedAt: null, rejectionReason: null }}
      isSaving={false}
      onRetry={onRetry}
    />
  ),
}

// isSaving → Retry disabled.
export const PublishFailedSaving: Story = {
  render: () => (
    <ReplyPublishFailed
      reply={{ text: replyText, publishedAt: null, rejectionReason: null }}
      isSaving={true}
      onRetry={onRetry}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /retry publish/i })).toBeDisabled()
  },
}

// ── rejected ──────────────────────────────────────────────────────────

// Rejected with a reason → reason line renders.
export const Rejected: Story = {
  render: () => (
    <ReviewReplyRejected
      reply={{
        text: replyText,
        publishedAt: null,
        rejectionReason: 'Too generic — please personalise.',
      }}
      isSaving={false}
      onEditResubmit={onEditResubmit}
    />
  ),
}

// Rejected without a reason → no "Reason:" line.
export const RejectedNoReason: Story = {
  render: () => (
    <ReviewReplyRejected
      reply={{ text: replyText, publishedAt: null, rejectionReason: null }}
      isSaving={false}
      onEditResubmit={onEditResubmit}
    />
  ),
}
