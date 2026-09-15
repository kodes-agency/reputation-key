// Inbox thread — the property's reply as ONE message (plan row 6).
//
// `presentReplyMessage` is unit-tested in reply-message-view.test.ts, so these
// stories do not re-derive its table. What they gate is everything the
// presenter cannot see: which words reach the screen, which actions are
// reachable, what a confirmation actually guards, and the two states that must
// render NOTHING here because the draft belongs to the composer.
//
// The rules a later change would otherwise break in silence:
//   · the meta line is a timestamp and nothing else — no actor, ever, because
//     `ReplyData` carries `createdBy` / `approvedBy` / `rejectedBy` as bare
//     `UserId` and no name exists anywhere in the payload;
//   · Confirm & Publish is unreachable without its dialog;
//   · an unfilled template slot blocks publishing AND says why, on the button;
//   · `Needs a check` never offers a second send;
//   · a publish failure offers Try again and NOTHING else — no server path
//     changes the text of a `publish_failed` reply, so an editor there could
//     only ever fail to save;
//   · one chip covers five publication stages, so each stage says which one it
//     is in words underneath it;
//   · a rejection reason is attributed to the colleague who wrote it, never
//     left as muted prose beside RepKey's own sentences;
//   · the author is a span, not a heading;
//   · the reject panel outlives neither the rejection it performed nor the
//     reply it was opened on;
//   · Edit reply reports the editor it opens somewhere off screen, and Edit &
//     resubmit — which unmounts this whole message instead — reports nothing;
//   · every action goes dead while a write is in flight;
//   · Check Google again always says what it found — on the line under the
//     actions, or in a toast when the reply moved on by itself — and a failed
//     check says why instead of leaving the pane exactly as it was.
//
// The Vitest Storybook project compiles no Tailwind, so every utility class is
// inert here. Nothing below asserts geometry — only content, roles, accessible
// names and behaviour, which are real in this runner.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { Toaster } from '#/components/ui/sonner'
import type { ReplyPublicationCheckResult } from '#/contexts/review/application/public-api'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { organizationId, replyId, reviewId, userId } from '#/shared/domain/ids'
import {
  formatCheckTime,
  REPLY_CHECK_COPY,
  replyCheckMutationOptions,
} from './reply-check-feedback'
import { ReplyMessage } from './reply-message'
import type { ReplyData } from './reply-status-view'
import type { ComponentProps, ReactNode } from 'react'

type Reply = Exclude<NonNullable<ReplyData>, { kind: 'google_observation' }>

/**
 * Every id these fixtures carry shares one infix, so a single assertion covers
 * every place a raw identifier could surface — the meta line, the chip, the
 * detail line, an accessible name.
 */
const RAW_ID_MARKER = '-raw-id-'

const IDS = {
  reply: `reply${RAW_ID_MARKER}0001`,
  review: `review${RAW_ID_MARKER}0002`,
  organization: `org${RAW_ID_MARKER}0003`,
  author: `user${RAW_ID_MARKER}ada`,
  approver: `user${RAW_ID_MARKER}grace`,
  rejecter: `user${RAW_ID_MARKER}lin`,
  /** A SECOND reply, so a story can move the pane from one to another. */
  nextReply: `reply${RAW_ID_MARKER}0009`,
} as const

const PROPERTY_NAME = 'Seaside Rooms'
const AUTHOR_LABEL = `Reply from ${PROPERTY_NAME}`

const REPLY_TEXT =
  'Thank you for the kind words. We are glad the sea view lived up to the photos.'
const REJECTION_REASON = 'Too generic; please name the housekeeping fix we made.'
const UNFILLED_SLOT_TEXT = 'Dear {guest_name}, thank you for staying with us.'
const UNFILLED_SLOT_MESSAGE =
  'Fill every template placeholder before publishing: {guest_name}.'

/**
 * The reject field's accessible name, asserted EXACTLY. Its placeholder reads
 * `Reason for rejection (optional)...`, so an exact match on the label's own
 * words is what separates a real `<label>` from a box named by its placeholder
 * — and a placeholder-named box announces nothing once it has a value.
 */
const REJECT_REASON_LABEL = 'Reason for rejection (optional)'

const SUBMITTED_AT = new Date('2026-09-11T09:00:00.000Z')
const APPROVED_AT = new Date('2026-09-11T09:05:00.000Z')
const PUBLISHED_AT = new Date('2026-09-11T09:20:00.000Z')
const REJECTED_AT = new Date('2026-09-11T10:00:00.000Z')

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId(IDS.reply),
    reviewId: reviewId(IDS.review),
    organizationId: organizationId(IDS.organization),
    text: REPLY_TEXT,
    replyLanguageTag: 'en-Latn',
    templateId: null,
    templateVersion: null,
    status: 'pending_approval',
    source: 'internal',
    createdBy: userId(IDS.author),
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
    ...overrides,
  }
}

/** An ambiguous publication whose automatic reads have ended: `Needs a check`. */
const NEEDS_CHECK_REPLY = makeReply({
  status: 'publish_failed',
  approvedBy: userId(IDS.approver),
  approvedAt: APPROVED_AT,
  publicationState: 'ambiguous',
  publicationLastErrorClass: 'ambiguous',
  publicationAttempts: 1,
})

const CHECKED_AT = new Date('2026-09-11T11:42:00.000Z')

/** What `checkReplyPublicationFn` answers, for the reply it was asked about. */
function checkResult(
  outcome: ReplyPublicationCheckResult['outcome'],
  overrides: Partial<ReplyPublicationCheckResult> = {},
): ReplyPublicationCheckResult {
  return {
    reply: NEEDS_CHECK_REPLY,
    outcome,
    checkedAt: CHECKED_AT,
    nextAutomaticCheckAt: null,
    ...overrides,
  }
}

const onApprove = fn(async () => undefined)
const onReject = fn(async (_reason?: string) => undefined)
const onCheck = fn(async (): Promise<ReplyPublicationCheckResult> =>
  checkResult('not_on_google'),
)
const onRetry = fn(async () => undefined)
const onEditPublished = fn(() => {})
const onEditRejected = fn(() => {})

/** Every spy, cleared together — a play function never inherits another's calls. */
function resetSpies(): void {
  for (const spy of [
    onApprove,
    onReject,
    onCheck,
    onRetry,
    onEditPublished,
    onEditRejected,
  ])
    spy.mockClear()
}

