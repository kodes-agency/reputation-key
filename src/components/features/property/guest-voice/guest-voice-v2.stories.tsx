import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PageGutterDecorator } from '../../../../../.storybook/PageGutterDecorator'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type {
  GuestVoiceDetailTarget,
  GuestVoiceV2Read,
} from '#/contexts/ai/application/public-api'
import { PropertyGuestVoicePage } from '../property-guest-voice-page'
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
const meta = {
  title: 'Property/GuestVoice2/Check-in',
  component: CheckInStory,
  decorators: [AuthedRouterDecorator, PageGutterDecorator],
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
export const HamptonLikePhone: Story = { parameters: PHONE }
export const Dark: Story = { parameters: { theme: 'dark' } }
export const DarkPhone: Story = { parameters: { ...PHONE, theme: 'dark' } }
export const Quiet: Story = { args: { read: QUIET_READ } }
export const Small: Story = { args: { read: CHECK_IN_SMALL } }
export const SmallPhone: Story = { args: { read: CHECK_IN_SMALL }, parameters: PHONE }
export const SmallWithConcern: Story = { args: { read: CHECK_IN_SMALL_CONCERN } }
export const SmallWithConcernPhone: Story = {
  args: { read: CHECK_IN_SMALL_CONCERN },
  parameters: PHONE,
}
export const Provisional: Story = { args: { read: CHECK_IN_PROVISIONAL } }
export const NoGoal: Story = { args: { goal: false } }
export const NoGoogleSnapshot: Story = { args: { google: false } }
export const SheetOpen: Story = {
  args: {
    initialTarget: { kind: 'issue', issueId: fixtureId('a', 1), sense: 'complaint' },
  },
  play: async () => {
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
export const SheetPhone: Story = { args: SheetOpen.args, parameters: PHONE }
export const SheetLoading: Story = { args: { ...SheetOpen.args, detailState: 'pending' } }
export const SheetError: Story = { args: { ...SheetOpen.args, detailState: 'error' } }
export const TopicUnjudged: Story = {
  args: { initialTarget: { kind: 'topic', topic: 'safety' } },
}
export const PraiseSheet: Story = {
  args: { initialTarget: { kind: 'issue', issueId: fixtureId('a', 5), sense: 'praise' } },
}

export const Steady: Story = { args: { read: CHECK_IN_STEADY } }
export const Slipping: Story = { args: { read: CHECK_IN_SLIPPING } }
export const InsufficientTrend: Story = { args: { read: CHECK_IN_INSUFFICIENT } }
export const MissingQuote: Story = { args: { ...SheetOpen.args, missingQuote: true } }
export const LongManagerRename: Story = {
  args: { read: CHECK_IN_RENAMED, renamed: true },
  parameters: PHONE,
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
