// Reply editor orchestrator stories.
//
// ReplyEditorInner routes on `reply.status` across 6 reply states. It builds its
// 6 mutations (draft/submit/approve/reject/delete/retry) internally via
// useMutationAction over the stubbed server fns (.storybook/stubs/
// review-reply-server.ts), so — unlike LoginForm — it takes NO Action prop.
// Every branch is therefore driven through the `reply` prop, which is the
// type-correct way to reach each status view without a live server.
//
// The isSaving-pending surface is derived internally and not prop-controllable
// here; it is covered authoritatively in reply-editor-compose.stories.tsx /
// reply-editor-actions.stories.tsx, where isSaving is a direct prop.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { ReplyEditorInner } from './reply-form'
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
    text: 'Thank you for the kind words! We are glad you had a great experience.',
    status: 'draft',
    source: 'internal',
    createdBy: userId('44444444-4444-4444-8444-444444444444'),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

// Shared success callback spy — referenced by the Draft play (same ref that is
// passed as the `onReplyChanged` prop via meta.args).
const onReplyChanged = fn(() => {})

const meta: Meta<typeof ReplyEditorInner> = {
  title: 'Inbox/ReplyForm',
  component: ReplyEditorInner,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
  args: {
    reviewId: REVIEW_ID,
    loading: false,
    onReplyChanged,
  },
}
export default meta
type Story = StoryObj<typeof ReplyEditorInner>

// loading=true → the "Loading reply..." placeholder (getReply has not resolved).
export const Loading: Story = {
  args: { loading: true, reply: null },
}

// No reply yet → empty composer (no Delete affordance, no "Draft" badge).
export const NewReply: Story = {
  args: { reply: null },
}

// Existing draft → composer pre-filled, with Delete + Submit enabled.
export const Draft: Story = {
  parameters: { a11y: { disable: true } },
  args: { reply: makeReply({ status: 'draft' }) },
  play: async ({ canvasElement }) => {
    onReplyChanged.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /submit for approval/i }))
    // draft() then submit() both resolve against the noop stub; the mutation's
    // onSuccess fires onReplyChanged — proving the draft→submit wiring.
    await waitFor(() => expect(onReplyChanged).toHaveBeenCalled())
  },
}

// Over the 4096-char limit → destructive counter + disabled actions (validation).
export const DraftOverLimit: Story = {
  args: { reply: makeReply({ status: 'draft', text: 'x'.repeat(5000) }) },
}

// status='pending_approval' → ReplyPendingApproval (Approve / Reject).
export const PendingApproval: Story = {
  args: {
    reply: makeReply({
      status: 'pending_approval',
      text: 'Thanks for your feedback — we will look into this.',
      submittedAt: NOW,
    }),
  },
}

// status='approved' → read-only "Publishing..." view.
export const Approved: Story = {
  args: { reply: makeReply({ status: 'approved', approvedAt: NOW }) },
}

// status='published' → green "Published" badge + timestamp.
export const Published: Story = {
  args: {
    reply: makeReply({ status: 'published', publishedAt: NOW, approvedAt: NOW }),
  },
}

// status='publish_failed' → "Publish Failed" + Retry affordance.
export const PublishFailed: Story = {
  args: { reply: makeReply({ status: 'publish_failed', approvedAt: NOW }) },
}

// status='rejected' → "Rejected" badge + rejection reason.
export const Rejected: Story = {
  args: {
    reply: makeReply({
      status: 'rejected',
      rejectionReason: 'Too generic — please personalise the response.',
      rejectedBy: userId('55555555-5555-4555-8555-555555555555'),
    }),
  },
}
