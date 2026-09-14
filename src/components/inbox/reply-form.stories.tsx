// Reply editor orchestrator stories.
//
// ReplyEditor routes on reply status plus publication state, and since the
// detail-pane rebuild it renders the WRITABLE surface only: the composer, and
// the editor an open `editTarget` puts under the thread. Every read-only state
// is one message in the thread now (`reply-message.tsx` / `reply-message.stories.tsx`),
// so for those states this component must render NOTHING — a second copy here
// would put a manager in front of one reply in two places, which is the bug the
// rebuild removed. That emptiness is the assertion, not an omission.
//
// It no longer builds its action mutations: `useReplyActions` is called once by
// the pane, so the thread's message and this editor share one `isSaving`. The
// host below stands in for the pane and builds that bag from the SAME stubbed
// server functions, so the draft→submit wiring asserted here is still the real
// one. Every branch is otherwise driven through the `reply` prop plus
// `editTarget`, which is the type-correct way to reach each view without a
// live server.
//
// The isSaving-pending surface is derived internally and not prop-controllable
// here; it is covered authoritatively in reply-editor-compose.stories.tsx and
// reply-message.stories.tsx, where isSaving is a direct prop.
import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { ReplyEditor } from './reply-form'
import type { ReplyData } from './reply-form'
import { useReplyActions } from './use-reply-actions'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

type Reply = Exclude<NonNullable<ReplyData>, { kind: 'google_observation' }>

const NOW = new Date('2025-01-15T10:00:00Z')
const REVIEW_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '55555555-5555-4555-8555-555555555555'

const REPLY_TEXT = 'Thank you for the kind words! We are glad you had a great experience.'
const REJECTED_TEXT = 'Thanks for the feedback.'

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId('22222222-2222-4222-8222-222222222222'),
    reviewId: reviewId(REVIEW_ID),
    organizationId: organizationId('33333333-3333-4333-8333-333333333333'),
    text: REPLY_TEXT,
    status: 'draft',
    source: 'internal',
    createdBy: userId('44444444-4444-4444-8444-444444444444'),
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: null,
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
    templateId: overrides.templateId ?? null,
    templateVersion: overrides.templateVersion ?? null,
  }
}

// Shared success callback spy — referenced by the Draft play (the same ref the
// host below hands to `useReplyActions`, so the mutation's own onSuccess is
// what fires it).
const onReplyChanged = fn(() => {})
// The editor closed itself. The pane owns `editTarget`; this only reports it.
const onEditDone = fn(() => {})

/**
 * A read-only reply state reaches this component and produces no surface at
 * all. Asserted three ways because each catches a different regression: a
 * revived read-only view (text), a revived action row (button), a revived
 * editor (textbox).
 */
function expectNoWritableSurface(canvasElement: HTMLElement): void {
  const canvas = within(canvasElement)
  expect(canvas.queryAllByRole('textbox')).toHaveLength(0)
  expect(canvas.queryAllByRole('button')).toHaveLength(0)
  expect(canvasElement.textContent).toBe('')
}

/**
 * The pane's half of the contract: one `useReplyActions` for the whole detail
 * surface, handed to the editor as a prop. Building it here rather than letting
 * the editor build its own is the point — two instances gave the thread and the
 * editor independent `isSaving` flags on the same reply.
 */
function ReplyEditorInPane(props: Omit<ComponentProps<typeof ReplyEditor>, 'actions'>) {
  const actions = useReplyActions({ reviewId: REVIEW_ID, onReplyChanged })
  return <ReplyEditor {...props} actions={actions} />
}

const meta: Meta<typeof ReplyEditorInPane> = {
  title: 'Inbox/ReplyForm',
  component: ReplyEditorInPane,
  tags: ['autodocs'],
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
  args: {
    propertyId: PROPERTY_ID,
    reviewId: REVIEW_ID,
    loading: false,
    propertyDefaultReplyLanguage: 'en-Latn',
    reviewReplyLanguage: null,
    reviewLanguageReadiness: 'detectable',
    editTarget: null,
    caretRequest: 0,
    onEditDone,
  },
}
export default meta
type Story = StoryObj<typeof ReplyEditorInPane>

// ── the composer ─────────────────────────────────────────────────────────────

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

// Over the 4096-byte limit → destructive counter + disabled actions (validation).
export const DraftOverLimit: Story = {
  args: { reply: makeReply({ status: 'draft', text: 'x'.repeat(5000) }) },
}

// ── read-only states: the thread's, not this component's ─────────────────────

/**
 * Awaiting approval. Confirm & Publish and Reject are the thread message's
 * actions — see `reply-message.stories.tsx` → `AwaitingApproval`.
 */
