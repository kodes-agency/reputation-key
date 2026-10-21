// "Check on Google" in the Inbox detail header's menu: the action next to
// "Open on Google", its running state, and the toast each answer leaves.
//
// The menu is the real `InboxDetailCopyMenu` and the check is the real
// `useGoogleReviewCheck`; only the server function is a stub, so the stories
// reach every answer without Google. The Vitest Storybook project compiles no
// Tailwind, so the plays pin roles, names and attributes, never geometry. The
// menu and the toast are portals, so both are read from `document.body`.
import type { Meta, StoryObj } from '@storybook/react'
import { toast } from 'sonner'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { makeInboxItem } from '../../../.storybook/in-memory/inbox-container'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import type { InboxGoogleCheckOutcome } from '#/contexts/inbox/application/public-api'
import { GOOGLE_CHECK_COPY } from './google-check-copy'
import { InboxDetailCopyMenu } from './inbox-detail-copy-menu'
import type { InboxServerFns } from './types'
import { useGoogleReviewCheck } from './use-google-review-check'
import type { InboxDetailState } from './use-inbox-detail'

type Detail = NonNullable<InboxDetailState['detail']>

const REVIEW_PAGE =
  'https://business.google.com/n/repkey-synthetic-do-not-use-location-0001/reviews/repkey-synthetic-do-not-use-reply-token-0001'
const TRIGGER_NAME = 'More actions for this review'

const item = makeInboxItem({
  id: '00000000-0000-4000-8000-0000000000d1',
  sourceType: 'review',
})

const detail: Detail = {
  item,
  reviewText: 'Great location and very clean rooms.',
  reviewTranslatedText: null,
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: REVIEW_PAGE,
  googlePropertyReviewsUrl: null,
  reviewContentStatus: 'available',
  reviewRating: 4,
  feedbackComment: null,
  feedbackRatingValue: null,
  reply: null,
  analysis: null,
  feedbackHandling: null,
  responseTarget: null,
}

type Answer = InboxGoogleCheckOutcome | 'never' | 'fails'

/** The pane's menu over a stub server that answers `answer` (`never`: still running). */
function Harness({ answer }: Readonly<{ answer: Answer }>) {
  const checkReviewOnGoogle = mockServerFn(
    async (): Promise<{ outcome: InboxGoogleCheckOutcome }> => {
      if (answer === 'never') return new Promise(() => undefined)
      if (answer === 'fails') throw new Error('network')
      return { outcome: answer }
    },
  ) as unknown as InboxServerFns['checkReviewOnGoogle']
  const googleCheck = useGoogleReviewCheck({ item, checkReviewOnGoogle })
  return <InboxDetailCopyMenu detail={detail} googleCheck={googleCheck} />
}

const meta: Meta<typeof Harness> = {
  title: 'Inbox/Detail Google check',
  component: Harness,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [ToasterDecorator],
}
export default meta
type Story = StoryObj<typeof Harness>

async function openMenu(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: TRIGGER_NAME }))
  return within(await screen.findByRole('menu'))
}

/** The action by its idle or its running name: the pending label replaces the idle one. */
const isCheckItemName = (name: string) =>
  name.startsWith(GOOGLE_CHECK_COPY.action) || name.startsWith(GOOGLE_CHECK_COPY.pending)

const checkItem = (menu: ReturnType<typeof within>) =>
  menu.getByRole('menuitem', { name: isCheckItemName })

/** Close the menu and clear the toasts, which the page keeps from story to story. */
async function tidy() {
  await userEvent.keyboard('{Escape}')
  toast.dismiss()
}

/** The action sits right after "Open on Google", before the copy items. */
export const Offered: Story = {
  args: { answer: 'no_reply' },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    const labels = menu
      .getAllByRole('menuitem')
      .map((entry) => entry.textContent?.split('(')[0]?.trim())
    expect(labels).toEqual([
      expect.stringMatching(/^Open on Google/),
      `${GOOGLE_CHECK_COPY.action} ${GOOGLE_CHECK_COPY.actionHint}`,
      'Copy review text',
    ])
    const check = checkItem(menu)
    expect(check).not.toHaveAttribute('aria-busy')
    expect(check).not.toHaveAttribute('aria-disabled')
    await tidy()
  },
}

export const OfferedLight: Story = { ...Offered, parameters: { theme: 'light' } }

/** Running: the item says so, is busy, and the menu stays open on it. */
export const Checking: Story = {
  args: { answer: 'never' },
  play: async ({ canvasElement }) => {
    const menu = await openMenu(canvasElement)
    await userEvent.click(checkItem(menu))

    await waitFor(() => expect(checkItem(menu)).toHaveAttribute('aria-busy', 'true'))
    const running = checkItem(menu)
    expect(running).toHaveAttribute('aria-disabled', 'true')
    expect(running).toHaveTextContent(GOOGLE_CHECK_COPY.pending)
    expect(running).not.toHaveTextContent(GOOGLE_CHECK_COPY.action)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // A second choice while it runs is not another read, and not a closed menu.
    await userEvent.click(running)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await tidy()
  },
}

export const CheckingLight: Story = { ...Checking, parameters: { theme: 'light' } }

/** The answer is a toast, and the menu closes behind it. */
async function playAnswer(canvasElement: HTMLElement, toastText: string) {
  toast.dismiss()
  const menu = await openMenu(canvasElement)
  await userEvent.click(checkItem(menu))
  expect(await screen.findByText(toastText)).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  toast.dismiss()
}

export const ReplyFound: Story = {
  args: { answer: 'reply_found' },
  play: ({ canvasElement }) =>
    playAnswer(canvasElement, 'Google shows a reply. Closing this item.'),
}

export const NoReplyYet: Story = {
  args: { answer: 'no_reply' },
  play: ({ canvasElement }) => playAnswer(canvasElement, 'Google shows no reply yet.'),
}

export const GoogleUnavailable: Story = {
  args: { answer: 'unavailable' },
  play: ({ canvasElement }) => playAnswer(canvasElement, GOOGLE_CHECK_COPY.unavailable),
}

export const AskedTooOften: Story = {
  args: { answer: 'rate_limited' },
  play: ({ canvasElement }) => playAnswer(canvasElement, GOOGLE_CHECK_COPY.unavailable),
}

export const CallFails: Story = {
  args: { answer: 'fails' },
  play: ({ canvasElement }) => playAnswer(canvasElement, GOOGLE_CHECK_COPY.unavailable),
}

/** A review the server cannot check: told once, then the action is gone. */
export const NotCheckable: Story = {
  args: { answer: 'not_checkable' },
  play: async ({ canvasElement }) => {
    await playAnswer(canvasElement, GOOGLE_CHECK_COPY.notCheckable)
    const menu = await openMenu(canvasElement)
    expect(menu.queryByRole('menuitem', { name: isCheckItemName })).toBeNull()
    expect(menu.getByRole('menuitem', { name: /^Open on Google/ })).toBeInTheDocument()
    await tidy()
  },
}
