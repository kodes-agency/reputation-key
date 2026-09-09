// Reply status action views — pending approval, publication recovery, rejected.
//
// The sibling views take plain callbacks + an isSaving flag. Render-based
// stories keep their operator copy and send-vs-check controls independently
// testable under one CSF title.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  ReplyPendingApproval,
  ReplyPublicationNeedsCheck,
  ReplyPublicationRetryable,
  ReviewReplyRejected,
} from './reply-editor-actions'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const replyText = 'Thank you for your review! We appreciate your feedback.'

const onApprove = fn(async () => undefined)
const onReject = fn(async (_reason?: string) => undefined)
const onRetry = fn(async () => undefined)
const onCheck = fn(async () => undefined)
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

// Awaiting approval → explicit Confirm & Publish + Reject actions.
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

// isSaving → Confirm & Publish + Reject both disabled.
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
    expect(canvas.getByRole('button', { name: /confirm & publish/i })).toBeDisabled()
    expect(canvas.getByRole('button', { name: /^reject$/i })).toBeDisabled()
  },
}

export const PendingApprovalWithUnfilledSlot: Story = {
  render: () => (
    <ReplyPendingApproval
      reply={{
        text: 'Dear {guest_name}, thank you.',
        publishedAt: null,
        rejectionReason: null,
      }}
      isSaving={false}
      onApprove={onApprove}
      onReject={onReject}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /confirm & publish/i })).toBeDisabled()
    expect(
      canvas.getByText(
        'Fill every template placeholder before publishing: {guest_name}.',
      ),
    ).toBeVisible()
  },
}

export const ConfirmAndPublish: Story = {
  render: () => (
    <ReplyPendingApproval
      reply={{ text: replyText, publishedAt: null, rejectionReason: null }}
      isSaving={false}
      onApprove={onApprove}
      onReject={onReject}
    />
  ),
  play: async ({ canvasElement }) => {
    onApprove.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /confirm & publish/i }))
    const dialog = await within(document.body).findByRole('alertdialog')
    // The confirmation copy is the assertion, and it mounts with the dialog's
    // entry animation — wait for it rather than sampling the first frame.
    await waitFor(() =>
      expect(
        within(dialog).getByText(/keeps it pending until google confirms/i),
      ).toBeVisible(),
    )
    await userEvent.click(
      within(dialog).getByRole('button', { name: /confirm & publish/i }),
    )
    expect(onApprove).toHaveBeenCalledOnce()
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

// ── publication recovery ──────────────────────────────────────────────

export const AmbiguousCheckOnly: Story = {
  render: () => (
    <ReplyPublicationNeedsCheck
      reply={{
        text: replyText,
        publishedAt: null,
        rejectionReason: null,
        publicationAttempts: 1,
        publicationLastErrorClass: 'ambiguous',
      }}
      isSaving={false}
      onCheck={onCheck}
    />
  ),
  play: async ({ canvasElement }) => {
    onCheck.mockClear()
    const canvas = within(canvasElement)
    expect(canvas.getByText('Google status unconfirmed')).toBeInTheDocument()
    expect(
      canvas.getByText(/will only check Google—it will not send this reply again/i),
    ).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: /publish|retry|send/i })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Check Google again' }))
    expect(onCheck).toHaveBeenCalledOnce()
  },
}

export const AmbiguousCheckInProgress: Story = {
  render: () => (
    <ReplyPublicationNeedsCheck
      reply={{
        text: replyText,
        publishedAt: null,
        rejectionReason: null,
        publicationAttempts: 1,
        publicationLastErrorClass: 'ambiguous',
      }}
      isSaving
      onCheck={onCheck}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Checking Google…' })).toBeDisabled()
  },
}

export const RetryableTerminal: Story = {
  render: () => (
    <ReplyPublicationRetryable
      reply={{
        text: replyText,
        publishedAt: null,
        rejectionReason: null,
        publicationAttempts: 5,
        publicationLastErrorClass: 'retryable',
      }}
      isSaving={false}
      onRetry={onRetry}
    />
  ),
  play: async ({ canvasElement }) => {
    onRetry.mockClear()
    onCheck.mockClear()
    const canvas = within(canvasElement)
    expect(canvas.getByText('Publishing stopped')).toBeInTheDocument()
    expect(canvas.getByText(/stopped after 5 attempts/i)).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Try publishing again' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onCheck).not.toHaveBeenCalled()
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