export const PendingApproval: Story = {
  args: {
    reply: makeReply({
      status: 'pending_approval',
      text: 'Thanks for your feedback — we will look into this.',
      submittedAt: NOW,
    }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

/**
 * The three approved publication stages all resolve to one view, and that view
 * is writable in none of them: once a reply is confirmed there is nothing here
 * to type into until Google answers. Each stage is kept as its own story
 * because each is a distinct `publicationState` through `resolveReplyView`.
 */
export const ApprovedQueued: Story = {
  args: {
    reply: makeReply({
      status: 'approved',
      publicationState: 'authorized',
      approvedAt: NOW,
    }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

export const ApprovedSending: Story = {
  args: {
    reply: makeReply({
      status: 'approved',
      publicationState: 'sending',
      publicationAttempts: 1,
      approvedAt: NOW,
    }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

export const ApprovedPendingObservation: Story = {
  args: {
    reply: makeReply({
      status: 'approved',
      publicationState: 'pending_observation',
      publicationAttempts: 1,
      approvedAt: NOW,
    }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

// A live reply is read-only here until the thread's Edit reply raises the target.
export const Published: Story = {
  args: {
    reply: makeReply({ status: 'published', publishedAt: NOW, approvedAt: NOW }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

// An ambiguous publication offers a re-read, never a re-send — and neither is here.
export const AmbiguousCheckOnly: Story = {
  args: {
    reply: makeReply({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationAttempts: 1,
      publicationLastErrorClass: 'ambiguous',
      approvedAt: NOW,
    }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

export const RetryableTerminal: Story = {
  args: {
    reply: makeReply({
      status: 'publish_failed',
      publicationState: 'terminal',
      publicationAttempts: 5,
      publicationLastErrorClass: 'retryable',
      approvedAt: NOW,
    }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

// A rejected reply with no edit open: the Edit & resubmit button is the thread's.
export const Rejected: Story = {
  args: {
    reply: makeReply({
      status: 'rejected',
      text: REJECTED_TEXT,
      rejectionReason: 'Too generic — please personalise the response.',
      rejectedBy: userId('55555555-5555-4555-8555-555555555555'),
    }),
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

// ── editTarget: the pane's state, and the only thing that opens an editor ────

/**
 * `editTarget: 'published'` is what the thread's Edit reply raises. The editor
 * that opens republishes in place — it never posts a second Google reply — so
 * its own confirmation is covered in reply-editor-views.stories.tsx.
 */
export const PublishedBeingEdited: Story = {
  args: {
    ...Published.args,
    editTarget: 'published',
  },
  play: async ({ canvasElement }) => {
    onEditDone.mockClear()
    const canvas = within(canvasElement)
    const field = canvas.getByRole('textbox', { name: 'Edit published reply' })
    expect(field).toHaveValue(REPLY_TEXT)
    // The editor mounts in a different subtree from the Edit reply button that
    // opened it, routinely below the fold. Taking the caret on mount is what
    // makes the click visible at all.
    expect(field).toHaveFocus()
    expect(canvas.getByRole('button', { name: 'Review update' })).toBeEnabled()

    // Cancelling is the pane's business: the editor only reports that it closed.
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    expect(onEditDone).toHaveBeenCalledOnce()
  },
}

/**
 * A publish failure does NOT share the published editor, whatever target the
 * pane is carrying. `editPublishedReply` refuses any reply that is not
 * `published`, and `REPLY_TRANSITIONS.publish_failed` has no `draft`, so no
 * server path exists today that changes the text of a publish-failed reply —
 * an editor here could only ever fail to save. Try again, in the thread
 * message, is this state's whole action list.
 *
 * Replaces `RetryableBeingEdited`, which asserted the editor opened.
 */
export const RetryableIgnoresEditTarget: Story = {
  args: {
    ...RetryableTerminal.args,
    editTarget: 'published',
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}

/**
 * Edit & resubmit is a `draftReplyFn` round trip, so by the time a surface
 * exists the reply is a draft and the composer — seeded from the refused text
 * — is what replaced the button the manager was standing on. A raised
 * `caretRequest` is the pane saying this composer was asked for, so it takes
 * the focus that button is losing; a composer that merely came with the item
 * (`caretRequest: 0`) must not. It is a counter rather than a flag so that the
 * `r` shortcut can raise it again from a composer that is already mounted.
 *
 * This is the ONLY rejected-reply editing story, because it is the only state
 * the running app reaches. `RejectedBeingEdited` stood here asserting an
 * `editTarget: 'rejected'` editor; `useActionMutation` awaits the cache patch
 * that lands `status: 'draft'` before `mutateAsync` resolves, so the pane could
 * never raise that target against a reply still resolving to `rejected`. The
 * target is gone from `ReplyEditTarget`, and a story cannot type it any more.
 */
export const ReopenedRejectedTakesFocus: Story = {
  args: {
    reply: makeReply({ status: 'draft', text: REJECTED_TEXT }),
    caretRequest: 1,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.findByRole('textbox', { name: 'Public reply' }),
    ).resolves.toHaveFocus()
  },
}

/** An edit target for a state that cannot be edited opens nothing. */
export const PendingApprovalIgnoresEditTarget: Story = {
  args: {
    ...PendingApproval.args,
    editTarget: 'published',
  },
  play: async ({ canvasElement }) => expectNoWritableSurface(canvasElement),
}
