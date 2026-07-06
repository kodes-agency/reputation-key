// Reply editor fetcher stories.
//
// ReplyEditor wraps the raw `getReply` server fn with useServerFn, fetches on
// mount, and feeds the result to ReplyEditorInner. Stories inject a mock server
// fn (mockServerFn cast to the real fn type — the inbox-bulk-actions pattern)
// to reach loading / loaded-with-reply / fetch-error without RPC.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import type { getReplyFn } from '#/contexts/review/server/reply'
import { ReplyEditor } from './reply-editor'
import type { ReplyData } from './reply-form'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'

type Reply = NonNullable<ReplyData>
type GetReplyInput = { data: { reviewId: string } }

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

// A reply awaiting approval — proves the fetch → inner → pending_approval wiring.
const pendingReply = makeReply({ status: 'pending_approval' })

// never resolves → ReplyEditor stays in its loading state.
const loadingGetReply = mockServerFn(
  () => Promise.withResolvers<Reply | null>().promise,
) as unknown as typeof getReplyFn

const loadedGetReply = mockServerFn(
  async (_input: GetReplyInput): Promise<Reply | null> => pendingReply,
) as unknown as typeof getReplyFn

// rejects → ReplyEditor's .catch swallows it and falls back to the empty
// composer (graceful degradation, no crash).
const errorGetReply = mockServerFn(async (): Promise<Reply | null> => {
  throw new Error('reply_not_found')
}) as unknown as typeof getReplyFn

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

// getReply never settles → "Loading reply..." stays on screen.
export const Loading: Story = {
  args: { getReply: loadingGetReply },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/loading reply/i)).toBeInTheDocument()
  },
}

// getReply resolves the pending-approval reply → its text renders.
export const LoadedWithReply: Story = {
  args: { getReply: loadedGetReply },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/thanks for reaching out/i)).toBeInTheDocument()
  },
}

// getReply rejects → the editor falls back to the empty composer (no error UI).
export const FetchError: Story = {
  args: { getReply: errorGetReply },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByPlaceholderText(/write a reply/i)).toBeInTheDocument()
  },
}
