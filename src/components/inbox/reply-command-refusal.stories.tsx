// Inbox reply — a confirmed command the server refuses, under a pane that
// re-reads.
//
// Confirm & publish and Confirm & update sit behind a confirmation, and a
// confirmation says its own refusal and stays open until it is dismissed
// (`ui/confirmation-dialog.tsx`). A refusal usually means another manager
// already moved the reply, so the command re-reads it
// (`inboxCachePolicy.onReplyCommandFailed`). That read would remount the action
// row under the reply's new status and end the edit target, and the dialog is
// drawn inside them: the sentence was on screen for the length of one read and
// then gone, with nothing to say the command had been refused. So the pane
// holds the reply it shows for as long as a confirmation is open over it
// (`use-reply-confirmation-hold.ts`). The dialog and its sentence stay until
// the manager dismisses them, and only then does the pane show the reply as
// the read left it.
//
// The pane here is the real one in miniature: the real `useReplyActions` over
// the real detail cache and cache policy, the real message, editor and edit
// target rule, the hold as `InboxDetailContent` takes it, and the app's
// `Toaster`, which must stay empty. Only the server is scripted
// (`scriptReplyCommand`, the Storybook stand-in for the reply server functions).
import type { Meta, StoryObj } from '@storybook/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
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
import { openConfirmation } from './reply-editor.stories.play'
import { ReplyMessage } from './reply-message'
import { ReplyPublishedEditor } from './reply-published-edit'
import { REPLY_CHIP_WORDS } from './reply-state-copy'
import { resolveReplyView, type ReplyData } from './reply-status-view'
import { useReplyActions } from './use-reply-actions'
import { ReplyConfirmationHold, useHeldReplyDetail } from './use-reply-confirmation-hold'

type Reply = Exclude<NonNullable<ReplyData>, { kind: 'google_observation' }>

const ITEM_ID = 'reply-refusal-item'
const PROPERTY_NAME = 'Seaside Rooms'
const AUTHOR_LABEL = `Reply from ${PROPERTY_NAME}`
const REJECTION_REASON = 'Too generic; please name the housekeeping fix we made.'
/** What the manager types into the published reply's editor. */
const ADDED_TEXT = ' See you next summer.'

// What the server answers each command for a reply that has left the state
// the command starts from (review/domain/reply-command-preconditions.ts), as
// `reviewErrorStatus` sends it: a 400.
const NOT_AWAITING_APPROVAL =
  'Only a reply that is waiting for approval can be confirmed and published'
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

/** What the pane's last read of the item returned, in the story's own words. */
const lastRead = (reply: InboxItemDetailResult['reply']): string =>
  `Last read: ${reply?.status ?? 'no reply'}`

/**
 * The reply half of the detail pane: the open item's detail read as
 * `useInboxDetailQueries` reads it, one reply command family, the thread
 * message, and the published editor while its edit target is live
 * (`liveEditTarget`, the rule `useInboxComposerController` applies).
 *
 * The line above the message prints what the last read returned. It is the
 * story's proof that a re-read has landed and been rendered, which the reply
 * itself cannot give while a confirmation holds it.
 */
function ReplyPane(): ReactNode {
  const queryClient = useQueryClient()
  const { data: detailAsRead } = useQuery({
    queryKey: inboxKeys.detail(ITEM_ID),
    queryFn: readDetail,
    staleTime: 0,
  })
  // As `InboxDetailContent` takes it: the detail the pane shows stands still
  // while a confirmation is open over it.
  const { detail, onConfirmationOpenChange } = useHeldReplyDetail(ITEM_ID, detailAsRead)
  const actions = useReplyActions({
    reviewId: ITEM.sourceId,
    onReplyChanged: (change) => inboxCachePolicy.onReplyChanged(queryClient, change),
  })
  const [isEditRequested, setEditRequested] = useState(false)
  if (!detail || !detailAsRead) return null

  const reply = detail.reply
  const editTarget = liveEditTarget(
    resolveReplyView(reply).kind,
    isEditRequested ? 'published' : null,
  )
  return (
    <ReplyConfirmationHold value={onConfirmationOpenChange}>
      <p className="text-xs text-muted-foreground">{lastRead(detailAsRead.reply)}</p>
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
    </ReplyConfirmationHold>
  )
}

