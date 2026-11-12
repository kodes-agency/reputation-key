import { useState } from 'react'
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PageGutterDecorator } from '../../../../../.storybook/PageGutterDecorator'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type { GuestVoiceDetailTarget, GuestVoiceV2Read } from '../contracts'
import { PropertyGuestVoicePage } from './property-guest-voice-page'
import { useGuestVoiceDetailNavigation } from './use-guest-voice-detail-navigation'
import {
  HAMPTON_READ,
  CHECK_IN_RENAMED,
  CHECK_IN_RENAMED_INPUT,
  CHECK_IN_STEADY,
  CHECK_IN_SLIPPING,
  CHECK_IN_INSUFFICIENT,
  QUIET_READ,
  CHECK_IN_SMALL,
  CHECK_IN_SMALL_CONCERN,
  CHECK_IN_PROVISIONAL,
  checkInDetail,
} from './guest-voice-fixtures-check-in'
import { GuestVoiceRatingChart } from './guest-voice-rating-chart'
import { PROPERTY_ID, fixtureId } from './guest-voice-fixtures-build'

function CheckInStory({
  read,
  initialTarget = null,
  detailState = 'ready',
  google = true,
  goal = true,
  renamed = false,
  missingQuote = false,
}: Readonly<{
  read: GuestVoiceV2Read
  initialTarget?: GuestVoiceDetailTarget | null
  detailState?: 'ready' | 'pending' | 'error'
  google?: boolean
  goal?: boolean
  renamed?: boolean
  missingQuote?: boolean
}>) {
  const [target, setTarget] = useState(initialTarget)
  const [range, setRange] = useState<'auto' | '30d' | '90d' | '180d' | '365d' | 'all'>(
    'auto',
  )
  const navigation = useGuestVoiceDetailNavigation(target, setTarget)
  return (
    <PropertyGuestVoicePage
      propertyId={PROPERTY_ID}
      propertyName="Hampton-like demonstration property"
      range={range}
      onRangeChange={(value) => {
        setRange(value)
        setTarget(null)
      }}
      v2={{
        read,
        googleNumbers: google
          ? {
              shows: 3.9,
              asOf: '2026-10-01T12:00:00.000Z',
              current: false,
              reviewCount: 132,
            }
          : null,
        ratingGoal: goal
          ? { mode: 'climb', target: 4.2, shows: 3.9, status: 'below_pace' }
          : null,
        drawer: {
          target,
          onTargetChange: navigation.open,
          navigation,
          read:
            detailState === 'pending'
              ? { status: 'pending' }
              : detailState === 'error'
                ? { status: 'error', onRetry: () => undefined, retrying: false }
                : target
                  ? checkInDetail(
                      target,
                      renamed ? CHECK_IN_RENAMED_INPUT : undefined,
                      missingQuote,
                    )
                  : { status: 'pending' },
        },
      }}
    />
  )
}
/** Stands in for the utilities layer, which this runner does not compile: a link in a sentence stays underlined (axe link-in-text-block). */
const UTILITY_LAYER = `@layer utilities {
  .underline { text-decoration-line: underline; }
}`

const UtilityLayerDecorator: Decorator = (Story) => (
  <>
    <style>{UTILITY_LAYER}</style>
    <Story />
  </>
)

