// Inbox reply — a confirmed command the server refuses, under a pane that
// re-reads.
//
// Confirm & publish and Confirm & update sit behind a confirmation, and a
// confirmation normally prints its own refusal (`ui/confirmation-dialog.tsx`).
// These two cannot. A refusal usually means another manager already moved the
// reply, so the command re-reads it (`inboxCachePolicy.onReplyCommandFailed`);
// that read remounts the action row under the reply's new status and ends the
// edit target, and the dialog is drawn inside them. A sentence held in the
// dialog was on screen for the length of one read and then gone, with nothing
// to say the command had been refused. So the refusal is a toast, which
// outlives the read, and the dialog closes.
//
// The pane here is the real one in miniature: the real `useReplyActions` over
// the real detail cache and cache policy, the real message, editor and edit
// target rule, and the app's `Toaster`. Only the server is scripted
// (`scriptReplyCommand`, the Storybook stand-in for the reply server functions).
import type { Meta, StoryObj } from '@storybook/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { scriptReplyCommand } from '../../../.storybook/stubs/review-reply-server'
import { Toaster } from '#/components/ui/sonner'
import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import { inboxKeys } from '#/shared/queries/query-keys'
import { liveEditTarget } from './composer-policy'
import { inboxCachePolicy } from './inbox-cache-policy'
import { ReplyMessage } from './reply-message'
import { ReplyPublishedEditor } from './reply-published-edit'
import { REPLY_CHIP_WORDS } from './reply-state-copy'
import { resolveReplyView, type ReplyData } from './reply-status-view'
import { useReplyActions } from './use-reply-actions'

type Reply = Exclude<NonNullable<ReplyData>, { kind: 'google_observation' }>

const ITEM_ID = 'reply-refusal-item'
const PROPERTY_NAME = 'Seaside Rooms'
const AUTHOR_LABEL = `Reply from ${PROPERTY_NAME}`
const REJECTION_REASON = 'Too generic; please name the housekeeping fix we made.'

/** What `transitionReply` answers, as `reviewErrorStatus` sends it (a 400). */
const NOT_AWAITING_APPROVAL = "Cannot transition reply from 'rejected' to 'approved'"
/** `editPublishedReply`'s own sentence (review/application/use-cases/reply-operations.ts). */
const NOT_PUBLISHED = 'Only a published reply can be edited and republished'

const SUBMITTED_AT = new Date('2026-09-11T09:00:00.000Z')
const APPROVED_AT = new Date('2026-09-11T09:05:00.000Z')
const PUBLISHED_AT = new Date('2026-09-11T09:20:00.000Z')

// `makeInboxItem` gives a review item its own id as the review's (`sourceId`),
// which is how the cache policy finds the detail a reply command is about.
const ITEM = makeInboxItem({ id: ITEM_ID, sourceType: 'review' })

const AWAITING_APPROVAL: Reply = {
  id: replyId('66666666-6666-4666-8666-666666666666'),
  reviewId: reviewId(ITEM_ID),
  organizationId: organizationId('77777777-7777-4777-8777-777777777777'),
  text: 'Thank you for the kind words. We are glad the sea view lived up to the photos.',
  replyLanguageTag: 'en-Latn',
  templateId: null,
  templateVersion: null,
  status: 'pending_approval',
  source: 'internal',
  createdBy: userId('88888888-8888-4888-8888-888888888888'),
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 1,
  submittedAt: SUBMITTED_AT,
  approvedAt: null,
  publishedAt: null,
  publicationState: null,
  publicationAttempts: 0,
  publicationCycle: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: SUBMITTED_AT,
  updatedAt: SUBMITTED_AT,
}

const LIVE_ON_GOOGLE: Reply = {
  ...AWAITING_APPROVAL,
  status: 'published',
  approvedBy: userId('99999999-9999-4999-8999-999999999999'),
  approvedAt: APPROVED_AT,
  publishedAt: PUBLISHED_AT,
  publicationState: 'published',
  publicationAttempts: 1,
  publicationCycle: 1,
  stateRevision: 3,
  updatedAt: PUBLISHED_AT,
}

/** The reply as the server holds it. Another manager's command changes only this. */
let serverReply: Reply = AWAITING_APPROVAL

const readDetail = async (): Promise<InboxItemDetailResult> => ({
  item: ITEM,
  reviewText: 'Lovely room and a quiet night.',
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  reviewContentStatus: 'available',
  reviewRating: 5,
  feedbackComment: null,
  feedbackRatingValue: null,
  reply: serverReply,
  analysis: null,
  feedbackHandling: null,
  responseTarget: null,
})

const refusal = (message: string) =>
  new ServerFunctionError('ReviewError', message, 'invalid_transition', 400)

/**
 * The reply half of the detail pane: the open item's detail read as
 * `useInboxDetailQueries` reads it, one reply command family, the thread
 * message, and the published editor while its edit target is live
 * (`liveEditTarget`, the rule `useInboxComposerController` applies).
 */