const meta: Meta<typeof ReplyPane> = {
  title: 'Inbox/ReplyCommandRefusal',
  component: ReplyPane,
  parameters: { layout: 'centered' },
  // Sonner's store outlives a story: start each with no toast showing.
  beforeEach: () => {
    toast.dismiss()
  },
}
export default meta
type Story = StoryObj<typeof ReplyPane>

/**
 * The refusal, read where the manager pressed the button: in `dialog`, once,
 * and in no toast (one reporter, `use-action-mutation.ts`).
 */
async function expectRefusalInTheDialog(
  dialog: HTMLElement,
  sentence: string,
): Promise<void> {
  expect(await within(dialog).findByText(sentence)).toBeVisible()
  expect(within(document.body).getAllByText(sentence)).toHaveLength(1)
  const toasts = Array.from(document.querySelectorAll('[data-sonner-toast]'))
  expect(toasts.filter((shown) => shown.textContent.includes(sentence))).toHaveLength(0)
}

/** Waits until no confirmation is open. */
const expectNoDialog = (): Promise<void> =>
  waitFor(() => expect(within(document.body).queryByRole('alertdialog')).toBeNull())

/** Dismisses `dialog` by its cancel button and waits for it to be gone. */
async function dismiss(dialog: HTMLElement, cancelLabel: string): Promise<void> {
  await userEvent.click(within(dialog).getByRole('button', { name: cancelLabel }))
  await expectNoDialog()
}

/** The pane's canvas, and the reply's thread message once it has been read. */
async function findReplyMessage(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const article = await canvas.findByRole('article', { name: AUTHOR_LABEL })
  return { canvas, message: within(article) }
}

/**
 * Opens the confirmation behind the button named `trigger` and presses the
 * dialog's own `confirmLabel`. Resolves the dialog, which is still open while
 * the command runs and after a refusal.
 */
async function confirmIn(
  canvasElement: HTMLElement,
  trigger: string,
  confirmLabel: string,
): Promise<HTMLElement> {
  const dialog = await openConfirmation(canvasElement, trigger, /until google confirms/i)
  await userEvent.click(within(dialog).getByRole('button', { name: confirmLabel }))
  return dialog
}

const confirmAndPublish = (canvasElement: HTMLElement): Promise<HTMLElement> =>
  confirmIn(canvasElement, 'Confirm & publish', 'Confirm & publish')

/**
 * A colleague rejected the reply from another browser; nothing polls a reply
 * that waits for a person, so this pane still offers Confirm & publish. The
 * server refuses it and the pane re-reads the reply. The dialog is still open
 * over the reply it was opened on when that read has landed, with the refusal
 * in it; dismissed, the pane shows the reply as rejected, with the reason.
 */
export const ARefusedConfirmationIsStillSaidAfterTheReRead: Story = {
  beforeEach: () => {
    serverReply = AWAITING_APPROVAL
    return scriptReplyCommand('approveReplyFn', async () => {
      throw refusal(NOT_AWAITING_APPROVAL)
    })
  },
  play: async ({ canvasElement }) => {
    const { canvas, message } = await findReplyMessage(canvasElement)
    expect(message.getByText(REPLY_CHIP_WORDS.awaitingApproval)).toBeVisible()
    serverReply = {
      ...AWAITING_APPROVAL,
      status: 'rejected',
      rejectedBy: userId('99999999-9999-4999-8999-999999999999'),
      rejectionReason: REJECTION_REASON,
      stateRevision: 2,
    }

    const dialog = await confirmAndPublish(canvasElement)

    // The refusal re-read the reply, and the read has landed...
    expect(await canvas.findByText(lastRead(serverReply))).toBeVisible()
    // ...under a dialog that is still open, over the reply it was opened on,
    // and that says why.
    expect(dialog).toBeVisible()
    await expectRefusalInTheDialog(dialog, NOT_AWAITING_APPROVAL)
    expect(message.getByText(REPLY_CHIP_WORDS.awaitingApproval)).toBeVisible()

    // Dismissed, the pane shows the reply as it is: rejected, and the refused
    // command is gone.
    await dismiss(dialog, 'Keep reviewing')
    expect(await message.findByText(REPLY_CHIP_WORDS.rejected)).toBeVisible()
    expect(message.getByText(REJECTION_REASON)).toBeVisible()
    expect(message.queryByRole('button', { name: 'Confirm & publish' })).toBeNull()
  },
}