const meta = {
  title: 'Property/GuestVoice2/Check-in',
  component: CheckInStory,
  decorators: [UtilityLayerDecorator, AuthedRouterDecorator, PageGutterDecorator],
  parameters: {
    theme: 'light',
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktopManager' },
  },
  args: { read: HAMPTON_READ },
} satisfies Meta<typeof CheckInStory>
export default meta
type Story = StoryObj<typeof meta>
const PHONE = { viewport: { defaultViewport: 'mobileStaff' } }
export const HamptonLike: Story = {
  play: async ({ canvas }) => {
    expect(canvas.getByRole('heading', { name: 'Anything urgent?' })).toBeVisible()
    expect(
      canvas.getByRole('heading', { name: 'What should we fix first?' }),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: /Every part of your property/u }),
    )
    expect(
      canvas.getByText(
        'Grouped by how guests feel, with the parts needing attention first. Fewer than six reviews means this part stays unjudged.',
      ),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: '2 more things guests love' }),
    )
    expect(
      canvas.getByRole('button', { name: /Show less.*2 more things guests love/u }),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: /Show less.*2 more things guests love/u }),
    )
    expect(
      canvas.getByRole('button', { name: '2 more things guests love' }),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: '4 other concerns guests raised' }),
    )
    expect(canvas.getByText('Raised once or twice')).toBeVisible()
  },
}
export const Dark: Story = {
  parameters: { theme: 'dark' },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('heading', { name: 'Anything urgent?' })).toBeVisible()
    expect(canvas.getByText('Yes — two serious concerns')).toBeVisible()
    expect(canvas.getByText('Yes, it’s getting better')).toBeVisible()
  },
}
export const Quiet: Story = {
  args: { read: QUIET_READ },
  play: async ({ canvas }) => {
    expect(
      canvas.getByText('No serious concerns reported in the last 12 months'),
    ).toBeVisible()
    expect(canvas.queryByText(/Room — musty smell/u)).toBeNull()
  },
}
const NOT_ENOUGH_TO_SPOT_PATTERNS = 'Not enough reviews to spot patterns yet'
export const Small: Story = {
  args: { read: CHECK_IN_SMALL },
  play: async ({ canvas }) => {
    expect(canvas.getByText(NOT_ENOUGH_TO_SPOT_PATTERNS)).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Invite guests to review' })).toBeVisible()
    expect(
      canvas.queryByRole('heading', { name: 'What should we fix first?' }),
    ).toBeNull()
  },
}
export const SmallWithConcern: Story = {
  args: { read: CHECK_IN_SMALL_CONCERN },
  play: async ({ canvas }) => {
    expect(canvas.getByText('Yes — one serious concern')).toBeVisible()
    expect(canvas.getByText(NOT_ENOUGH_TO_SPOT_PATTERNS)).toBeVisible()
  },
}
export const Provisional: Story = {
  args: { read: CHECK_IN_PROVISIONAL },
  play: async ({ canvas }) => {
    expect(canvas.getByText(/Some reviews are still being analysed/u)).toBeVisible()
    expect(canvas.getByText('Not enough reviews to compare yet')).toBeVisible()
  },
}
export const NoGoal: Story = {
  args: { goal: false },
  play: async ({ canvas }) => {
    expect(canvas.getByText(/Google rating 3\.9/u)).toBeVisible()
    expect(canvas.queryByRole('link', { name: /Your goal/u })).toBeNull()
  },
}
export const NoGoogleSnapshot: Story = {
  args: { google: false },
  play: async ({ canvas }) => {
    expect(canvas.getByRole('link', { name: /Your goal 4\.2/u })).toBeVisible()
    expect(canvas.queryByText(/Google rating/u)).toBeNull()
  },
}
export const SheetOpen: Story = {
  args: {
    initialTarget: { kind: 'issue', issueId: fixtureId('a', 1), sense: 'complaint' },
  },
  play: async () => {
    // The sheet is a lazy chunk and its first load can take longer than the one second
    // `findBy` waits: wait for the chunk itself.
    await import('./guest-voice-issue-drawer')
    const body = within(document.body)
    const sheet = within(await body.findByRole('dialog'))
    expect(sheet.getByText('These guests')).toBeVisible()
    await userEvent.click(
      sheet.getByRole('button', { name: /Linked serious concern · Health risk/u }),
    )
    const concern = within(await body.findByRole('dialog'))
    await userEvent.click(await concern.findByRole('button', { name: /Back to Room/u }))
    expect(
      await within(await body.findByRole('dialog')).findByText('These guests'),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}
/** The sheet is a lazy chunk: wait for it before looking for the dialog. */
const openSheet = async () => {
  await import('./guest-voice-issue-drawer')
  return within(await within(document.body).findByRole('dialog'))
}
export const SheetLoading: Story = {
  args: { ...SheetOpen.args, detailState: 'pending' },
  play: async () => {
    const sheet = await openSheet()
    expect(sheet.getByText('Room — musty smell')).toBeVisible()
    expect(sheet.queryByText('These guests')).toBeNull()
    expect(sheet.queryByRole('button', { name: 'Try again' })).toBeNull()
  },
}
export const SheetError: Story = {
  args: { ...SheetOpen.args, detailState: 'error' },
  play: async () => {
    const sheet = await openSheet()
    expect(sheet.getByText('These review details couldn’t be loaded.')).toBeVisible()
    expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}
export const TopicUnjudged: Story = {
  args: { initialTarget: { kind: 'topic', topic: 'safety' } },
  play: async () => {
    const sheet = await openSheet()
    expect(
      sheet.getByText(/Not enough reviews yet · at least six reviews are needed/u),
    ).toBeVisible()
    expect(sheet.getByText('None mentioned in this period.')).toBeVisible()
  },
}
export const PraiseSheet: Story = {
  args: { initialTarget: { kind: 'issue', issueId: fixtureId('a', 5), sense: 'praise' } },
  play: async () => {
    const sheet = await openSheet()
    expect(sheet.getByText('Team — friendly and helpful')).toBeVisible()
    expect(sheet.getByText('In guests’ own words')).toBeVisible()
    expect(sheet.getByRole('link', { name: 'Open in the Inbox' })).toBeVisible()
  },
}

export const Steady: Story = {
  args: { read: CHECK_IN_STEADY },
  play: async ({ canvas }) => {
    expect(canvas.getByText('About the same')).toBeVisible()
  },
}
export const Slipping: Story = {
  args: { read: CHECK_IN_SLIPPING },
  play: async ({ canvas }) => {
    expect(canvas.getByText('It’s slipping')).toBeVisible()
  },
}
export const InsufficientTrend: Story = {
  args: { read: CHECK_IN_INSUFFICIENT },
  play: async ({ canvas }) => {
    expect(canvas.getByText('Not enough reviews to compare yet')).toBeVisible()
    expect(canvas.queryByText('Yes, it’s getting better')).toBeNull()
  },
}
export const MissingQuote: Story = {
  args: { ...SheetOpen.args, missingQuote: true },
  play: async () => {
    const sheet = await openSheet()
    expect(sheet.getByText(/None of these reviews can be quoted here/u)).toBeVisible()
  },
}
export const LongManagerRename: Story = {
  args: { read: CHECK_IN_RENAMED, renamed: true },
  parameters: PHONE,
  play: async ({ canvas }) => {
    const label = canvas.getAllByText(/a deliberately long manager label/u)[0]!
    expect(label).toBeVisible()
    // The long label wraps inside the screen instead of running past its edge.
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
  },
}

export const MonthKeyboard: Story = {
  parameters: PHONE,
  render: () => (
    <GuestVoiceRatingChart
      months={HAMPTON_READ.ratingTrend.months}
      recentStart={HAMPTON_READ.ratingTrend.recent.startLocalDate}
      tone="positive"
    />
  ),
  play: async ({ canvas }) => {
    const chart = canvas.getByRole('group', { name: /Monthly ratings/u })
    chart.focus()
    await userEvent.keyboard('{Home}{ArrowRight}{End}')
    expect(canvas.getByText(/Oct: 1 review · through Oct 1/u)).toHaveTextContent(
      '5.0 stars',
    )
  },
}