function ReplyPane(): ReactNode {
  const queryClient = useQueryClient()
  const { data: detail } = useQuery({
    queryKey: inboxKeys.detail(ITEM_ID),
    queryFn: readDetail,
    staleTime: 0,
  })
  const actions = useReplyActions({
    reviewId: ITEM.sourceId,
    onReplyChanged: (change) => inboxCachePolicy.onReplyChanged(queryClient, change),
  })
  const [isEditRequested, setEditRequested] = useState(false)
  if (!detail) return null

  const reply = detail.reply
  const editTarget = liveEditTarget(
    resolveReplyView(reply).kind,
    isEditRequested ? 'published' : null,
  )
  return (
    <>
      <ReplyMessage
        reply={reply}
        propertyName={PROPERTY_NAME}
        isSaving={actions.isSaving}
        isEditing={editTarget !== null}
        onApprove={actions.approve}
        onReject={actions.reject}
        onCheck={actions.check}
        onRetry={actions.retry}
        onEditPublished={() => setEditRequested(true)}
        onEditRejected={() => {}}
      />
      {editTarget === 'published' && reply && reply.kind !== 'google_observation' && (
        <ReplyPublishedEditor
          reply={reply}
          isSaving={actions.isSaving}
          onSaveEdit={actions.saveEdit}
          onClose={() => setEditRequested(false)}
        />
      )}
      <Toaster />
    </>
  )
}

const meta: Meta<typeof ReplyPane> = {
  title: 'Inbox/ReplyCommandRefusal',
  component: ReplyPane,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof ReplyPane>

/** The toast carrying `sentence`, once it has entered (sonner animates it in). */
async function expectRefusalToast(sentence: string): Promise<HTMLElement> {
  const text = await within(document.body).findByText(sentence)
  await waitFor(() => expect(text).toBeVisible())
  expect(text.closest('[data-sonner-toast]')).not.toBeNull()
  return text
}

/**
 * A colleague rejected the reply from another browser; nothing polls a reply
 * that waits for a person, so this pane still offers Confirm & publish. The
 * server refuses it. The manager is told why in a toast that is still there
 * after the pane has re-read, and the reply shows as rejected, with the reason.
 */
export const ARefusedConfirmationIsStillSaidAfterTheReRead: Story = {
  beforeEach: () => {
    serverReply = AWAITING_APPROVAL
    return scriptReplyCommand('approveReplyFn', async () => {
      throw refusal(NOT_AWAITING_APPROVAL)
    })
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const article = await canvas.findByRole('article', { name: AUTHOR_LABEL })
    const message = within(article)
    expect(message.getByText(REPLY_CHIP_WORDS.awaitingApproval)).toBeVisible()
    serverReply = {
      ...AWAITING_APPROVAL,
      status: 'rejected',
      rejectedBy: userId('99999999-9999-4999-8999-999999999999'),
      rejectionReason: REJECTION_REASON,
      stateRevision: 2,
    }

    await userEvent.click(message.getByRole('button', { name: 'Confirm & publish' }))
    const dialog = await within(document.body).findByRole('alertdialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm & publish' }),
    )

    const sentence = await expectRefusalToast(NOT_AWAITING_APPROVAL)
    // The pane re-read: the reply is rejected, and the refused command is gone.
    expect(await message.findByText(REPLY_CHIP_WORDS.rejected)).toBeVisible()
    expect(message.getByText(REJECTION_REASON)).toBeVisible()
    expect(message.queryByRole('button', { name: 'Confirm & publish' })).toBeNull()
    // The confirmation closed and printed nothing of its own...
    await waitFor(() =>
      expect(within(document.body).queryByRole('alertdialog')).toBeNull(),
    )
    // ...and the sentence outlived the read that took the dialog's place.
    expect(sentence).toBeVisible()
    expect(within(document.body).getAllByText(NOT_AWAITING_APPROVAL)).toHaveLength(1)
  },
}

/**
 * The same for Confirm & update. A colleague's update already put the reply
 * back into publication, so this one is refused: the toast says so, the reply
 * shows as waiting for Google, and the editor closes with the edit target.
 */
export const ARefusedUpdateIsStillSaidAfterTheReRead: Story = {
  beforeEach: () => {
    serverReply = LIVE_ON_GOOGLE
    return scriptReplyCommand('editPublishedReplyFn', async () => {
      throw refusal(NOT_PUBLISHED)
    })
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const article = await canvas.findByRole('article', { name: AUTHOR_LABEL })
    const message = within(article)
    await userEvent.click(message.getByRole('button', { name: 'Edit reply' }))
    const field = await canvas.findByRole('textbox', { name: 'Edit published reply' })
    await userEvent.type(field, ' See you next summer.')
    serverReply = {
      ...LIVE_ON_GOOGLE,
      status: 'approved',
      publicationState: 'requested',
      publishedAt: null,
      stateRevision: 4,
    }

    await userEvent.click(canvas.getByRole('button', { name: 'Review update' }))
    const dialog = await within(document.body).findByRole('alertdialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm & update' }),
    )

    const sentence = await expectRefusalToast(NOT_PUBLISHED)
    expect(await message.findByText(REPLY_CHIP_WORDS.waitingForGoogle)).toBeVisible()
    await waitFor(() =>
      expect(canvas.queryByRole('textbox', { name: 'Edit published reply' })).toBeNull(),
    )
    await waitFor(() =>
      expect(within(document.body).queryByRole('alertdialog')).toBeNull(),
    )
    expect(sentence).toBeVisible()
    expect(within(document.body).getAllByText(NOT_PUBLISHED)).toHaveLength(1)
  },
}