/**
 * A host that owns the reply, because both of the panel's teardowns ARE changes
 * of reply and a story's args are static. Rejecting moves this reply on;
 * `Open the next reply` swaps a different id into the same position in the
 * tree, which is what selecting another item does to a thread whose reply row
 * React keys by the constant `'reply'`.
 */
function ReplyMessageHost(
  props: Omit<ComponentProps<typeof ReplyMessage>, 'reply'> & { reply: Reply },
): ReactNode {
  const [reply, setReply] = useState<Reply>(props.reply)
  return (
    <>
      <ReplyMessage
        {...props}
        reply={reply}
        onReject={async (reason) => {
          await props.onReject(reason)
          setReply((current) =>
            current
              ? {
                  ...current,
                  status: 'rejected',
                  rejectionReason: reason ?? null,
                  updatedAt: REJECTED_AT,
                }
              : current,
          )
        }}
      />
      <button
        type="button"
        onClick={() => setReply(makeReply({ id: replyId(IDS.nextReply) }))}
      >
        Open the next reply
      </button>
    </>
  )
}

/**
 * The meta line, pinned to exactly two parts: the milestone and when it
 * happened. There is no third clause because nothing in `ReplyData` could fill
 * one — so a name appearing here would have to have been invented.
 *
 * `getByText` matches an element's OWN text nodes, so querying the label lands
 * on the paragraph itself rather than on an ancestor.
 */
function expectTimestampOnlyMeta(article: HTMLElement, label: string, at: Date): void {
  const line = within(article).getByText(`${label} ·`)
  expect(line).toBeVisible()

  const [milestone, ...rest] = (line.textContent ?? '').replace(/\s+/gu, ' ').split(' · ')
  expect(milestone).toBe(label)
  expect(rest).toHaveLength(1)
  expect(rest[0]?.trim()).not.toBe('')
  expect(line.textContent ?? '').not.toContain(RAW_ID_MARKER)

  // The machine-readable half is the same instant, not a re-rounded one.
  const time = line.querySelector('time')
  expect(time).not.toBeNull()
  expect(time).toHaveAttribute('datetime', at.toISOString())
}

/** The rendered message, with the two rules that hold in every state checked. */
function expectMessage(
  canvasElement: HTMLElement,
  metaLabel: string,
  metaAt: Date,
): HTMLElement {
  const article = within(canvasElement).getByRole('article', { name: AUTHOR_LABEL })
  // The author is a span, not a heading. In a single-property inbox this name
  // is identical on every message in the thread, so as an `h2` it added an
  // outline level that could not tell one entry from another; the article's
  // own accessible name is what makes this region findable.
  expect(within(article).getByText(PROPERTY_NAME)).toBeVisible()
  expect(within(article).queryAllByRole('heading')).toHaveLength(0)
  expect(within(article).getByText(REPLY_TEXT)).toBeVisible()
  expectTimestampOnlyMeta(article, metaLabel, metaAt)
  expect(article.textContent ?? '').not.toContain(RAW_ID_MARKER)
  return article
}

const meta: Meta<typeof ReplyMessage> = {
  title: 'Inbox/ReplyMessage',
  component: ReplyMessage,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    propertyName: PROPERTY_NAME,
    isSaving: false,
    isEditing: false,
    onApprove,
    onReject,
    onCheck,
    onRetry,
    onEditPublished,
    onEditRejected,
  },
}
export default meta
type Story = StoryObj<typeof ReplyMessage>

// ── awaiting approval ────────────────────────────────────────────────────────

export const AwaitingApproval: Story = {
  args: { reply: makeReply() },
  play: async ({ canvasElement }) => {
    const article = expectMessage(canvasElement, 'Submitted', SUBMITTED_AT)
    const message = within(article)
    expect(message.getByText('Awaiting approval')).toBeVisible()
    expect(message.getByRole('button', { name: 'Confirm & Publish' })).toBeEnabled()
    expect(message.getByRole('button', { name: 'Reject' })).toBeEnabled()
    // Nothing else: publishing and refusing are the only two moves here.
    expect(message.getAllByRole('button')).toHaveLength(2)
  },
}

/**
 * The confirmation is a product invariant, not decoration. Pressing the button
 * must reach the dialog and stop there — the call goes out only from inside it.
 */
export const ConfirmAndPublishAsksFirst: Story = {
  args: { reply: makeReply() },
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Confirm & Publish' }))
    const dialog = await within(document.body).findByRole('alertdialog')
    // The copy mounts with the dialog's entry animation — wait for it rather
    // than sampling the first frame.
    await waitFor(() =>
      expect(
        within(dialog).getByText(/keeps it pending until google confirms/i),
      ).toBeVisible(),
    )
    expect(onApprove).not.toHaveBeenCalled()

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm & Publish' }),
    )
    expect(onApprove).toHaveBeenCalledOnce()
  },
}

/**
 * The fence reads the reply as the SERVER holds it, which is the only copy this
 * message has — it owns no editor. A blocked publish must also SAY why, and say
 * it on the control, not merely beside it.
 *
 * Which is why the block is `aria-disabled` and a refused click, not the native
 * attribute: a natively `disabled` button leaves the tab order and takes its
 * `aria-describedby` with it, so the one sentence explaining why publishing is
 * blocked becomes reachable by no keyboard and no screen reader — the reader
 * most likely to need it is the one who can never get to it.
 */
export const PublishBlockedByTemplateSlot: Story = {
  args: { reply: makeReply({ text: UNFILLED_SLOT_TEXT }) },
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)
    const publish = canvas.getByRole('button', { name: 'Confirm & Publish' })
    const reason = canvas.getByText(UNFILLED_SLOT_MESSAGE)

    // Blocked, and still a control a keyboard can land on.
    expect(publish).toHaveAttribute('aria-disabled', 'true')
    expect(publish).not.toBeDisabled()
    publish.focus()
    expect(publish).toHaveFocus()

    // ...so the explanation is reachable FROM it, which is the only route a
    // screen reader has to the sentence.
    expect(reason).toBeVisible()
    expect(publish).toHaveAttribute('aria-describedby', reason.id)
    expect(document.getElementById(reason.id)).toHaveTextContent(UNFILLED_SLOT_MESSAGE)

    // Focusable is not permitted: the click is refused before the dialog.
    await userEvent.click(publish)
    expect(within(document.body).queryByRole('alertdialog')).toBeNull()
    expect(onApprove).not.toHaveBeenCalled()

    // Refusing a reply you cannot publish stays possible.
    expect(canvas.getByRole('button', { name: 'Reject' })).toBeEnabled()
  },
}

