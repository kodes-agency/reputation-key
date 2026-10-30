// A review's v3 reading in the Inbox: the specific causes it names as chips, the
// sentences it cites underlined in the guest's own words, the chips an issue link was
// about, and "Not right?" — a manager's corrections, which take effect as they are clicked.
//
// The Vitest Storybook project compiles no Tailwind, so every utility class is inert
// here. Nothing below asserts geometry or colour — only content, roles, accessible names
// and what the dialog sends, which are real in this runner.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { InboxThread, type ThreadReplyActions } from './inbox-thread'
import type { getInboxItemHistoryFn } from '#/contexts/inbox/server/inbox'
import type {
  InboxItemDetailResult,
  InboxMentionV3,
  InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'
import type { InboxServerFns } from './types'

const REVIEW_ID = '00000000-0000-4000-8000-0000000000a1'
const AIR_CON_ISSUE = 'a0000000-0000-4000-8000-000000000001'
const VIEW_ISSUE = 'a0000000-0000-4000-8000-000000000002'
const ANALYSIS_SEQUENCE = 7
const CORRECTED_AT = Date.parse('2026-10-30T09:00:00Z')

// Three sentences by `review-sentences-v1`: the praise is the first, the complaint the
// second, the remark the third.
const REVIEW_TEXT =
  'Lovely room with a beautiful view. The air conditioning broke on the second night and nobody came to fix it. Breakfast was fine.'

const reviewItem = {
  ...makeInboxItem({ id: REVIEW_ID, sourceType: 'review' }),
  sourceDate: new Date('2026-10-20T09:00:00Z'),
  rating: null,
}

function mention(over: Partial<InboxMentionV3>): InboxMentionV3 {
  return {
    mentionOrdinal: 0,
    topic: 'facilities_equipment',
    polarity: 'negative',
    strength: 'clear',
    thing: 'air conditioning',
    issue: 'not working',
    issueGroupId: AIR_CON_ISSUE,
    sentenceNumbers: [2],
    namesPerson: null,
    correction: null,
    ...over,
  }
}

const MENTIONS: readonly InboxMentionV3[] = [
  mention({}),
  mention({
    mentionOrdinal: 1,
    topic: 'atmosphere_noise',
    polarity: 'positive',
    thing: 'view',
    issue: 'beautiful',
    issueGroupId: VIEW_ISSUE,
    sentenceNumbers: [1],
  }),
  mention({
    mentionOrdinal: 2,
    topic: 'food_drink',
    polarity: 'neutral',
    thing: 'breakfast',
    issue: 'fine',
    issueGroupId: null,
    sentenceNumbers: [3],
  }),
]

function reading(mentions: readonly InboxMentionV3[]): InboxReviewAnalysis {
  return {
    status: 'ready_v3',
    analysisSequence: ANALYSIS_SEQUENCE,
    sentiment: 'mixed',
    attention: 'medium',
    urgentReason: null,
    mentions,
    generatedAtEpochMillis: Date.parse('2026-10-20T09:10:00Z'),
  }
}

function detailOf(mentions: readonly InboxMentionV3[]): InboxItemDetailResult {
  return {
    item: reviewItem,
    reviewText: REVIEW_TEXT,
    reviewTranslatedText: null,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    googlePropertyReviewsUrl: null,
    reviewContentStatus: 'available',
    reviewRating: 3,
    feedbackComment: null,
    feedbackRatingValue: null,
    reply: null,
    analysis: reading(mentions),
    propertyDefaultReplyLanguage: null,
    reviewReplyLanguage: null,
    feedbackHandling: null,
    responseTarget: null,
  }
}

const noHistory = mockServerFn(
  async ({ data }: Parameters<typeof getInboxItemHistoryFn>[0]) => ({
    inboxItemId: data.inboxItemId,
    entries: [],
    truncated: false,
  }),
) as unknown as typeof getInboxItemHistoryFn

// Nothing here is a reply: the thread draws the review alone, so none of these is called.
const replyActions: ThreadReplyActions = {
  isSaving: false,
  isEditing: false,
  onApprove: fn(async () => undefined),
  onReject: fn(async () => undefined),
  onCheck: fn(async () => {
    throw new Error('this thread has no reply to check')
  }),
  onRetry: fn(async () => undefined),
  onEditPublished: fn(() => {}),
  onEditRejected: fn(() => {}),
}

type Correct = NonNullable<InboxServerFns['correctReviewMention']>

/** A correction function that answers as the server does, and remembers what it was asked. */
function correcting(
  answer: Awaited<ReturnType<Correct>> = { status: 'applied', mentionOrdinals: [0] },
) {
  return fn(async (_input: Parameters<Correct>[0]) => answer)
}

const meta: Meta<typeof InboxThread> = {
  title: 'Inbox/Review cause',
  component: InboxThread,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 720 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    item: reviewItem,
    detail: detailOf(MENTIONS),
    notes: [],
    notesUnavailable: false,
    currentUserId: 'user-current',
    getInboxItemHistory: noHistory,
    replyActions,
    correctReviewMention: correcting(),
  },
}
export default meta