/**
 * The same for Confirm & update. A colleague's update already put the reply
 * back into publication, so this one is refused. The dialog says so over the
 * editor it was opened from, text and all; dismissed, the reply shows as
 * waiting for Google and the editor closes with the edit target.
 */
export const ARefusedUpdateIsStillSaidAfterTheReRead: Story = {
  beforeEach: () => {
    serverReply = LIVE_ON_GOOGLE
    return scriptReplyCommand('editPublishedReplyFn', async () => {
      throw refusal(NOT_PUBLISHED)
    })
  },
  play: async ({ canvasElement }) => {
    const { canvas, message } = await findReplyMessage(canvasElement)
    await userEvent.click(message.getByRole('button', { name: 'Edit reply' }))
    const field = await canvas.findByRole('textbox', { name: 'Edit published reply' })
    await userEvent.type(field, ADDED_TEXT)
    serverReply = {
      ...LIVE_ON_GOOGLE,
      status: 'approved',
      publicationState: 'requested',
      publishedAt: null,
      stateRevision: 4,
    }

    const dialog = await confirmIn(canvasElement, 'Review update', 'Confirm & update')

    expect(await canvas.findByText(lastRead(serverReply))).toBeVisible()
    expect(dialog).toBeVisible()
    await expectRefusalInTheDialog(dialog, NOT_PUBLISHED)
    // The editor the dialog was opened from is still there, with what was typed.
    expect(field).toHaveValue(`${LIVE_ON_GOOGLE.text}${ADDED_TEXT}`)
    expect(message.getByText(REPLY_CHIP_WORDS.liveOnGoogle)).toBeVisible()

    await dismiss(dialog, 'Keep editing')
    expect(await message.findByText(REPLY_CHIP_WORDS.waitingForGoogle)).toBeVisible()
    await waitFor(() =>
      expect(canvas.queryByRole('textbox', { name: 'Edit published reply' })).toBeNull(),
    )
  },
}

/**
 * The other end of the hold: it is over when the dialog closes, so a
 * confirmation that goes through leaves the pane on the reply as the command
 * returned it. A hold that stayed would keep showing a reply waiting for
 * approval, with a live Confirm & publish, after it had been confirmed.
 */
export const AConfirmationThatGoesThroughLetsThePaneFollow: Story = {
  beforeEach: () => {
    serverReply = AWAITING_APPROVAL
    return scriptReplyCommand('approveReplyFn', async () => {
      serverReply = {
        ...AWAITING_APPROVAL,
        status: 'approved',
        approvedBy: userId('99999999-9999-4999-8999-999999999999'),
        approvedAt: APPROVED_AT,
        publicationState: 'requested',
        publicationCycle: 1,
        stateRevision: 2,
        updatedAt: APPROVED_AT,
      }
      return serverReply
    })
  },
  play: async ({ canvasElement }) => {
    const { message } = await findReplyMessage(canvasElement)

    await confirmAndPublish(canvasElement)

    await expectNoDialog()
    expect(await message.findByText(REPLY_CHIP_WORDS.waitingForGoogle)).toBeVisible()
    expect(message.queryByRole('button', { name: 'Confirm & publish' })).toBeNull()
  },
}