/**
 * Every query below goes through the field's ACCESSIBLE NAME rather than its
 * placeholder, because the name is the thing that has to exist: a box named
 * only by a placeholder is announced as "edit text, blank" the moment it has a
 * value, which is every moment after the manager starts explaining a refusal.
 */
export const RejectRevealsReasonField: Story = {
  args: { reply: makeReply() },
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)

    // The field is absent until Reject is pressed — rejecting is a decision,
    // not a box sitting open under every reply awaiting approval — and the
    // button says whether it has opened one.
    expect(canvas.queryByRole('textbox')).toBeNull()
    const reject = canvas.getByRole('button', { name: 'Reject' })
    expect(reject).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(reject)
    expect(reject).toHaveAttribute('aria-expanded', 'true')
    // An exact name: the placeholder reads `…(optional)...`, so this match
    // fails if the label is ever dropped and the placeholder names the box.
    const reasonField = await canvas.findByRole('textbox', {
      name: REJECT_REASON_LABEL,
    })
    // Revealing a field announces nothing on its own, so focus follows.
    expect(reasonField).toHaveFocus()

    await userEvent.type(reasonField, REJECTION_REASON)
    // The visible placeholder is gone now. The name is not.
    expect(canvas.getByRole('textbox', { name: REJECT_REASON_LABEL })).toHaveValue(
      REJECTION_REASON,
    )

    await userEvent.click(canvas.getByRole('button', { name: 'Confirm Reject' }))
    expect(onReject).toHaveBeenCalledWith(REJECTION_REASON)

    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    expect(canvas.queryByRole('textbox', { name: REJECT_REASON_LABEL })).toBeNull()
  },
}

/**
 * The panel does not survive the rejection it performed. `ReplyMessageActions`
 * holds the half-typed reason in local state under a thread row keyed by the
 * constant `'reply'`, so React reuses that instance when the reply moves on —
 * and a reply that is already rejected has no reject action to open a panel
 * for. Without both halves of the fix the manager is left looking at an open
 * reject box, and a Confirm Reject button, for a reply they just rejected.
 */
export const RejectingClosesThePanel: Story = {
  args: { reply: makeReply() },
  render: (args) =>
    args.reply && args.reply.kind !== 'google_observation' ? (
      <ReplyMessageHost {...args} reply={args.reply} />
    ) : (
      <></>
    ),
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Reject' }))
    await userEvent.type(
      await canvas.findByRole('textbox', { name: REJECT_REASON_LABEL }),
      REJECTION_REASON,
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm Reject' }))
    expect(onReject).toHaveBeenCalledWith(REJECTION_REASON)

    // The reply is rejected now, so the panel, its buttons and the action that
    // opens it are all gone, and the words the manager typed read back as a
    // recorded reason instead of as a pending edit.
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Edit & resubmit' })).toBeVisible(),
    )
    expect(canvas.queryByRole('textbox', { name: REJECT_REASON_LABEL })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Confirm Reject' })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Reject' })).toBeNull()
    expect(canvas.getByText(REJECTION_REASON)).toBeVisible()
  },
}

/**
 * ...and it does not survive a move to a different reply either. The next
 * selection gets an empty panel, not the reason someone was half-way through
 * typing about the last one — which, unnoticed, is a sentence about one
 * property's reply submitted against another's.
 */
export const ADifferentReplyGetsACleanPanel: Story = {
  args: { reply: makeReply() },
  render: (args) =>
    args.reply && args.reply.kind !== 'google_observation' ? (
      <ReplyMessageHost {...args} reply={args.reply} />
    ) : (
      <></>
    ),
  play: async ({ canvasElement }) => {
    resetSpies()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Reject' }))
    await userEvent.type(
      await canvas.findByRole('textbox', { name: REJECT_REASON_LABEL }),
      REJECTION_REASON,
    )

    await userEvent.click(canvas.getByRole('button', { name: 'Open the next reply' }))

    // A different reply id at the same position in the tree: the panel is shut...
    await waitFor(() =>
      expect(canvas.queryByRole('textbox', { name: REJECT_REASON_LABEL })).toBeNull(),
    )
    // ...and opening it again starts from nothing.
    await userEvent.click(canvas.getByRole('button', { name: 'Reject' }))
    expect(await canvas.findByRole('textbox', { name: REJECT_REASON_LABEL })).toHaveValue(
      '',
    )
    expect(onReject).not.toHaveBeenCalled()
  },
}

export const AwaitingApprovalWhileSaving: Story = {
  args: { reply: makeReply(), isSaving: true },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('button', { name: 'Confirm & Publish' })).toBeDisabled()
    expect(canvas.getByRole('button', { name: 'Reject' })).toBeDisabled()
  },
}

// ── waiting for Google ───────────────────────────────────────────────────────

/**
 * `approved`, `requested`, `authorized`, `sending` and `pending_observation`
 * all carry the same chip: a manager is waiting on Google in every one of them.
 * WHICH stage the publication machine is in is the description's job, and this
 * message is its only renderer — so the three stories below are one per stage.
 * Dropped, the description leaves five states that say nothing but `Waiting for
 * Google`, and a reply Google has already accepted looks exactly like one
 * RepKey has not sent yet.
 */
const APPROVED_REPLY = makeReply({
  status: 'approved',
  approvedBy: userId(IDS.approver),
  approvedAt: APPROVED_AT,
})

/** Confirmed, nothing attempted yet. */
export const WaitingForGoogle: Story = {
  args: { reply: APPROVED_REPLY },
  play: async ({ canvasElement }) => {
    const article = expectMessage(canvasElement, 'Confirmed', APPROVED_AT)
    const message = within(article)
    expect(message.getByText('Waiting for Google')).toBeVisible()
    expect(message.getByText(/will start publishing this reply shortly/i)).toBeVisible()
    // Nothing to do but wait — and nothing offered that suggests otherwise.
    expect(message.queryAllByRole('button')).toHaveLength(0)
  },
}

/** The attempt is under way and Google has not answered; it may not have left yet. */
export const WaitingForGoogleWhileSending: Story = {
  args: {
    reply: { ...APPROVED_REPLY, publicationState: 'sending', publicationAttempts: 1 },
  },
  play: async ({ canvasElement }) => {
    const article = expectMessage(canvasElement, 'Confirmed', APPROVED_AT)
    const message = within(article)
    expect(message.getByText('Waiting for Google')).toBeVisible()
    expect(message.getByText(/publishing this reply to google/i)).toBeVisible()
    expect(message.queryAllByRole('button')).toHaveLength(0)
  },
}