type Story = StoryObj<typeof InboxThread>

const marksOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('mark')).map((mark) => mark.textContent)

// ─── the chips and the evidence ──────────────────────────────────────────────

// A chip says the cause, not the topic alone, and the way the guest felt about it in
// words; the sentences that state them are underlined in the guest's own words.
export const SpecificCausesAndTheirEvidence: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chips = within(await canvas.findByRole('list', { name: 'Review topics' }))

    await expect(chips.getAllByRole('listitem')).toHaveLength(3)
    await expect(
      chips.getByText(/Air conditioning, not working · Complaint/),
    ).toBeVisible()
    await expect(chips.getByText(/View, beautiful · Praise/)).toBeVisible()
    await expect(chips.getByText(/Breakfast, fine · Neutral/)).toBeVisible()

    await expect(marksOf(canvasElement)).toEqual([
      'Lovely room with a beautiful view.',
      'The air conditioning broke on the second night and nobody came to fix it.',
      'Breakfast was fine.',
    ])
  },
}

// A Guest voice link opens the Inbox on one issue: the chips that are it are marked, and
// one line says in words which.
export const OpenedFromAnIssue: Story = {
  decorators: [
    withRole('AccountAdmin', { at: `/?issue=${AIR_CON_ISSUE}&polarity=negative` }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await expect(
      await canvas.findByText('Matched: Air conditioning, not working'),
    ).toBeVisible()
    await expect(canvas.getByText(/matches the issue you followed/)).toBeInTheDocument()
  },
}

// A manager's word is shown where it counts: a set-aside topic is struck and underlines
// nothing, a complaint called no problem is a remark, a changed cause reads in their words.
export const AfterCorrections: Story = {
  args: {
    detail: detailOf([
      mention({
        correction: { kind: 'not_a_problem', correctedAtEpochMillis: CORRECTED_AT },
      }),
      mention({
        mentionOrdinal: 1,
        topic: 'atmosphere_noise',
        polarity: 'positive',
        thing: 'view',
        issue: 'beautiful',
        sentenceNumbers: [1],
        correction: { kind: 'remove_topic', correctedAtEpochMillis: CORRECTED_AT },
      }),
      mention({
        mentionOrdinal: 2,
        topic: 'food_drink',
        polarity: 'neutral',
        thing: 'breakfast',
        issue: 'fine',
        sentenceNumbers: [3],
        correction: {
          kind: 'change_cause',
          thing: 'buffet',
          issue: 'cold',
          correctedAtEpochMillis: CORRECTED_AT,
        },
      }),
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chips = within(await canvas.findByRole('list', { name: 'Review topics' }))

    await expect(chips.getByText(/Air conditioning, not working · Neutral/)).toBeVisible()
    await expect(chips.getByText('Not a problem')).toBeVisible()
    await expect(chips.getByText('Removed')).toBeVisible()
    await expect(chips.getByText(/Buffet, cold · Neutral/)).toBeVisible()
    await expect(chips.getByText('Cause changed')).toBeVisible()

    // The set-aside topic's sentence is plain; the other two are still cited.
    await expect(marksOf(canvasElement)).toEqual([
      'The air conditioning broke on the second night and nobody came to fix it.',
      'Breakfast was fine.',
    ])
  },
}

// ─── "Not right?" ────────────────────────────────────────────────────────────

const AIR_CON_READING = 'Air conditioning, not working · Complaint'

async function openDialog(canvasElement: HTMLElement) {
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: 'Not right?' }),
  )
  return within(await within(document.body).findByRole('dialog', { name: 'Not right?' }))
}

