import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  EffectiveNotificationSettings,
  NotificationPreference,
  NotificationPropertyDeliveryWindow,
} from '#/contexts/feed/application/public-api'
import type { Action } from '#/components/hooks/use-action'
import { NotificationsSettingsPage } from './notifications-settings-page'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY_ID = '10000000-0000-4000-8000-000000000002'

const properties = [
  { id: PROPERTY_ID, name: 'Harbor & Pine — a deliberately long name for narrow shells' },
  { id: OTHER_PROPERTY_ID, name: 'Second Property' },
]

const preference = (
  overrides: Partial<NotificationPreference> & Pick<NotificationPreference, 'category'>,
): NotificationPreference =>
  ({
    id: `pref-${overrides.category}-${overrides.channel ?? 'email'}`,
    userId: 'user-story',
    organizationId: 'org-story',
    propertyId: PROPERTY_ID,
    channel: 'email',
    enabled: true,
    cadence: 'daily',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }) as unknown as NotificationPreference

const preferences: readonly NotificationPreference[] = [
  preference({ category: 'workflow_collaboration', channel: 'in_app', enabled: true }),
  preference({ category: 'workflow_collaboration', channel: 'email', enabled: false }),
  preference({ category: 'recognition', channel: 'email', cadence: 'daily' }),
]

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

type PreferenceInput = Readonly<{
  data: Readonly<{
    propertyId: string
    category: NotificationPreference['category']
    channel: NotificationPreference['channel']
    enabled: boolean
    cadence: NotificationPreference['cadence']
    applyToAllProperties?: boolean
  }>
}>

type QuietHoursInput = Readonly<{
  data: Readonly<{
    propertyId?: string
    follow?: boolean
    quietHoursStart?: string | null
    quietHoursEnd?: string | null
    urgentBypassEnabled?: boolean
  }>
}>

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

const updatePreferenceMock = fn(async (input: PreferenceInput) =>
  preference({ category: input.data.category, channel: input.data.channel }),
)
const updateUserSettingsMock = fn(async () => userSettings)
const updateQuietHoursMock = fn(async (_input: QuietHoursInput) => userSettings)
const updatePreference = asAction(updatePreferenceMock)
const updateUserSettings = asAction(updateUserSettingsMock)
const updateQuietHours = asAction(updateQuietHoursMock)

const setPropertyId = fn()
const retryEmailAvailability = fn()

const meta = {
  title: 'Settings/NotificationsSettingsPage',
  component: NotificationsSettingsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    properties,
    preferences,
    categoryDefaults: [],
    propertyWindows: [],
    userSettings,
    propertyId: PROPERTY_ID,
    emailAvailability: 'allowed',
    retryEmailAvailability,
    setPropertyId,
    updatePreference,
    updateUserSettings,
    updateQuietHours,
  },
} satisfies Meta<typeof NotificationsSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const EmailAllowed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // No "unavailable" notice, and the email controls are operable.
    expect(canvas.queryByTestId('email-unavailable-notice')).toBeNull()
    const emailSwitch = canvas.getByRole('switch', {
      name: 'Workflow and collaboration: Email',
    })
    expect(emailSwitch).toBeEnabled()
  },
}

/**
 * Goal results are live notices, so they get a row like any other optional
 * category: in-app on by default, email opt-in (ADR 0046). They used to sit in
 * a hidden `recognition` category nobody could mute or email.
 */
export const GoalsAreConfigurable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: 'Goals' })
    const fieldset = heading.closest('fieldset')
    if (!fieldset) throw new Error('goal notification fieldset is missing')
    const row = within(fieldset)
    expect(row.getByText('Goal results for your properties.')).toBeInTheDocument()
    expect(
      row.getByLabelText('In-app', { selector: '#recognition-in_app' }),
    ).toBeEnabled()
    expect(row.getByLabelText('Email', { selector: '#recognition-email' })).toBeEnabled()
    expect(canvas.queryByText(/past awards/i)).toBeNull()
  },
}