/**
 * Google ACCEPTED it — the same chip as the two above, and a materially
 * different situation: what is left is RepKey confirming the exact words are
 * live, not a send that might still fail.
 */
export const WaitingForGoogleAfterGoogleAccepted: Story = {
  args: {
    reply: {
      ...APPROVED_REPLY,
      publicationState: 'pending_observation',
      publicationAttempts: 1,
    },
  },
  play: async ({ canvasElement }) => {
    const article = expectMessage(canvasElement, 'Confirmed', APPROVED_AT)
    const message = within(article)
    expect(message.getByText('Waiting for Google')).toBeVisible()
    expect(message.getByText(/google accepted this reply/i)).toBeVisible()
    // Not the earlier stage's sentence: the stages are told apart, not merged.
    expect(message.queryByText(/publishing this reply to google/i)).toBeNull()
    expect(message.queryAllByRole('button')).toHaveLength(0)
  },
}

// ── live on Google ───────────────────────────────────────────────────────────

export const LiveOnGoogle: Story = {
  args: {
    reply: makeReply({
      status: 'published',
      approvedBy: userId(IDS.approver),
      approvedAt: APPROVED_AT,
      publishedAt: PUBLISHED_AT,
      publicationState: 'published',
    }),
  },
  play: async ({ canvasElement }) => {
    resetSpies()
    const article = expectMessage(canvasElement, 'Live on Google', PUBLISHED_AT)
    const message = within(article)
    expect(message.getByText('Live on Google')).toBeVisible()

    const edit = message.getByRole('button', { name: 'Edit reply' })
    // A disclosure, and closed. The editor mounts at the foot of the scroller
    // in a different subtree, so a reader who cannot see it has nothing but
    // this attribute to tell them whether their click opened anything.
    expect(edit).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(edit)
    expect(onEditPublished).toHaveBeenCalledOnce()
    // Editing is the ONLY action: a live reply is never re-sent from here.
    expect(message.getAllByRole('button')).toHaveLength(1)
  },
}

/**
 * ...and the same trigger while that editor is open. The state has to come from
 * the pane: the editor is a sibling of the scroller this message lives in, so
 * nothing local to the message can observe it. With `aria-expanded` stuck at
 * `false`, the one control that had an effect reports none — and the effect
 * itself is off screen on any item with handling history.
 */
