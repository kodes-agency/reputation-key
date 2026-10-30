// The issue drawer of Guest voice 2.0, open, in each state it can be in: read, hidden,
// holding a long review, holding fewer quotes than reviews, being read, and failed. The
// drawer is a sheet over the page, so each story is drawn open, full screen.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type { GuestVoiceWindow } from '#/contexts/ai/application/public-api'
import { GuestVoiceProvider } from './guest-voice-context'
import { PROPERTY_ID } from './guest-voice-fixtures-build'
import {
  FACILITIES_DRAWER,
  HIDDEN_DRAWER,
  LONG_REVIEW_DRAWER,
  SMALL_DRAWER,
  URGENT_DRAWER,
} from './guest-voice-fixtures-drawers'
import {
  GuestVoiceIssueDrawer,
  type GuestVoiceDrawerRead,
} from './guest-voice-issue-drawer'

type StoryProps = Readonly<{
  read: GuestVoiceDrawerRead
  knownTitle?: string
  window?: GuestVoiceWindow
  onClose: () => void
  onNotRight: (issueId: string) => void
}>

function DrawerStory({
  read,
  knownTitle = undefined,
  window = '90d',
  onClose,
  onNotRight,
}: StoryProps) {
  return (
    <GuestVoiceProvider
      value={{
        propertyId: PROPERTY_ID,
        window,
        startLocalDate: '2026-07-31',
        endLocalDate: '2026-10-29',
        onOpenIssue: fn(),
        onNotRight,
      }}
    >
      <GuestVoiceIssueDrawer
        openIssueId="open"
        knownTitle={knownTitle ?? null}
        read={read}
        onClose={onClose}
      />
    </GuestVoiceProvider>
  )
}

const meta = {
  title: 'Property/GuestVoice2/Issue drawer',
  component: DrawerStory,
  tags: ['autodocs'],
  decorators: [AuthedRouterDecorator],
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'desktopManager' } },
  args: {
    read: { status: 'ready', drawer: FACILITIES_DRAWER },
    onClose: fn(),
    onNotRight: fn(),
  },
} satisfies Meta<typeof DrawerStory>

export default meta
type Story = StoryObj<typeof meta>

const PHONE = {
  layout: 'fullscreen',
  viewport: { defaultViewport: 'mobileStaff' },
} as const

/** Facilities and equipment, the agreed design's own example: rising over the year. */
export const Facilities: Story = {
  play: async ({ args }) => {
    const drawer = within(
      await within(document.body).findByRole('dialog', {
        name: 'Facilities and equipment',
      }),
    )
    // The definition is the sheet's description, and the figures lead.
    expect(drawer.getByText(/Something the guest used was broken/u)).toBeVisible()
    expect(drawer.getByText('19 of 128')).toBeVisible()
    expect(drawer.getByText('Rising, likely real')).toBeVisible()

    // The year in bars, read out as a list for anyone who cannot see them.
    expect(
      drawer.getByText('October 2026: 8 of 44 reviews with text'),
    ).toBeInTheDocument()

    // The causes, with how many reviews name each.
    const causes = within(drawer.getByRole('list', { name: 'Causes' }))
    expect(causes.getByText('Air conditioning')).toBeVisible()
    expect(causes.getAllByRole('listitem')).toHaveLength(4)

    // The guests' words, the cited sentence underlined.
    expect(drawer.getAllByRole('figure')).toHaveLength(4)
    expect(drawer.getByText(/air conditioning didn't work for two nights/u).tagName).toBe(
      'MARK',
    )
    expect(drawer.getAllByRole('link', { name: 'Open in the inbox' })).toHaveLength(3)

    await userEvent.click(drawer.getByRole('button', { name: 'Not right?' }))
    expect(args.onNotRight).toHaveBeenCalledWith(FACILITIES_DRAWER.issueId)
  },
}

export const FacilitiesPhone: Story = { parameters: PHONE }

/** An Urgent review: one review, one quote, the reason on the page behind it. */
export const UrgentRailing: Story = {
  args: { read: { status: 'ready', drawer: URGENT_DRAWER } },
}

/** Five reviews name it and three can be quoted: the drawer says so and sends on to the Inbox. */
export const FewerQuotesThanReviews: Story = {
  args: { read: { status: 'ready', drawer: SMALL_DRAWER }, window: '365d' },
  play: async () => {
    const drawer = within(
      await within(document.body).findByRole('dialog', { name: 'Cleanliness' }),
    )
    expect(
      drawer.getByText(
        'Showing 3 of 5 reviews. The rest are in the inbox; a review that names a person is not quoted here.',
      ),
    ).toBeVisible()
  },
}

/** A long review is quoted at its cited sentences, with a little around them. */
export const LongReview: Story = {
  args: { read: { status: 'ready', drawer: LONG_REVIEW_DRAWER } },
  play: async () => {
    const drawer = within(
      await within(document.body).findByRole('dialog', {
        name: 'Facilities and equipment',
      }),
    )
    const quote = drawer.getByText(/the lift stopped/u).closest('blockquote')
    expect(quote?.textContent?.startsWith('“… ')).toBe(true)
    expect(quote?.textContent).not.toContain('We booked three nights')
  },
}

/** A manager hid the issue: it is off the page, and the drawer says where its reviews are. */
export const Hidden: Story = {
  args: { read: { status: 'ready', drawer: HIDDEN_DRAWER } },
  play: async () => {
    const drawer = within(
      await within(document.body).findByRole('dialog', {
        name: 'Facilities and equipment',
      }),
    )
    expect(drawer.getByText('Hidden from the page')).toBeVisible()
  },
}

export const Pending: Story = {
  args: { read: { status: 'pending' }, knownTitle: 'Facilities and equipment' },
}

export const Failed: Story = {
  args: {
    read: { status: 'error', onRetry: fn(), retrying: false },
    knownTitle: 'Facilities and equipment',
  },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}