/**
 * One Goal Program over up to 250 Portals closes its results in the same hour,
 * so goal email is a daily digest only (ADR 0046, amended 2026-09-22). A row
 * saved before that may still say immediate; saving must not send it back.
 */
export const GoalEmailIsDailyOnly: Story = {
  args: {
    preferences: [
      ...preferences.filter((item) => item.category !== 'recognition'),
      preference({
        category: 'recognition',
        channel: 'email',
        enabled: false,
        cadence: 'immediate',
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    const canvas = within(canvasElement)
    const goalCadence = canvas.getByLabelText('Cadence', {
      selector: '#recognition-cadence',
    })
    expect(goalCadence).toHaveTextContent('Daily at 08:00')
    expect(goalCadence).toBeDisabled()
    // A category whose email is on still offers the choice. (Workflow's email
    // is off in these fixtures, and cadence waits until email is on.)
    expect(
      canvas.getByLabelText('Cadence', { selector: '#urgent_operational-cadence' }),
    ).toBeEnabled()

    await userEvent.click(
      canvas.getByLabelText('Email', { selector: '#recognition-email' }),
    )
    await waitFor(() => expect(updatePreferenceMock).toHaveBeenCalledOnce())
    expect(updatePreferenceMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'recognition',
        channel: 'email',
        enabled: true,
        cadence: 'daily',
      }),
    })
  },
}

export const TitleColumnKeepsItsWidth: Story = {
  play: async ({ canvasElement }) => {
    const fieldset = canvasElement.querySelector('fieldset')
    const heading = fieldset?.querySelector('[role="heading"]')
    const description = fieldset?.querySelector('p')
    if (!(heading instanceof HTMLElement) || !(description instanceof HTMLElement)) {
      throw new Error('category row is missing its heading or description')
    }
    // A regression I shipped: the controls row spanned only columns 2-3, so it
    // sized both `auto` tracks to the full fieldset width and left `1fr` at
    // ZERO. "Account and safety" then wrapped one character per line — 0px wide
    // and 72px tall. The earlier assertions all still passed, because state and
    // alignment were both fine; nothing measured whether the column had usable
    // width. This does.
    expect(heading.getBoundingClientRect().width).toBeGreaterThan(150)
    expect(description.getBoundingClientRect().width).toBeGreaterThan(150)
    // Single line, not a vertical character stack.
    expect(heading.getBoundingClientRect().height).toBeLessThan(40)
  },
}

export const EmailUnavailableForProperty: Story = {
  args: { emailAvailability: 'unavailable' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The defect this story exists for: the whole Email column used to render
    // fully enabled for a property without `notification.send_email`, and every
    // write failed with a generic toast. It must now say so and be inert.
    expect(canvas.getByTestId('email-unavailable-notice')).toBeInTheDocument()
    expect(
      canvas.getByRole('switch', { name: 'Workflow and collaboration: Email' }),
    ).toBeDisabled()
    expect(canvas.getByRole('switch', { name: 'Goals: Email' })).toBeDisabled()
    // In-app is a separate capability and stays operable.
    expect(
      canvas.getByRole('switch', { name: 'Workflow and collaboration: In-app' }),
    ).toBeEnabled()
  },
}

export const MandatoryCategoryIsOrganizationPolicy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Mandatory account notices are Organization policy, not a Property
    // preference with disabled controls that imply it could later be changed.
    expect(canvas.queryByRole('heading', { name: 'Account and safety' })).toBeNull()
    expect(canvas.queryByRole('switch', { name: /^Account and safety/ })).toBeNull()
  },
}

export const ActionNeededKeepsInAppOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const locked = canvas.getByRole('switch', { name: 'Action needed: In-app' })
    expect(locked).toBeDisabled()
    // A dimmed switch alone does not say why it cannot be turned off.
    expect(canvas.getByText('Always on')).toBeVisible()
    expect(locked).toHaveAccessibleDescription(/Always on/)
    expect(canvas.getByRole('switch', { name: 'Action needed: Email' })).toBeEnabled()
  },
}