export const LiveOnGoogleWhileEditing: Story = {
  args: { ...LiveOnGoogle.args, isEditing: true },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('button', { name: 'Edit reply' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

export const LiveOnGoogleWhileSaving: Story = {
  args: { ...LiveOnGoogle.args, isSaving: true },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('button', { name: 'Edit reply' })).toBeDisabled()
  },
}

/**
 * A reply Google already carried when RepKey first read the profile. The meta
 * line says OBSERVED rather than published, because RepKey did not send it —
 * and editing a Google-authored reply from here is a future feature.
 */
export const GoogleMirroredReply: Story = {
  args: {
    reply: makeReply({
      status: 'published',
      source: 'google_sync',
      createdBy: null,
      submittedAt: null,
      approvedAt: null,
      publishedAt: PUBLISHED_AT,
    }),
  },
  play: async ({ canvasElement }) => {
    const article = expectMessage(
      canvasElement,
      'Observed via Google Business Profile',
      PUBLISHED_AT,
    )
    expect(within(article).getByText('Live on Google')).toBeVisible()
    expect(within(article).queryAllByRole('button')).toHaveLength(0)
  },
}

// ── publication recovery ─────────────────────────────────────────────────────

/**
 * The same uncertain publish as `NeedsCheck` below, while RepKey's automatic
 * reads still own it (`reconcileDueAt` set, D8). Nobody has to act, so the chip
 * is the word of the queue it waits in, and the sentence says the reads go on
 * by themselves. A manager may still read Google now — but never send again.
 */
export const WaitingForGoogleWhileCheckingAutomatically: Story = {
  args: {
    reply: makeReply({
      status: 'publish_failed',
      approvedBy: userId(IDS.approver),
      approvedAt: APPROVED_AT,
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
      publicationAttempts: 1,
      reconcileDueAt: new Date('2026-09-11T12:12:00.000Z'),
    }),
  },
  play: async ({ canvasElement }) => {
    resetSpies()
    const article = expectMessage(canvasElement, 'Confirmed', APPROVED_AT)
    const message = within(article)
    expect(message.getByText('Waiting for Google')).toBeVisible()
    expect(message.queryByText('Needs a check')).toBeNull()
    expect(message.getByText(/keeps checking automatically/i)).toBeVisible()
    expect(message.getByText(/won't send it twice/i)).toBeVisible()
    expect(
      message.queryByRole('button', { name: /publish|retry|resend|try again/i }),
    ).toBeNull()

    await userEvent.click(message.getByRole('button', { name: 'Check Google again' }))
    expect(onCheck).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()
  },
}

/**
 * The one publish failure that is NOT "Not published": Google may well have
 * taken the reply. The only safe action is another read, so the message must
 * offer no way at all to send a second copy.
 */
export const NeedsCheck: Story = {
  args: {
    reply: makeReply({
      status: 'publish_failed',
      approvedBy: userId(IDS.approver),
      approvedAt: APPROVED_AT,
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
      publicationAttempts: 1,
    }),
  },
  play: async ({ canvasElement }) => {
    resetSpies()
    const article = expectMessage(canvasElement, 'Confirmed', APPROVED_AT)
    const message = within(article)
    expect(message.getByText('Needs a check')).toBeVisible()
    expect(message.getByText(/won't send it twice/i)).toBeVisible()
    expect(
      message.queryByRole('button', { name: /publish|retry|resend|try again/i }),
    ).toBeNull()

    await userEvent.click(message.getByRole('button', { name: 'Check Google again' }))
    expect(onCheck).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()
  },
}

/**
 * Another write is in flight in the pane. The check waits its turn, but it is
 * not the thing running, so it neither says `Checking Google…` nor claims to be
 * busy — only the check's own request may.
 */
export const NeedsCheckWhileSaving: Story = {
  args: { ...NeedsCheck.args, isSaving: true },
  play: async ({ canvas }) => {
    const check = canvas.getByRole('button', { name: 'Check Google again' })
    expect(check).toBeDisabled()
    expect(check).toHaveAttribute('aria-busy', 'false')
    expect(canvas.queryByRole('button', { name: 'Checking Google…' })).toBeNull()
  },
}

// ── checking Google ──────────────────────────────────────────────────────────

/** A second reply that needs a check, so a story can move the pane on. */
const OTHER_NEEDS_CHECK_REPLY: Reply = {
  ...NEEDS_CHECK_REPLY,
  id: replyId(IDS.nextReply),
}

const NEXT_CHECK_AT = new Date('2026-09-11T12:12:00.000Z')

type CheckAnswer = () => Promise<ReplyPublicationCheckResult>

/** What the host's cache becomes when something other than the check moves it. */
type HostReplies = Readonly<{
  /** A later detail poll: `Read the reply again` swaps it in. */
  polled?: Reply
  /** The re-read a failed check triggers (`onReplyCheckFailed`). */
  refetched?: Reply
  /**
   * Writes the check's reply this long after it settles. The pane's cache
   * write reaches React through TanStack's notify scheduler (a macrotask), so
   * the check's own settle can render first.
   */
  cacheDelayMs?: number
}>

/**
 * The pane's check, for real: a `useActionMutation` built from the SAME options
 * `useReplyActions` passes (`replyCheckMutationOptions`), over a scripted answer
 * standing in for `checkReplyPublicationFn`. The host is the detail cache — the
 * reply the check returns replaces the one on screen, as the pane's
 * `onReplyChanged` does, and a failed check re-reads it, as the pane's
 * `onReplyCheckFailed` does — and it mounts the app's `Toaster`, so every toast
 * asserted below is the one a manager would see.
 */
function ReplyCheckHost({
  answer,
  polled,
  refetched,
  cacheDelayMs,
  ...props
}: Omit<ComponentProps<typeof ReplyMessage>, 'reply' | 'onCheck' | 'isSaving'> &
  HostReplies & {
    reply: Reply
    answer: CheckAnswer
  }): ReactNode {
  const [reply, setReply] = useState<ReplyData>(props.reply)
  const check = useActionMutation(
    (_input: Readonly<{ data: Readonly<{ reviewId: string }> }>) => answer(),
    replyCheckMutationOptions({
      reviewId: IDS.review,
      onReplyChanged: (change) => {
        if (cacheDelayMs === undefined) setReply(change.reply)
        else setTimeout(() => setReply(change.reply), cacheDelayMs)
      },
      onCheckFailed: () => {
        if (refetched) setReply(refetched)
      },
    }),
  )
  return (
    <>
      <ReplyMessage
        {...props}
        reply={reply}
        isSaving={check.isPending}
        onCheck={() => check({ data: { reviewId: IDS.review } })}
      />
      <button type="button" onClick={() => setReply(OTHER_NEEDS_CHECK_REPLY)}>
        Open the next reply
      </button>
      {polled && (
        <button type="button" onClick={() => setReply(polled)}>
          Read the reply again
        </button>
      )}
      <Toaster />
    </>
  )
}

function checkStory(
  answer: CheckAnswer,
  play: NonNullable<Story['play']>,
  reply: Reply = NEEDS_CHECK_REPLY,
  host: HostReplies = {},
): Story {
  return {
    args: { reply },
    render: (args) => (
      <ReplyCheckHost {...args} {...host} reply={reply} answer={answer} />
    ),
    play,
  }
}

/** The message, its status line, and a click on its check. */
async function clickCheck(canvasElement: HTMLElement) {
  const article = within(canvasElement).getByRole('article', { name: AUTHOR_LABEL })
  const message = within(article)
  // Scoped to the article: a sonner toast is a `role="status"` of its own.
  const line = message.getByRole('status')
  // Mounted and silent BEFORE the click. A live region that mounted with its
  // sentence would announce nothing.
  expect(line).toBeEmptyDOMElement()
  await userEvent.click(message.getByRole('button', { name: 'Check Google again' }))
  return { article, message, line }
}

async function expectCheckEnabledAgain(message: ReturnType<typeof within>) {
  const check = await message.findByRole('button', { name: 'Check Google again' })
  await waitFor(() => expect(check).toBeEnabled())
  expect(check).toHaveAttribute('aria-busy', 'false')
  expect(check.querySelector('svg')).toBeNull()
}

/**
 * The toast carrying `message`, once it has entered. Sonner keeps its toasts in
 * a store that outlives one story's `Toaster`, so a story asks for its own
 * sentence rather than counting toasts, and waits out the entry transition
 * (`data-mounted`) rather than sampling the first frame.
 */
async function expectToast(message: string): Promise<void> {
  const text = await within(document.body).findByText(message)
  await waitFor(() => expect(text).toBeVisible())
}

/** Said once: the status line's sentence never arrives as a toast as well. */
function expectNoToast(message: string): void {
  const toasts = Array.from(document.querySelectorAll('[data-sonner-toast]'))
  expect(toasts.filter((toast) => toast.textContent?.includes(message))).toHaveLength(0)
}

let heldCheck: PromiseWithResolvers<ReplyPublicationCheckResult> | null = null

/**
 * A read of Google takes seconds, and until this change the button said
 * `Checking Google…` for ANY write in the pane while saying nothing at all about
 * its own. While the check runs it is busy, named for what it is doing, spun and
 * dead; the answer lands in the line that was already there.
 */
export const NeedsCheckWhileChecking = checkStory(
  () => {
    heldCheck = Promise.withResolvers<ReplyPublicationCheckResult>()
    return heldCheck.promise
  },
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    const busy = await message.findByRole('button', { name: 'Checking Google…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy.querySelector('svg')).not.toBeNull()
    expect(line).toBeEmptyDOMElement()

    heldCheck?.resolve(checkResult('not_on_google'))

    await expectCheckEnabledAgain(message)
    await waitFor(() =>
      expect(line).toHaveTextContent(
        `Checked Google at ${formatCheckTime(CHECKED_AT)}. ${REPLY_CHECK_COPY.notShowing}`,
      ),
    )
    // The same element that sat empty: the sentence was inserted, not mounted.
    expect(message.getByRole('status')).toBe(line)
  },
)

/**
 * Google does not show the reply, and the automatic reads continue. The answer
 * is a new server reply, so the message re-renders under the line — which keeps
 * its sentence — and moving to another reply empties it rather than printing a
 * finding about one reply under another.
 */
export const NeedsCheckNotOnGoogle = checkStory(
  async () =>
    checkResult('not_on_google', {
      reply: { ...NEEDS_CHECK_REPLY, reconcileDueAt: NEXT_CHECK_AT, stateRevision: 2 },
      nextAutomaticCheckAt: NEXT_CHECK_AT,
    }),
  async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const { message, line } = await clickCheck(canvasElement)

    await waitFor(() =>
      expect(line).toHaveTextContent(
        `Checked Google at ${formatCheckTime(CHECKED_AT)}. This reply isn't showing there. RepKey checks again automatically.`,
      ),
    )
    await expectCheckEnabledAgain(message)
    expectNoToast(REPLY_CHECK_COPY.notShowing)

    await userEvent.click(canvas.getByRole('button', { name: 'Open the next reply' }))
    await waitFor(() => expect(line).toBeEmptyDOMElement())
  },
  { ...NEEDS_CHECK_REPLY, reconcileDueAt: NEXT_CHECK_AT },
)

const NOT_ON_GOOGLE_STILL_CHECKED = checkResult('not_on_google', {
  reply: { ...NEEDS_CHECK_REPLY, reconcileDueAt: NEXT_CHECK_AT, stateRevision: 2 },
  nextAutomaticCheckAt: NEXT_CHECK_AT,
})
const CHECKS_AGAIN_LINE = `Checked Google at ${formatCheckTime(CHECKED_AT)}. This reply isn't showing there. RepKey checks again automatically.`

let repeatedCheck: PromiseWithResolvers<ReplyPublicationCheckResult> | null = null

/**
 * The same answer twice in the same minute. A live region speaks only when its
 * text changes, so a line that kept its sentence through the second check would
 * receive identical words and announce nothing — `Checking Google…`, then
 * silence. The line empties when a check starts, and every answer is inserted
 * fresh.
 */
export const NeedsCheckTwiceWithTheSameAnswer = checkStory(
  () => {
    repeatedCheck = Promise.withResolvers<ReplyPublicationCheckResult>()
    return repeatedCheck.promise
  },
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)
    repeatedCheck?.resolve(NOT_ON_GOOGLE_STILL_CHECKED)
    await waitFor(() => expect(line).toHaveTextContent(CHECKS_AGAIN_LINE))
    await expectCheckEnabledAgain(message)

    await userEvent.click(message.getByRole('button', { name: 'Check Google again' }))
    await message.findByRole('button', { name: 'Checking Google…' })
    expect(line).toBeEmptyDOMElement()

    repeatedCheck?.resolve(NOT_ON_GOOGLE_STILL_CHECKED)
    await waitFor(() => expect(line).toHaveTextContent(CHECKS_AGAIN_LINE))
    expect(message.getByRole('status')).toBe(line)
  },
  { ...NEEDS_CHECK_REPLY, reconcileDueAt: NEXT_CHECK_AT },
)

/**
 * The line describes the reply it was written for. A later poll that ends the
 * automatic checks puts `has stopped checking automatically` above it, and a
 * line still saying `RepKey checks again automatically.` would contradict it.
 */
export const NeedsCheckLineLeavesWhenChecksStop = checkStory(
  async () => NOT_ON_GOOGLE_STILL_CHECKED,
  async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const { message, line } = await clickCheck(canvasElement)
    await waitFor(() => expect(line).toHaveTextContent(CHECKS_AGAIN_LINE))

    await userEvent.click(canvas.getByRole('button', { name: 'Read the reply again' }))

    expect(await message.findByText(/stopped checking automatically/i)).toBeVisible()
    await waitFor(() => expect(line).toBeEmptyDOMElement())
  },
  { ...NEEDS_CHECK_REPLY, reconcileDueAt: NEXT_CHECK_AT },
  {
    polled: {
      ...NEEDS_CHECK_REPLY,
      publicationState: 'terminal',
      reconcileDueAt: null,
      stateRevision: 3,
    },
  },
)

/** The sweep confirmed the reply after the check: no "isn't showing" under Live. */
export const NeedsCheckLineLeavesWhenTheReplyGoesLive = checkStory(
  async () => NOT_ON_GOOGLE_STILL_CHECKED,
  async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const { message, line } = await clickCheck(canvasElement)
    await waitFor(() => expect(line).toHaveTextContent(CHECKS_AGAIN_LINE))

    await userEvent.click(canvas.getByRole('button', { name: 'Read the reply again' }))

    expect(await message.findByText('Live on Google')).toBeVisible()
    await waitFor(() => expect(line).toBeEmptyDOMElement())
  },
  { ...NEEDS_CHECK_REPLY, reconcileDueAt: NEXT_CHECK_AT },
  {
    polled: {
      ...NEEDS_CHECK_REPLY,
      status: 'published',
      publicationState: 'published',
      publishedAt: PUBLISHED_AT,
      reconcileDueAt: null,
      stateRevision: 3,
    },
  },
)

/**
 * The answer moved the reply (the automatic checks ended while Google was
 * read), and the cache write renders after the check settled. The line is for
 * the reply the check returned, so it waits for that reply rather than being
 * cleared by the one still on screen for a frame.
 */
export const NeedsCheckLineWaitsForTheReplyItDescribes = checkStory(
  async () =>
    checkResult('review_missing_on_google', {
      reply: {
        ...NEEDS_CHECK_REPLY,
        publicationState: 'terminal',
        reconcileDueAt: null,
        stateRevision: 2,
      },
    }),
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    expect(await message.findByText(/stopped checking automatically/i)).toBeVisible()
    await waitFor(() => expect(line).toHaveTextContent(REPLY_CHECK_COPY.reviewMissing))
  },
  { ...NEEDS_CHECK_REPLY, reconcileDueAt: NEXT_CHECK_AT },
  { cacheDelayMs: 50 },
)

