// The Profile card for timezone and date format (D6). These stories moved
// here from the notification settings page, which no longer holds the fields;
// what they prove is unchanged, save for the card's own loading and failure.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { toast } from 'sonner'
import type { EffectiveNotificationSettings } from '#/contexts/feed/application/public-api'
import type { Action } from '#/components/hooks/use-action'
import { Toaster } from '#/components/ui/sonner'
import { TimezoneAndFormatCard } from './timezone-and-format-card'

/** No quiet hours and no bypass: what a person who never chose either has. */
const OPEN_WINDOW = {
  quietHoursStart: null,
  quietHoursEnd: null,
  urgentBypassEnabled: false,
} as const

const userSettings: EffectiveNotificationSettings = {
  locale: 'en-GB',
  timezone: 'Europe/Sofia',
  timezoneSource: 'user',
  ...OPEN_WINDOW,
}

/** A user who never saved anything: delivery runs on the Organization's zone. */
const organizationSettings: EffectiveNotificationSettings = {
  locale: 'en',
  timezone: 'Europe/Sofia',
  timezoneSource: 'organization',
  ...OPEN_WINDOW,
}

/** `Action` is a callable with mutation state attached; mirror that shape. */
const asAction = <TInput, TOutput>(
  implementation: (input: TInput) => Promise<TOutput>,
): Action<TInput, TOutput> =>
  Object.assign(implementation, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  }) as Action<TInput, TOutput>

const updateUserSettingsMock = fn(async () => userSettings)
const onRetry = fn()

const meta = {
  title: 'Settings/TimezoneAndFormatCard',
  component: TimezoneAndFormatCard,
  parameters: { layout: 'fullscreen' },
  // Sonner's store outlives a story, and a Toaster that mounts replays every
  // toast still showing, so one story's toast would reappear in the next.
  beforeEach: () => {
    toast.dismiss()
    updateUserSettingsMock.mockClear()
    onRetry.mockClear()
  },
  decorators: [
    (Story) => (
      <>
        <div className="max-w-3xl p-4">
          <Story />
        </div>
        <Toaster />
      </>
    ),
  ],
  args: {
    settings: userSettings,
    failed: false,
    retrying: false,
    onRetry,
    organizationName: 'Harbor Hotels',
    updateUserSettings: asAction(updateUserSettingsMock),
  },
} satisfies Meta<typeof TimezoneAndFormatCard>

export default meta
type Story = StoryObj<typeof meta>

type Canvas = ReturnType<typeof within>

/** Picks a "Date and time format" option; the list opens outside the canvas. */
async function pickFormat(canvas: Canvas, option: string) {
  await userEvent.click(canvas.getByRole('combobox', { name: 'Date and time format' }))
  await userEvent.click(
    await within(document.body).findByRole('option', { name: option }),
  )
}

/** Saves the card and expects exactly `data` to have been sent, once. */
async function expectFormattingSaved(
  canvas: Canvas,
  data: Readonly<{ locale?: string; timezone?: string }>,
) {
  await userEvent.click(canvas.getByRole('button', { name: 'Save timezone and format' }))
  await waitFor(() => expect(updateUserSettingsMock).toHaveBeenCalledOnce())
  expect(updateUserSettingsMock).toHaveBeenCalledWith({ data })
}

export const SavesAPickedTimezone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const portal = within(document.body)
    // A picker, not free text: a hotel manager should not need to know IANA
    // names, and a typed fixed offset ignored daylight saving.
    await userEvent.click(canvas.getByRole('combobox', { name: 'Timezone' }))
    await userEvent.type(
      portal.getByPlaceholderText('Search a city, region or UTC offset'),
      'Berlin',
    )
    await userEvent.click(await portal.findByRole('option', { name: /Berlin/ }))
    // Only the changed setting travels: the untouched format is not re-sent.
    await expectFormattingSaved(canvas, { timezone: 'Europe/Berlin' })
    await within(document.body).findByText('Timezone and date format saved')
  },
}

export const SeedsFromTheServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Render source is the query result, not a stale local mirror.
    expect(
      canvas.getByRole('combobox', { name: 'Date and time format' }),
    ).toHaveTextContent('English (UK)')
    expect(canvas.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent(
      /Sofia \(UTC\+[23]\)/,
    )
  },
}

