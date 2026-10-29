// Guest voice 2.0 on fixtures: the page as agreed, for a hotel with 128 reviews with
// text, a guesthouse with about three a month, a hotel with an Urgent review and a
// property with too few reviews to show patterns. Each is drawn at the width of a
// laptop and of a phone. Nothing here reads the v3 analysis: it does not exist yet.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type { GuestVoiceV2Read } from '#/contexts/ai/application/public-api'
import type { WindowFacts } from '#/contexts/ai/application/read-models/issue-statistics'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { PropertyGuestVoicePage } from '../property-guest-voice-page'
import type { GuestVoiceDrawerRead } from './guest-voice-issue-drawer'
import { PROPERTY_ID } from './guest-voice-fixtures-build'
import { drawerForIssue } from './guest-voice-fixtures-drawer-for'
import { FACILITIES_ID, LARGE_READ, LARGE_WINDOW } from './guest-voice-fixtures-large'
import { PROVISIONAL_READ, URGENT_READ } from './guest-voice-fixtures-states'
import { NOT_ENOUGH_READ, SMALL_READ, SMALL_WINDOW } from './guest-voice-fixtures-small'

type StoryProps = Readonly<{
  read: GuestVoiceV2Read
  /** What the read's figures were worked out over, for the drawers of the fixture. */
  window: WindowFacts
  range: GuestVoiceRange
  /** The issue whose drawer is open when the story starts. */
  openIssueId?: string
  onRangeChange: (range: GuestVoiceRange) => void
  onNotRight: (issueId: string) => void
}>

/** The route's part: keeps which drawer is open, and answers it from the fixture. */
function GuestVoiceV2Story({
  read,
  window,
  range,
  openIssueId = undefined,
  onRangeChange,
  onNotRight,
}: StoryProps) {
  const [open, setOpen] = useState<string | null>(openIssueId ?? null)
  const issue =
    open === null || read.status !== 'ready'
      ? undefined
      : drawerForIssue(read, open, window)
  const drawer: GuestVoiceDrawerRead =
    issue === undefined ? { status: 'pending' } : { status: 'ready', drawer: issue }
  return (
    <PropertyGuestVoicePage
      propertyId={PROPERTY_ID}
      propertyName="Harbour House Hotel"
      range={range}
      onRangeChange={onRangeChange}
      v2={{
        read,
        openIssueId: open,
        onOpenIssueChange: setOpen,
        drawer,
        onNotRight,
      }}
    />
  )
}

const meta = {
  title: 'Property/GuestVoice2',
  component: GuestVoiceV2Story,
  tags: ['autodocs'],
  decorators: [AuthedRouterDecorator],
  parameters: {
    layout: 'padded',
    viewport: { defaultViewport: 'desktopManager' },
  },
  args: {
    read: LARGE_READ,
    window: LARGE_WINDOW,
    range: 'auto',
    onRangeChange: fn(),
    onNotRight: fn(),
  },
} satisfies Meta<typeof GuestVoiceV2Story>

export default meta
type Story = StoryObj<typeof meta>

const PHONE = { viewport: { defaultViewport: 'mobileStaff' } } as const

/** 128 reviews with text in 90 days: the window the page chose, problems ranked by stars at stake. */
export const LargeProperty: Story = {
  play: async ({ canvas, args }) => {
    expect(
      canvas.getByText(
        'Last 90 days, chosen because it holds 128 reviews with text (plus 96 without text).',
      ),
    ).toBeVisible()

    // The sections, in the order a manager reads them.
    const headings = canvas
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([
      'In short',
      'Fix first',
      'Watch',
      'Guests love',
      'What changed',
      'Every topic',
    ])

    // The top problem, with the stars it could be costing, said as association.
    const fixFirst = within(canvas.getByRole('region', { name: 'Fix first' }))
    const cards = fixFirst.getAllByRole('article')
    expect(cards).toHaveLength(4)
    const top = within(cards[0] as HTMLElement)
    expect(top.getByRole('heading', { name: 'Facilities and equipment' })).toBeVisible()
    expect(top.getByText('19 of 128')).toBeVisible()
    expect(top.getByText('Rising, likely real')).toBeVisible()
    expect(top.getByText(/worth up to about/u)).toHaveTextContent(
      'worth up to about 0.2★ on your 90-day average',
    )
    expect(top.getByRole('link', { name: 'See all 19 reviews' })).toBeVisible()

    // "Not right?" is the manager's to press; the page only passes it on.
    await userEvent.click(top.getByRole('button', { name: 'Not right?' }))
    expect(args.onNotRight).toHaveBeenCalledWith(FACILITIES_ID)

    // The guests' words are underlined, not repeated in a colour.
    const marked = canvas.getAllByText(/air conditioning didn't work/u, {
      selector: 'mark',
    })
    expect(marked.length).toBeGreaterThan(0)

    // One neutral line about staff praise: no names, no complaint version.
    expect(canvas.getByText(/4 reviews praise a team member by name/u)).toBeVisible()
  },
}