// Every line takes effect as it is clicked, and the request names the reading on screen.
export const SetsATopicAside: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)

    await userEvent.click(
      dialog.getByRole('button', { name: `Remove topic: ${AIR_CON_READING}` }),
    )

    await waitFor(() =>
      expect(args.correctReviewMention).toHaveBeenCalledWith({
        data: {
          reviewId: REVIEW_ID,
          analysisSequence: ANALYSIS_SEQUENCE,
          mentionOrdinal: 0,
          action: { kind: 'remove_topic' },
        },
      }),
    )
  },
}

// Only a complaint can be called no problem; praise and remarks are not offered it.
export const OffersNoProblemOnlyForAComplaint: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)

    await expect(dialog.getAllByRole('button', { name: /^Not a problem:/ })).toHaveLength(
      1,
    )
    await userEvent.click(
      dialog.getByRole('button', { name: `Not a problem: ${AIR_CON_READING}` }),
    )
    await waitFor(() =>
      expect(args.correctReviewMention).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: { kind: 'not_a_problem' } }),
        }),
      ),
    )
  },
}

// The cause opens on the AI's words; what the manager types is sent as typed, and the
// server folds it.
export const ChangesACause: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)

    await userEvent.click(
      dialog.getByRole('button', { name: `Change cause: ${AIR_CON_READING}` }),
    )
    const form = within(await dialog.findByRole('form', { name: 'Change the cause' }))
    await expect(form.getByLabelText(/What it is about/)).toHaveValue('air conditioning')
    const said = form.getByLabelText(/What was wrong/)
    await expect(said).toHaveValue('not working')

    await userEvent.clear(said)
    await userEvent.type(said, 'too noisy')
    await userEvent.click(form.getByRole('button', { name: 'Save cause' }))

    await waitFor(() =>
      expect(args.correctReviewMention).toHaveBeenCalledWith({
        data: {
          reviewId: REVIEW_ID,
          analysisSequence: ANALYSIS_SEQUENCE,
          mentionOrdinal: 0,
          action: { kind: 'change_cause', thing: 'air conditioning', issue: 'too noisy' },
        },
      }),
    )
  },
}

// A phrase the server will not keep stays in the form with the reason above the buttons.
export const RefusesWordsItCannotKeep: Story = {
  args: { correctReviewMention: correcting({ status: 'invalid_cause' }) },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)

    await userEvent.click(
      dialog.getByRole('button', { name: `Change cause: ${AIR_CON_READING}` }),
    )
    const form = within(await dialog.findByRole('form', { name: 'Change the cause' }))
    await userEvent.click(form.getByRole('button', { name: 'Save cause' }))

    const banner = within(await dialog.findByRole('alert'))
    await expect(banner.getByText(/letters and hyphens only/)).toBeVisible()
    await expect(form.getByRole('button', { name: 'Save cause' })).toBeInTheDocument()
  },
}

// A topic that was set aside is one line with the way to give it back whole.
export const GivesATopicBack: Story = {
  args: {
    detail: detailOf([
      mention({
        correction: { kind: 'remove_topic', correctedAtEpochMillis: CORRECTED_AT },
      }),
      ...MENTIONS.slice(1),
    ]),
    correctReviewMention: correcting({ status: 'cleared', mentionOrdinals: [0] }),
  },
  play: async ({ canvasElement, args }) => {
    const dialog = await openDialog(canvasElement)

    await expect(dialog.getByText('Removed from this review')).toBeVisible()
    await userEvent.click(
      dialog.getByRole('button', { name: 'Undo: Facilities and equipment' }),
    )

    await waitFor(() =>
      expect(args.correctReviewMention).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mentionOrdinal: 0, action: { kind: 'undo' } }),
        }),
      ),
    )
  },
}

// ─── who is offered it ───────────────────────────────────────────────────────

// A Member may add notes but is not a manager of the Inbox: no way to correct the reading.
export const NotOfferedToAMember: Story = {
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await expect(await canvas.findByRole('list', { name: 'Review topics' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Not right?' })).toBeNull()
  },
}

// Where the Inbox was not given the means, the chips stand alone.
export const NotOfferedWithoutTheMeans: Story = {
  args: { correctReviewMention: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await expect(await canvas.findByRole('list', { name: 'Review topics' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Not right?' })).toBeNull()
  },
}
