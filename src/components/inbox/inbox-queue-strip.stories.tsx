// The phone queue strip: a row of pills that scrolls sideways.
//
// The `mobileStaff` (390 px) and `mobileNarrow` (320 px) parameters really
// resize the runner window (see the header of `inbox-mobile-390.stories.tsx`),
// but no Tailwind is compiled here: `flex`, `overflow-x-auto`, `px-4` and the
// pill widths are all inert. The strip's *behaviour* (which pill is current,
// that a click reports the queue, that the active pill is scrolled into view,
// that a fade appears only when pills are out of reach) is real, though it needs
// a strip that can overflow, so `STRIP_LAYOUT` restates just the layout rules
// the classes carry, and only where Tailwind is missing. Geometry (x = 16, 44 px bar, 32 px pills) is asserted by
// the Playwright metrics gate, which runs against a real Tailwind build.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { InboxQueueCounts } from '#/contexts/inbox/application/public-api'
import { STRIP_FADE_PX } from '#/components/ui/strip-scroll'
import { tailwindIsCompiled } from '../../../.storybook/tailwind-compiled'
import { InboxQueueStrip } from './inbox-queue-strip'

const STRIP_LAYOUT = `
  nav[aria-label="Queues"] {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 0 16px;
    scrollbar-width: none;
  }
  nav[aria-label="Queues"] button {
    flex-shrink: 0;
    white-space: nowrap;
  }
`

const counts: InboxQueueCounts = {
  reply: 12,
  approval: 3,
  waiting: 1,
  feedback: 5,
  escalated: 2,
  mine: 4,
  closed: 118,
  open: 24,
}

const onQueueChange = fn()

const meta: Meta<typeof InboxQueueStrip> = {
  title: 'Inbox/Queue Strip',
  component: InboxQueueStrip,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <>
        {tailwindIsCompiled() ? null : <style>{STRIP_LAYOUT}</style>}
        <Story />
      </>
    ),
  ],
  args: {
    queue: 'reply',
    counts,
    canManageReplies: true,
    onQueueChange,
  },
}
export default meta
type Story = StoryObj<typeof InboxQueueStrip>
type Play = NonNullable<Story['play']>

function strip(canvasElement: HTMLElement) {
  return within(canvasElement).getByRole('navigation', { name: 'Queues' })
}

/** Reply is current and the first pill is showing: pills wait beyond the right edge. */
const expectRestingAtStart: Play = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const nav = strip(canvasElement)
  expect(canvas.getByRole('button', { name: /^needs reply/i })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(canvas.getByRole('button', { name: /^awaiting approval/i })).not.toHaveAttribute(
    'aria-current',
  )
  expect(nav.scrollLeft).toBe(0)
  // Pills lie beyond the right edge, so the strip is faded there.
  await waitFor(() => expect(nav.style.maskImage).not.toBe(''))

  // A pill that is already in view: focusing one beyond the edge would scroll
  // the strip, and the metrics gate measures this story's final frame at rest.
  onQueueChange.mockClear()
  await userEvent.click(canvas.getByRole('button', { name: /^awaiting approval/i }))
  expect(onQueueChange).toHaveBeenCalledWith('approval')
}

/** Closed is the last pill: opening on it scrolls it into view, fading the left edge. */
const expectClosedInView: Play = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const nav = strip(canvasElement)
  const closed = canvas.getByRole('button', { name: /^closed/i })
  expect(closed).toHaveAttribute('aria-current', 'page')
  await waitFor(() => expect(nav.scrollLeft).toBeGreaterThan(0))
  await waitFor(() => {
    const view = nav.getBoundingClientRect()
    const pill = closed.getBoundingClientRect()
    expect(pill.left).toBeGreaterThanOrEqual(view.left)
    expect(pill.right).toBeLessThanOrEqual(view.right)
  })
  await waitFor(() => expect(nav.style.maskImage).not.toBe(''))

  onQueueChange.mockClear()
  await userEvent.click(canvas.getByRole('button', { name: /^mine/i }))
  expect(onQueueChange).toHaveBeenCalledWith('mine')
}

/**
 * Escalated is a pill in the middle of the strip, beyond the right edge on a
 * phone: opening on it scrolls it in, onto the start edge and clear of the
 * edge fade on both sides (a pill 16px from an edge sits half under the 24px
 * fade that hints at its neighbour). At 320px the strip's scroll snapping used
 * to pull the scroll back and leave it half off the right edge.
 */
const expectMiddlePillClearOfFade: Play = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const nav = strip(canvasElement)
  const escalated = canvas.getByRole('button', { name: /^escalated/i })
  expect(escalated).toHaveAttribute('aria-current', 'page')
  await waitFor(() => expect(nav.scrollLeft).toBeGreaterThan(0))
  await waitFor(() => {
    const view = nav.getBoundingClientRect()
    const pill = escalated.getBoundingClientRect()
    expect(pill.left).toBeGreaterThanOrEqual(view.left + STRIP_FADE_PX - 0.5)
    expect(pill.right).toBeLessThanOrEqual(view.right - STRIP_FADE_PX + 0.5)
  })
}

export const Resting: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: expectRestingAtStart,
}

export const ClosedActive: Story = {
  args: { queue: 'closed' },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: expectClosedInView,
}

export const RestingNarrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: expectRestingAtStart,
}

export const ClosedActiveNarrow: Story = {
  args: { queue: 'closed' },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: expectClosedInView,
}

export const EscalatedActive: Story = {
  args: { queue: 'escalated' },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: expectMiddlePillClearOfFade,
}

export const EscalatedActiveNarrow: Story = {
  args: { queue: 'escalated' },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: expectMiddlePillClearOfFade,
}

// A member sees four queues plus Closed; on a wide window they all fit, and a
// strip with nothing out of reach draws no fade.
export const FitsWithoutFade: Story = {
  args: { queue: 'open', canManageReplies: false },
  play: async ({ canvasElement }) => {
    const nav = strip(canvasElement)
    expect(within(nav).getByRole('button', { name: /^open/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth)
    expect(nav.scrollLeft).toBe(0)
    expect(nav.style.maskImage).toBe('')
  },
}
