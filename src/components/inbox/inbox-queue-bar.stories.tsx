// The phone's queue bar: one button naming the queue in view, a chip to the other
// kind's open queue, and the rail's sections in a bottom sheet (ADR 0057,
// amended 2026-10-28).
//
// The `mobileStaff` (390 px) and `mobileNarrow` (320 px) parameters really
// resize the runner window (see the header of `inbox-mobile-390.stories.tsx`),
// but no Tailwind is compiled in that runner. What these stories assert is
// behaviour: what the button and the chip say, what the sheet lists, and which
// queue a choice reports. Where things sit (the 44 px bar on the 16 px gutter,
// 36 px controls, the 44 px sheet rows, nothing past the edge at 320 px) is
// asserted by the Playwright metrics gate, which runs against a real Tailwind
// build (`e2e/storybook-metrics/inbox-phone.metrics.ts`).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { InboxQueueCounts } from '#/contexts/inbox/application/public-api'
import { InboxQueueBar } from './inbox-queue-bar'
import type { InboxQueueViewer } from './inbox-queue-sections'

const counts: InboxQueueCounts = {
  reply: 12,
  approval: 3,
  waiting: 1,
  feedback: 5,
  escalated: 2,
  mine: 4,
  open: 24,
  replied: null,
  handled: null,
  closed: null,
}

const MANAGER: InboxQueueViewer = {
  canManageReplies: true,
  canReadReviews: true,
  canReadFeedback: true,
}

const onQueueChange = fn()

const meta: Meta<typeof InboxQueueBar> = {
  title: 'Inbox/Queue Bar',
  component: InboxQueueBar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobileStaff' } },
  args: { queue: 'reply', counts, viewer: MANAGER, onQueueChange },
  beforeEach: () => onQueueChange.mockClear(),
}
export default meta
type Story = StoryObj<typeof InboxQueueBar>
type Play = NonNullable<Story['play']>

/** The sheet is a Radix portal: it lives on `document.body`, not in the story root. */
async function openSheet(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: /^Needs reply/ }),
  )
  return within(
    await within(canvasElement.ownerDocument.body).findByRole('dialog', {
      name: 'Queues',
    }),
  )
}

/** A Reviews queue: the button names it, the chip offers To handle with its count. */
const expectReviewsQueue: Play = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await expect(canvas.getByRole('button', { name: 'Needs reply 12' })).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'To handle 5' })).toBeVisible()

  await userEvent.click(canvas.getByRole('button', { name: 'To handle 5' }))
  await expect(onQueueChange).toHaveBeenCalledWith('feedback')
}

export const Resting: Story = { play: expectReviewsQueue }

export const RestingNarrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: expectReviewsQueue,
}

/** From a feedback queue the chip leads back to Needs reply. */
export const FeedbackQueue: Story = {
  args: { queue: 'feedback' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'To handle 5' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Needs reply 12' }))
    await expect(onQueueChange).toHaveBeenCalledWith('reply')
  },
}

/** A closed folder carries no count of its own, and still offers the other kind. */
export const RepliedFolder: Story = {
  args: { queue: 'replied' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Replied' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'To handle 5' })).toBeVisible()
  },
}

/** Mine, Escalated and All open hold both kinds already: no chip. */
export const SharedViewHasNoChip: Story = {
  args: { queue: 'escalated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Escalated 2' })).toBeVisible()
    await expect(canvas.getAllByRole('button')).toHaveLength(1)
  },
}

/** The other queue is empty: nothing to jump to. */
export const NoChipWhenTheOtherQueueIsEmpty: Story = {
  args: { counts: { ...counts, feedback: 0 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('button')).toHaveLength(1)
  },
}

/** Reply stages are off: the one reply row reads Open, and so does the chip back to it. */
export const WithoutReplyStages: Story = {
  args: {
    viewer: { ...MANAGER, canManageReplies: false },
    counts: { ...counts, reply: 24, approval: null, waiting: null },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Open 24' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'To handle 5' })).toBeVisible()
  },
}

export const FeedbackQueueWithoutReplyStages: Story = {
  args: {
    queue: 'feedback',
    viewer: { ...MANAGER, canManageReplies: false },
    counts: { ...counts, reply: 24, approval: null, waiting: null },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open 24' }))
    await expect(onQueueChange).toHaveBeenCalledWith('reply')
  },
}

/** The sheet draws the desktop rail's sections, headings and all. */
export const SheetOpen: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement)

    await expect(sheet.getByText('Reviews')).toBeVisible()
    await expect(sheet.getByText('Private feedback')).toBeVisible()
    for (const name of [
      /^Needs reply/,
      /^Awaiting approval/,
      /^Waiting for Google/,
      /^Replied$/,
      /^To handle/,
      /^Handled$/,
      /^Mine/,
      /^Escalated/,
      /^All open/,
    ]) {
      await expect(sheet.getByRole('button', { name })).toBeVisible()
    }
    // The queue in view is the one marked current.
    await expect(sheet.getByRole('button', { name: /^Needs reply/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
}

/** Choosing a queue reports it and closes the sheet. */
export const ChooseFromSheet: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement)

    await userEvent.click(sheet.getByRole('button', { name: /^Handled$/ }))

    await expect(onQueueChange).toHaveBeenCalledWith('handled')
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).toBeNull(),
    )
  },
}

/** Choosing the queue already in view closes the sheet and changes nothing. */
export const ChooseTheQueueInView: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement)

    await userEvent.click(sheet.getByRole('button', { name: /^Needs reply/ }))

    await expect(onQueueChange).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).toBeNull(),
    )
  },
}

/** A section disappears with its permission, and All open with the second kind. */
export const ReviewsOnlySheet: Story = {
  args: { viewer: { ...MANAGER, canReadFeedback: false } },
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement)

    await expect(sheet.getByText('Reviews')).toBeVisible()
    await expect(sheet.queryByText('Private feedback')).toBeNull()
    await expect(sheet.queryByRole('button', { name: /^All open/ })).toBeNull()
  },
}