/**
 * Another manager's check already settled this reply as never sent, and
 * nothing polls a reply that needs a check, so this pane is behind. The server
 * refuses (`This reply has nothing to check on Google.`), and the pane re-reads
 * the reply rather than leave a button the toast just contradicted.
 */
export const NeedsCheckRefusedBecauseTheReplyMovedOn = checkStory(
  async () => {
    throw new ServerFunctionError(
      'ReviewError',
      'This reply has nothing to check on Google.',
      'invalid_transition',
      400,
    )
  },
  async ({ canvasElement }) => {
    const { message } = await clickCheck(canvasElement)

    await expectToast('This reply has nothing to check on Google.')
    expect(
      await message.findByRole('button', { name: 'Try publishing again' }),
    ).toBeEnabled()
    expect(message.queryByRole('button', { name: 'Check Google again' })).toBeNull()
    expect(message.getByText('Not published')).toBeVisible()
  },
  NEEDS_CHECK_REPLY,
  {
    refetched: {
      ...NEEDS_CHECK_REPLY,
      publicationState: 'terminal',
      publicationLastErrorClass: 'retryable',
      stateRevision: 2,
    },
  },
)

/**
 * Positive evidence that the attempt never reached Google. The view changes by
 * itself — the returned reply is Not published, with Try publishing again — so
 * the toast says why, and the line stays empty.
 */