export const NewUserSeesTheOrganizationTimezone: Story = {
  args: { settings: organizationSettings },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Quiet hours and the digest already run on the Organization's zone, so
    // that is what the card shows — never a UTC placeholder.
    expect(canvas.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent(
      /Sofia \(UTC\+[23]\)/,
    )
    expect(canvas.getByTestId('timezone-source')).toHaveTextContent(
      "Your organization's timezone",
    )
  },
}

export const SavingTheLocaleKeepsTheOrganizationTimezone: Story = {
  args: { settings: organizationSettings },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Nothing differs from what is in effect yet.
    expect(
      canvas.getByRole('button', { name: 'Save timezone and format' }),
    ).toBeDisabled()
    await pickFormat(canvas, 'English (UK)')
    // The timezone is not sent, so the save cannot pin anything over it.
    await expectFormattingSaved(canvas, { locale: 'en-GB' })
  },
}

export const KeepsALegacyTimezoneTheListNoLongerOffers: Story = {
  args: {
    settings: {
      locale: 'de-DE',
      timezone: '+03:00',
      timezoneSource: 'user',
      ...OPEN_WINDOW,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A free-text value saved before the pickers still shows as itself, not
    // as an empty "Choose a timezone" that hides what delivery is using.
    expect(canvas.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent('+03:00')
    expect(
      canvas.getByRole('combobox', { name: 'Date and time format' }),
    ).toHaveTextContent('de-DE')
    await pickFormat(canvas, 'English (US)')
    await expectFormattingSaved(canvas, { locale: 'en' })
  },
}

/**
 * The card used to be called "Language and timezone" while every word in the
 * product is English (docs/BETA.md); it only ever changed how a date is
 * written. On Profile it also names the Organization it sets them for: the row
 * is per membership.
 */
export const IsNamedForWhatItDoes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Timezone and date format')).toBeVisible()
    expect(canvas.queryByText(/Language and timezone/)).toBeNull()
    expect(canvas.getByText(/at every property in Harbor Hotels/)).toBeVisible()

    await userEvent.click(canvas.getByRole('combobox', { name: 'Date and time format' }))
    const portal = within(document.body)
    const options = await portal.findAllByRole('option')
    // English conventions only — a language nobody is offered is not a choice.
    expect(options.map((option) => option.textContent)).toEqual([
      'English (US)',
      'English (UK)',
    ])
    // And the control says what it changes, which its names do not.
    expect(canvas.getByTestId('format-sample')).toHaveTextContent('23/09/2026')
  },
}

/** While the read is on its way, the card says it is loading. */
export const Loading: Story = {
  args: { settings: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('status')).toHaveTextContent(
      'Loading your timezone and date format…',
    )
    expect(canvas.queryByRole('combobox', { name: 'Timezone' })).toBeNull()
  },
}

/** A failed read says so and can be tried again; it never hides the card. */
export const LoadFailedCanBeRetried: Story = {
  args: { settings: undefined, failed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent(
      'Your timezone and date format couldn’t be loaded.',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  },
}

/** A read that failed; Try again reads again, as the query does. */
function RetryingCard() {
  const [retrying, setRetrying] = useState(false)
  return (
    <TimezoneAndFormatCard
      settings={undefined}
      failed
      retrying={retrying}
      onRetry={() => {
        onRetry()
        setRetrying(true)
      }}
      organizationName="Harbor Hotels"
      updateUserSettings={asAction(updateUserSettingsMock)}
    />
  )
}

/**
 * The retry keeps the alert, its button busy, until the read answers: the
 * loading state in its place used to drop focus onto <body>.
 */
export const RetryKeepsFocusOnTheButton: Story = {
  render: () => <RetryingCard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))

    // The accessible name stays "Try again"; the visible words change.
    const busy = canvas.getByRole('button', { name: 'Try again' })
    await waitFor(() => expect(busy).toHaveAttribute('aria-busy', 'true'))
    expect(busy).toHaveTextContent('Trying again…')
    expect(busy).toHaveFocus()
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(canvas.getByRole('alert')).toBeInTheDocument()
    expect(onRetry).toHaveBeenCalledOnce()
  },
}