export const EveryControlNamesItsCategory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Both rows used to announce the same "In-app", "Email" and "Cadence", so
    // a screen-reader user tabbing through could not tell which category they
    // were changing.
    for (const category of ['Action needed', 'Workflow and collaboration']) {
      expect(canvas.getByRole('group', { name: category })).toBeInTheDocument()
      expect(
        canvas.getByRole('switch', { name: `${category}: In-app` }),
      ).toBeInTheDocument()
      expect(
        canvas.getByRole('switch', { name: `${category}: Email` }),
      ).toBeInTheDocument()
      expect(
        canvas.getByRole('combobox', { name: `${category}: Cadence` }),
      ).toBeInTheDocument()
      expect(
        canvas.getByRole('button', { name: `${category}: Apply to all my properties` }),
      ).toBeInTheDocument()
    }
    // Quiet hours are the person's one setting now, so they are named once,
    // not once per category (ADR 0046, amended 2026-09-23).
    expect(canvas.getAllByLabelText(/Quiet from/)).toHaveLength(1)
    expect(canvas.queryByLabelText(/Action needed: Quiet from/)).toBeNull()
  },
}

type Canvas = ReturnType<typeof within>

/** Picks a "Date and time format" option; the list opens outside the canvas. */
async function pickFormat(canvas: Canvas, option: string) {
  await userEvent.click(canvas.getByRole('combobox', { name: 'Date and time format' }))
  await userEvent.click(
    await within(document.body).findByRole('option', { name: option }),
  )
}

/** Saves the formatting form and expects exactly `data` to have been sent, once. */
async function expectFormattingSaved(
  canvas: Canvas,
  data: Readonly<{ locale?: string; timezone?: string }>,
) {
  await userEvent.click(canvas.getByRole('button', { name: 'Save formatting' }))
  await waitFor(() => expect(updateUserSettingsMock).toHaveBeenCalledOnce())
  expect(updateUserSettingsMock).toHaveBeenCalledWith({ data })
}

export const FormattingSavesAPickedTimezone: Story = {
  play: async ({ canvasElement }) => {
    updateUserSettingsMock.mockClear()
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
  },
}