export const NeedsCheckNeverSent = checkStory(
  async () =>
    checkResult('never_sent', {
      reply: {
        ...NEEDS_CHECK_REPLY,
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
        stateRevision: 2,
      },
    }),
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    await expectToast("This reply never reached Google. It's safe to publish it again.")
    const retry = await message.findByRole('button', { name: 'Try publishing again' })
    expect(retry).toBeEnabled()
    expect(message.queryByRole('button', { name: 'Check Google again' })).toBeNull()
    expect(line).toBeEmptyDOMElement()
    // The focused check button is gone. Focus lands on the action the toast
    // just offered, not on <body>, where the next Tab restarts the page.
    await waitFor(() => expect(document.activeElement).toBe(retry))
  },
)

/** Confirmed live: the reply becomes Live on Google, and the toast says so. */
export const NeedsCheckLiveOnGoogle = checkStory(
  async () =>
    checkResult('live_on_google', {
      reply: {
        ...NEEDS_CHECK_REPLY,
        status: 'published',
        publicationState: 'published',
        publishedAt: PUBLISHED_AT,
        stateRevision: 2,
      },
    }),
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    await expectToast('Your reply is live on Google.')
    const edit = await message.findByRole('button', { name: 'Edit reply' })
    expect(edit).toBeEnabled()
    expect(message.queryByRole('button', { name: 'Check Google again' })).toBeNull()
    expect(line).toBeEmptyDOMElement()
    // The whole action row remounted under its new status key; focus follows.
    await waitFor(() => expect(document.activeElement).toBe(edit))
  },
)

/**
 * Google shows a reply RepKey cannot read: said with its time, and nothing
 * moves. This reply's automatic checks have ended (`reconcileDueAt` null), and
 * `unreadable` schedules none, so the line sends the manager to Google rather
 * than promising a check the description above says has stopped.
 */
export const NeedsCheckUnreadable = checkStory(
  async () => checkResult('unreadable_on_google'),
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    await waitFor(() =>
      expect(line).toHaveTextContent(
        `Checked Google at ${formatCheckTime(CHECKED_AT)}. ${REPLY_CHECK_COPY.unreadableStopped}`,
      ),
    )
    expect(line).not.toHaveTextContent(/keep checking/i)
    expect(message.getByText(/stopped checking automatically/i)).toBeVisible()
    await expectCheckEnabledAgain(message)
    expectNoToast(REPLY_CHECK_COPY.unreadableStopped)
  },
)

/**
 * Another reply is live on the review. While the reply is still in the thread
 * the finding sits on its line; the next story is the same finding once the
 * reply has gone back to the composer.
 */
export const NeedsCheckDifferentReply = checkStory(
  async () => checkResult('different_reply_on_google'),
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    await waitFor(() =>
      expect(line).toHaveTextContent(
        'Google shows a different reply on this review, so RepKey stopped publishing this one.',
      ),
    )
    await expectCheckEnabledAgain(message)
    expectNoToast(REPLY_CHECK_COPY.differentReply)
  },
)

/**
 * A cancelled publication returns the reply to `draft`, and a draft is the
 * composer's: the whole message leaves the thread, with its line. The sentence
 * the line would have carried arrives as a toast instead of nowhere.
 */
export const NeedsCheckCancelled = checkStory(
  async () =>
    checkResult('cancelled', {
      reply: {
        ...NEEDS_CHECK_REPLY,
        status: 'draft',
        publicationState: 'cancelled',
        stateRevision: 2,
      },
    }),
  async ({ canvasElement }) => {
    await clickCheck(canvasElement)

    await expectToast('Publishing was cancelled.')
    await waitFor(() =>
      expect(
        within(canvasElement).queryByRole('article', { name: AUTHOR_LABEL }),
      ).toBeNull(),
    )
  },
)

export const NeedsCheckReviewMissing = checkStory(
  async () => checkResult('review_missing_on_google'),
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    await waitFor(() =>
      expect(line).toHaveTextContent('Google no longer returns this review.'),
    )
    await expectCheckEnabledAgain(message)
  },
)

/**
 * Google could not be reached. This is the click that used to vanish: the
 * rejection was caught and dropped at the button. Now the toast carries the
 * check's own sentence — a 500 whose message the check use case wrote for the
 * manager — and the button is ready for the retry it asks for.
 */
export const NeedsCheckError = checkStory(
  async () => {
    throw new ServerFunctionError(
      'ReviewError',
      "RepKey couldn't reach Google to check this reply. Try again in a minute.",
      'sync_failed',
      500,
    )
  },
  async ({ canvasElement }) => {
    const { message, line } = await clickCheck(canvasElement)

    await expectToast(
      "RepKey couldn't reach Google to check this reply. Try again in a minute.",
    )
    await expectCheckEnabledAgain(message)
    expect(line).toBeEmptyDOMElement()
    expect(message.getByText('Needs a check')).toBeVisible()
  },
)

/**
 * A failure that is safe to send again — and Try again is its WHOLE action
 * list. There is no server path that changes the text of a `publish_failed`
 * reply: `editPublishedReply` refuses anything that is not `published`, and
 * `REPLY_TRANSITIONS.publish_failed` has no `draft`, so it cannot be
 * re-drafted either. An Edit reply here opened an editor headed "Edit
 * published reply" whose every save could only fail into a toast.
 */