/** The same page on a phone. */
export const LargePropertyPhone: Story = { parameters: PHONE }

/** A title opens its drawer: definition, the year in bars, causes and the guests' words. */
export const LargePropertyDrawer: Story = {
  args: { openIssueId: FACILITIES_ID },
  play: async () => {
    const body = within(document.body)
    const drawer = await body.findByRole('dialog', { name: 'Facilities and equipment' })
    const inDrawer = within(drawer)
    expect(inDrawer.getByText(/Something the guest used was broken/u)).toBeVisible()
    expect(inDrawer.getByRole('list', { name: 'Causes' })).toBeVisible()
    expect(inDrawer.getByText('Air conditioning')).toBeVisible()
    // Three quotes, and the figure of the year's bars.
    expect(inDrawer.getAllByRole('figure')).toHaveLength(4)
    expect(inDrawer.getByRole('link', { name: 'See all 19 reviews' })).toBeVisible()
    await userEvent.click(inDrawer.getByRole('button', { name: 'Close' }))
    expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

export const LargePropertyDrawerPhone: Story = {
  args: { openIssueId: FACILITIES_ID },
  parameters: PHONE,
}

/** About three reviews with text a month: the year, counts and early signals, no trend claimed. */
export const SmallProperty: Story = {
  args: { read: SMALL_READ, window: SMALL_WINDOW },
  play: async ({ canvas }) => {
    expect(
      canvas.getByText(
        'Last 12 months, chosen because no shorter period holds enough reviews with text. It holds 36 reviews with text (plus 14 without text).',
      ),
    ).toBeVisible()
    // The 12 months before hold too few reviews to say what is usual.
    expect(canvas.getAllByText('Too few reviews for a trend').length).toBeGreaterThan(0)
    expect(
      canvas.getByText('Nothing has changed by more than its usual ups and downs.'),
    ).toBeVisible()
    // Under three reviews a topic prints no average.
    const topics = within(canvas.getByRole('table', { name: 'Every topic' }))
    const communication = topics.getByText('Communication').closest('tr')
    if (!communication) throw new Error('Communication row is missing')
    expect(within(communication).getByText('too few')).toBeVisible()
  },
}

export const SmallPropertyPhone: Story = {
  args: { read: SMALL_READ, window: SMALL_WINDOW },
  parameters: PHONE,
}

/** A guest reported a loose balcony railing with children on it: Urgent, with its reason. */
export const UrgentReview: Story = {
  args: { read: URGENT_READ },
  play: async ({ canvas }) => {
    const urgent = within(
      canvas.getByRole('region', { name: 'An urgent review needs you' }),
    )
    expect(urgent.getByText('Urgent · safety')).toBeVisible()
    expect(urgent.getByText(/balcony railing was loose/u)).toBeVisible()
    expect(
      urgent.getByRole('link', { name: 'Open urgent reviews in the inbox' }),
    ).toHaveAttribute('href', expect.stringContaining('attention=urgent'))
    // It is the first thing on the page.
    const regions = canvas
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-labelledby'))
    expect(regions[0]).toBe(urgent.getByRole('heading', { level: 2 }).id)
  },
}

export const UrgentReviewPhone: Story = {
  args: { read: URGENT_READ },
  parameters: PHONE,
}

/** Under about 10 reviews with text in 12 months there are no patterns: the latest reviews instead. */
export const NotEnoughReviews: Story = {
  args: { read: NOT_ENOUGH_READ },
  play: async ({ canvas }) => {
    expect(canvas.getByText('Not enough reviews yet to spot patterns')).toBeVisible()
    expect(canvas.queryByRole('heading', { name: 'Fix first' })).not.toBeInTheDocument()
    const latest = within(canvas.getByRole('region', { name: 'Latest reviews' }))
    expect(latest.getAllByRole('listitem')).toHaveLength(4)
    // A review that names a person shows its stars and day and the way to the Inbox.
    expect(latest.getAllByRole('link', { name: 'Open in the inbox' })).toHaveLength(4)
    expect(latest.queryByText(/Maria/u)).not.toBeInTheDocument()
  },
}

export const NotEnoughReviewsPhone: Story = {
  args: { read: NOT_ENOUGH_READ },
  parameters: PHONE,
}

/** Reviews are still being analysed: the figures stand, no change is claimed. */
export const StillAnalysing: Story = {
  args: { read: PROVISIONAL_READ },
  play: async ({ canvas }) => {
    expect(
      canvas.getByText(
        /Some reviews are still being analysed, so these figures can still move/u,
      ),
    ).toBeVisible()
    expect(
      canvas.getByText('Changes appear once your reviews are analysed.'),
    ).toBeVisible()
  },
}