export const SeedsFormattingFromTheServer: Story = {
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
  args: { userSettings: organizationSettings },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Quiet hours and the digest already run on the Organization's zone, so
    // that is what the page shows — never a UTC placeholder.
    expect(canvas.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent(
      /Sofia \(UTC\+[23]\)/,
    )
    expect(canvas.getByTestId('timezone-source')).toHaveTextContent(
      "Your organization's timezone",
    )
    // Said once, where quiet hours are set, instead of once per category row.
    expect(
      canvas.getAllByText(/on your own clock \(Sofia/, { exact: false }),
    ).toHaveLength(1)
    expect(canvas.queryByText(/property-local/)).toBeNull()
  },
}

export const SavingTheLocaleKeepsTheOrganizationTimezone: Story = {
  args: { userSettings: organizationSettings },
  play: async ({ canvasElement }) => {
    updateUserSettingsMock.mockClear()
    const canvas = within(canvasElement)
    // Nothing differs from what is in effect yet.
    expect(canvas.getByRole('button', { name: 'Save formatting' })).toBeDisabled()
    await pickFormat(canvas, 'English (UK)')
    // The timezone is not sent, so the save cannot pin anything over it.
    await expectFormattingSaved(canvas, { locale: 'en-GB' })
  },
}

export const KeepsALegacyTimezoneTheListNoLongerOffers: Story = {
  args: {
    userSettings: {
      locale: 'de-DE',
      timezone: '+03:00',
      timezoneSource: 'user',
      ...OPEN_WINDOW,
    },
  },
  play: async ({ canvasElement }) => {
    updateUserSettingsMock.mockClear()
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
 * One window, saved once, for every property. It used to live on every
 * (property, category, channel) row: about sixty saves to stop 03:00 email for
 * a manager with thirty properties, and a window set on some properties only
 * split the one daily digest in two.
 */
export const PersonalQuietHoursCoverEveryProperty: Story = {
  play: async ({ canvasElement }) => {
    updateQuietHoursMock.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Your quiet hours: Quiet from'), '22:00')
    await userEvent.type(
      canvas.getByLabelText('Your quiet hours: quiet hours until'),
      '07:00',
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Save quiet hours for Your quiet hours' }),
    )

    await waitFor(() => expect(updateQuietHoursMock).toHaveBeenCalledOnce())
    // No propertyId: this is the person's answer everywhere.
    expect(updateQuietHoursMock).toHaveBeenCalledWith({
      data: {
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        urgentBypassEnabled: false,
      },
    })
  },
}

export const QuietHoursNeedTwoDifferentTimes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Your quiet hours: Quiet from'), '22:00')
    await userEvent.type(
      canvas.getByLabelText('Your quiet hours: quiet hours until'),
      '22:00',
    )
    // Delivery reads equal times as no quiet hours at all.
    expect(
      canvas.getByRole('button', { name: 'Save quiet hours for Your quiet hours' }),
    ).toBeDisabled()
    expect(canvas.getByText('Choose different start and end times.')).toBeVisible()
  },
}

const override: NotificationPropertyDeliveryWindow = {
  propertyId: PROPERTY_ID,
  userId: 'user-story',
  organizationId: 'org-story',
  quietHoursStart: '00:00',
  quietHoursEnd: '06:00',
  urgentBypassEnabled: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} as unknown as NotificationPropertyDeliveryWindow

export const OnePropertyCanOverrideTheWindow: Story = {
  args: {
    userSettings: { ...userSettings, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    propertyWindows: [override],
  },
  play: async ({ canvasElement }) => {
    updateQuietHoursMock.mockClear()
    const canvas = within(canvasElement)
    const property = properties[0]!.name
    // The override is shown as this property's own answer, not as the
    // person's window with a footnote.
    expect(canvas.getByLabelText(`${property}: Quiet from`)).toHaveValue('00:00')

    await userEvent.click(
      canvas.getByRole('button', { name: 'Follow my quiet hours here' }),
    )

    await waitFor(() => expect(updateQuietHoursMock).toHaveBeenCalledOnce())
    expect(updateQuietHoursMock).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, follow: true },
    })
  },
}

/**
 * The gap this closes: a Property added or reassigned after the person
 * configured everything else had no row at all and fell through to the
 * versioned defaults — urgent email, immediately, at 03:00.
 */
export const AppliesACategoryToEveryProperty: Story = {
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', {
      name: 'Workflow and collaboration: Apply to all my properties',
    })
    // The button says what every other property will get, so it is not a leap.
    expect(button).toHaveAccessibleDescription(
      'A new property gets in-app on, email off.',
    )

    await userEvent.click(button)

    await waitFor(() => expect(updatePreferenceMock).toHaveBeenCalledTimes(2))
    expect(updatePreferenceMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'workflow_collaboration',
        channel: 'email',
        applyToAllProperties: true,
      }),
    })
  },
}

/** A property with no row of its own shows what it inherits, not a blank. */
export const InheritedDefaultIsWhatANewPropertyGets: Story = {
  args: {
    categoryDefaults: [
      {
        userId: 'user-story',
        organizationId: 'org-story',
        category: 'workflow_collaboration',
        channel: 'email',
        enabled: true,
        cadence: 'daily',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ] as never,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', {
        name: 'Workflow and collaboration: Apply to all my properties',
      }),
    ).toHaveAccessibleDescription('A new property gets in-app on, email daily at 08:00.')
  },
}

/**
 * The card used to be called "Language and timezone" while every word in the
 * product is English (docs/BETA.md); it only ever changed how a date is
 * written.
 */
export const TimezoneCardIsNamedForWhatItDoes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Timezone and date format')).toBeVisible()
    expect(canvas.queryByText(/Language and timezone/)).toBeNull()

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