export const NotPublished: Story = {
  args: {
    reply: makeReply({
      status: 'publish_failed',
      approvedBy: userId(IDS.approver),
      approvedAt: APPROVED_AT,
      publicationState: 'terminal',
      publicationLastErrorClass: 'retryable',
      publicationAttempts: 5,
    }),
  },
  play: async ({ canvasElement }) => {
    resetSpies()
    const article = expectMessage(canvasElement, 'Confirmed', APPROVED_AT)
    const message = within(article)
    expect(message.getByText('Not published')).toBeVisible()
    expect(message.getByText(/stopped after 5 attempts/i)).toBeVisible()

    // Retry is the only control on the message, so there is no way to reach an
    // editor the server would refuse.
    expect(message.getAllByRole('button')).toHaveLength(1)
    expect(message.queryByRole('button', { name: /edit/i })).toBeNull()

    await userEvent.click(message.getByRole('button', { name: 'Try publishing again' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onCheck).not.toHaveBeenCalled()
    expect(onEditPublished).not.toHaveBeenCalled()
    expect(onEditRejected).not.toHaveBeenCalled()
  },
}

/**
 * A terminal rejection: Google refused the request, or RepKey refused to send
 * it, and the sentence claims neither. Same chip to the reader; a different
 * sentence — and the same single action, because the text is just as
 * unchangeable after a terminal rejection as after a retryable one.
 */
export const NotPublishedAfterGoogleRejection: Story = {
  args: {
    reply: makeReply({
      status: 'publish_failed',
      approvedBy: userId(IDS.approver),
      approvedAt: APPROVED_AT,
      publicationState: 'terminal',
      publicationLastErrorClass: 'terminal_rejection',
      publicationAttempts: 1,
    }),
  },
  play: async ({ canvasElement }) => {
    const article = expectMessage(canvasElement, 'Confirmed', APPROVED_AT)
    const message = within(article)
    expect(message.getByText('Not published')).toBeVisible()
    expect(message.getByText(/nothing was posted to google/i)).toBeVisible()
    expect(message.getByRole('button', { name: 'Try publishing again' })).toBeEnabled()
    expect(message.getAllByRole('button')).toHaveLength(1)
  },
}

export const NotPublishedWhileSaving: Story = {
  args: { ...NotPublished.args, isSaving: true },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    expect(canvas.getAllByRole('button')).toHaveLength(1)
  },
}

// ── rejected ─────────────────────────────────────────────────────────────────

export const Rejected: Story = {
  args: {
    reply: makeReply({
      status: 'rejected',
      rejectedBy: userId(IDS.rejecter),
      rejectionReason: REJECTION_REASON,
      updatedAt: REJECTED_AT,
    }),
  },
  play: async ({ canvasElement }) => {
    resetSpies()
    const article = expectMessage(canvasElement, 'Rejected', REJECTED_AT)
    const message = within(article)
    expect(message.getByText('Rejected')).toBeVisible()

    // A colleague's words, LABELLED as such and in the same line as them.
    // Unprefixed, an authored reason sits in the same muted slot and the same
    // type as RepKey's own failure sentences ("RepKey stopped after 5
    // attempts…"), and a reader cannot tell the person from the product.
    const reasonLine = message.getByText(REJECTION_REASON)
    expect(reasonLine).toBeVisible()
    expect(within(reasonLine).getByText('Reason:')).toBeVisible()

    // Meta line, the reply, the reason.
    expect(message.getAllByRole('paragraph')).toHaveLength(3)

    const resubmit = message.getByRole('button', { name: 'Edit & resubmit' })
    // NOT a disclosure, and not a false one either. Reopening is a
    // `draftReplyFn` round trip: the drafted reply re-resolves to `compose`, so
    // this whole message unmounts before any editor exists and the composer
    // that appears is nobody's controlled region. `aria-expanded="false"` here
    // would promise an expandable control that can never be seen to expand.
    expect(resubmit).not.toHaveAttribute('aria-expanded')

    await userEvent.click(resubmit)
    expect(onEditRejected).toHaveBeenCalledOnce()
    expect(onEditPublished).not.toHaveBeenCalled()
  },
}

/** An empty reason is no reason: it must not open a line that reads as a redaction. */
export const RejectedWithoutReason: Story = {
  args: {
    reply: makeReply({
      status: 'rejected',
      rejectedBy: userId(IDS.rejecter),
      rejectionReason: null,
      updatedAt: REJECTED_AT,
    }),
  },
  play: async ({ canvasElement }) => {
    const article = expectMessage(canvasElement, 'Rejected', REJECTED_AT)
    const message = within(article)
    expect(message.getByText('Rejected')).toBeVisible()
    // No reason, so no label either — a bare `Reason:` would read as a redaction.
    expect(message.queryByText('Reason:')).toBeNull()
    // Meta line and the reply — no third paragraph.
    expect(message.getAllByRole('paragraph')).toHaveLength(2)
    expect(message.getByRole('button', { name: 'Edit & resubmit' })).toBeEnabled()
  },
}

export const RejectedWhileSaving: Story = {
  args: { ...Rejected.args, isSaving: true },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('button', { name: 'Edit & resubmit' })).toBeDisabled()
  },
}

// ── the two states that are not thread messages at all ───────────────────────

/**
 * A draft is the composer's. If it rendered here too, a manager would be
 * editing one reply in two places — which is exactly the bug this component
 * replaced seven others to prevent.
 */
export const DraftIsNotInTheThread: Story = {
  args: { reply: makeReply({ status: 'draft', submittedAt: null }) },
  play: async ({ canvas }) => {
    expect(canvas.queryByRole('article')).toBeNull()
    expect(canvas.queryByText(REPLY_TEXT)).toBeNull()
    expect(canvas.queryAllByRole('button')).toHaveLength(0)
  },
}

/** No reply yet — the thread says nothing rather than showing an empty shell. */
export const NoReplyIsNotInTheThread: Story = {
  args: { reply: null },
  play: async ({ canvas }) => {
    expect(canvas.queryByRole('article')).toBeNull()
    expect(canvas.queryByRole('heading')).toBeNull()
    expect(canvas.queryAllByRole('button')).toHaveLength(0)
  },
}

// ── author fallback ──────────────────────────────────────────────────────────

/**
 * The item carries the property's name or nothing. The author settles on the
 * same neutral noun the pane header uses rather than leaving the line blank —
 * and never falls back to an id.
 */
export const UnnamedProperty: Story = {
  args: { reply: makeReply(), propertyName: null },
  play: async ({ canvasElement }) => {
    const article = within(canvasElement).getByRole('article', {
      name: 'Reply from Property',
    })
    expect(within(article).getByText('Property')).toBeVisible()
    expect(within(article).queryAllByRole('heading')).toHaveLength(0)
    expect(article.textContent ?? '').not.toContain(RAW_ID_MARKER)
  },
}