/** Each save waits until the play function releases it, like a slow network. */
const releaseSaves: Array<() => void> = []
const slowUpdatePreferenceMock = fn(
  (input: PreferenceInput) =>
    new Promise<NotificationPreference>((resolve) => {
      releaseSaves.push(() =>
        resolve(
          preference({ category: input.data.category, channel: input.data.channel }),
        ),
      )
    }),
)

export const RapidChangesBuildOnEachOther: Story = {
  args: { updatePreference: asAction(slowUpdatePreferenceMock) },
  play: async ({ canvasElement }) => {
    slowUpdatePreferenceMock.mockClear()
    releaseSaves.length = 0
    const canvas = within(canvasElement)
    const email = canvas.getByRole('switch', {
      name: 'Workflow and collaboration: Email',
    })
    await userEvent.click(email)
    // The switch answers at once instead of after the round trip.
    expect(email).toBeChecked()
    await userEvent.click(
      canvas.getByRole('combobox', { name: 'Workflow and collaboration: Cadence' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'Immediate' }),
    )
    // One request per row at a time, so the second cannot land first.
    expect(slowUpdatePreferenceMock).toHaveBeenCalledOnce()
    releaseSaves[0]!()
    await waitFor(() => expect(slowUpdatePreferenceMock).toHaveBeenCalledTimes(2))
    // Built on the first request, not on the stale snapshot: turning Email on
    // survives choosing Immediate.
    expect(slowUpdatePreferenceMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        category: 'workflow_collaboration',
        channel: 'email',
        enabled: true,
        cadence: 'immediate',
      }),
    })
    releaseSaves[1]!()
  },
}

export const EmailTimingWaitsForEmail: Story = {
  // Held open so the row keeps showing the requested state, as it does in the
  // app until the refetch lands; the static fixture never reflects a save.
  args: { updatePreference: asAction(slowUpdatePreferenceMock) },
  play: async ({ canvasElement }) => {
    slowUpdatePreferenceMock.mockClear()
    releaseSaves.length = 0
    const canvas = within(canvasElement)
    // Workflow email is off: its cadence cannot take effect, so it is not
    // offered as if it could.
    const cadence = canvas.getByRole('combobox', {
      name: 'Workflow and collaboration: Cadence',
    })
    expect(cadence).toBeDisabled()
    expect(
      within(canvas.getByRole('group', { name: 'Workflow and collaboration' })).getByText(
        'Turn on email to choose when it arrives.',
      ),
    ).toBeVisible()
    // Action needed email is on by default, so its timing stays editable.
    expect(canvas.getByRole('combobox', { name: 'Action needed: Cadence' })).toBeEnabled()
    await userEvent.click(
      canvas.getByRole('switch', { name: 'Workflow and collaboration: Email' }),
    )
    expect(cadence).toBeEnabled()
    releaseSaves[0]!()
  },
}

export const ChecksEmailAvailabilityFirst: Story = {
  args: { emailAvailability: 'checking' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // An in-flight check is not a "no": saying email is not enabled here was
    // wrong for every property that does allow it.
    expect(
      canvas.getByText('Checking whether email is available for this property…'),
    ).toBeVisible()
    expect(canvas.queryByTestId('email-unavailable-notice')).toBeNull()
    expect(canvas.getByRole('switch', { name: 'Action needed: Email' })).toBeDisabled()
  },
}

export const EmailAvailabilityCheckFailed: Story = {
  args: { emailAvailability: 'unknown' },
  play: async ({ canvasElement }) => {
    retryEmailAvailability.mockClear()
    const canvas = within(canvasElement)
    expect(
      canvas.getByText("Couldn't check whether email is available for this property.", {
        exact: false,
      }),
    ).toBeVisible()
    expect(canvas.queryByTestId('email-unavailable-notice')).toBeNull()
    expect(canvas.getByRole('switch', { name: 'Action needed: Email' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Check again' }))
    expect(retryEmailAvailability).toHaveBeenCalledOnce()
  },
}
