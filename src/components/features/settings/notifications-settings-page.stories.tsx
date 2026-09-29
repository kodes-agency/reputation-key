import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { toast } from 'sonner'
import type {
  EffectiveNotificationSettings,
  NotificationPreference,
  NotificationPropertyDeliveryWindow,
} from '#/contexts/feed/application/public-api'
import type { Action } from '#/components/hooks/use-action'
import { Toaster } from '#/components/ui/sonner'
import { NotificationsSettingsPage } from './notifications-settings-page'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY_ID = '10000000-0000-4000-8000-000000000002'
const THIRD_PROPERTY_ID = '10000000-0000-4000-8000-000000000003'

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

/** One Property's own settings for a category, removed so it follows the default. */
type ResetInput = Readonly<{
  data: Readonly<{ propertyId: string; category: NotificationPreference['category'] }>
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
const resetPropertyCategoryMock = fn(async (_input: ResetInput): Promise<void> => {})
const updateUserSettingsMock = fn(async () => userSettings)
const updateQuietHoursMock = fn(async (_input: QuietHoursInput) => userSettings)
const updatePreference = asAction(updatePreferenceMock)
const resetPropertyCategory = asAction(resetPropertyCategoryMock)
const updateUserSettings = asAction(updateUserSettingsMock)
const updateQuietHours = asAction(updateQuietHoursMock)

const setPropertyId = fn()
const retryEmailAvailability = fn()

const meta = {
  title: 'Settings/NotificationsSettingsPage',
  component: NotificationsSettingsPage,
  parameters: { layout: 'fullscreen' },
  // Sonner's store outlives a story, and a Toaster that mounts replays every
  // toast still showing, so one story's toast would reappear in the next.
  beforeEach: () => {
    toast.dismiss()
  },
  decorators: [
    (Story) => (
      <>
        <div className="max-w-3xl p-4">
          <Story />
        </div>
        {/* The app's toaster: what a default or a reset did must be seen. */}
        <Toaster />
      </>
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
    resetPropertyCategory,
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
    // Dimmed for a reason it states, and no promise of a choice email would
    // not bring.
    expect(goalCadence).toHaveAccessibleDescription('Always emailed daily at 08:00.')
    expect(
      within(canvas.getByRole('group', { name: 'Goals' })).queryByText(
        'Turn on email to choose when it arrives.',
      ),
    ).toBeNull()
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
    expect(canvas.queryByRole('heading', { name: 'Account and security' })).toBeNull()
    expect(canvas.queryByRole('switch', { name: /^Account and security/ })).toBeNull()
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
        canvas.getByRole('button', { name: `${category}: Make this my default` }),
      ).toBeInTheDocument()
    }
    // Workflow has a setting of its own at this property, and the button that
    // ends it names its category too.
    expect(
      canvas.getByRole('button', {
        name: 'Workflow and collaboration: Use my default here',
      }),
    ).toBeInTheDocument()
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
 * Picking another Property shows that Property's own answer. The card used to
 * keep the first Property's mode, so a Property whose override sends email at
 * any hour read "Follows your quiet hours", and saving the bypass on a
 * Property without one stored an override that ended quiet hours there.
 */
export const SwitchingPropertyShowsItsOwnOverride: Story = {
  args: {
    userSettings: { ...userSettings, quietHoursStart: '22:00', quietHoursEnd: '07:00' },
    propertyWindows: [
      {
        ...override,
        propertyId: OTHER_PROPERTY_ID,
        quietHoursStart: null,
        quietHoursEnd: null,
      } as unknown as NotificationPropertyDeliveryWindow,
    ],
  },
  render: function SwitchingProperty(args) {
    const [propertyId, setPropertyId] = useState(args.propertyId)
    return (
      <NotificationsSettingsPage
        {...args}
        propertyId={propertyId}
        setPropertyId={setPropertyId}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Use different hours here' })).toBeVisible()

    await userEvent.click(canvas.getByRole('combobox', { name: /^Property:/ }))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'Second Property' }),
    )

    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: 'Follow my quiet hours here' }),
      ).toBeVisible(),
    )
    expect(canvas.queryByText(/Follows your quiet hours/)).toBeNull()
  },
}

/** The toast carrying `message`, once it has entered (sonner animates it in). */
async function expectToast(message: string): Promise<void> {
  const text = await within(document.body).findByText(message)
  await waitFor(() => expect(text).toBeVisible())
}

const expectNoDialog = () =>
  waitFor(() => expect(within(document.body).queryByRole('alertdialog')).toBeNull())

const MAKE_WORKFLOW_DEFAULT = 'Workflow and collaboration: Make this my default'
const DEFAULT_SAVED = 'Now your default for every property without its own setting'

/**
 * Both of Workflow's channels saved as the person's default, in-app first,
 * each with the answer this property shows: in-app on, email off.
 */
function expectWorkflowSavedAsDefault() {
  expect(updatePreferenceMock).toHaveBeenCalledTimes(2)
  expect(updatePreferenceMock).toHaveBeenNthCalledWith(1, {
    data: expect.objectContaining({
      propertyId: PROPERTY_ID,
      category: 'workflow_collaboration',
      channel: 'in_app',
      enabled: true,
      applyToAllProperties: true,
    }),
  })
  expect(updatePreferenceMock).toHaveBeenNthCalledWith(2, {
    data: expect.objectContaining({
      propertyId: PROPERTY_ID,
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: false,
      applyToAllProperties: true,
    }),
  })
}

/**
 * The gap this closes: a Property added or reassigned after the person
 * configured everything else had no row at all and fell through to the
 * versioned defaults — urgent email, immediately, at 03:00. The answer here
 * becomes the person's default, both channels, and nothing is asked. No other
 * property has a setting of its own, so there is nothing to reset either.
 */
export const MakesACategoryMyDefault: Story = {
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    resetPropertyCategoryMock.mockClear()
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: MAKE_WORKFLOW_DEFAULT })
    // It says what a property without its own setting gets, so it is not a leap.
    expect(button).toHaveAccessibleDescription(
      'A new property gets in-app on, email off.',
    )
    expect(
      canvas.queryByRole('button', { name: /^Workflow and collaboration: Reset / }),
    ).toBeNull()

    await userEvent.click(button)
    expect(within(document.body).queryByRole('alertdialog')).toBeNull()
    await expectToast(DEFAULT_SAVED)
    expectWorkflowSavedAsDefault()
    expect(resetPropertyCategoryMock).not.toHaveBeenCalled()
  },
}

/**
 * With one property there is nobody else to apply it to, but the default is
 * still what the next property gets. The button used to be dimmed here.
 */
export const OnePropertyCanStillMakeADefault: Story = {
  args: { properties: properties.slice(0, 1) },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    const button = within(canvasElement).getByRole('button', {
      name: MAKE_WORKFLOW_DEFAULT,
    })
    expect(button).toBeEnabled()

    await userEvent.click(button)
    await expectToast(DEFAULT_SAVED)
    expectWorkflowSavedAsDefault()
  },
}

/** A row `propertyId` has of its own, which a default leaves alone (D7). */
const preferenceAt = (
  propertyId: string,
  overrides: Partial<NotificationPreference> & Pick<NotificationPreference, 'category'>,
): NotificationPreference =>
  ({
    ...preference(overrides),
    id: `pref-${propertyId}-${overrides.category}-${overrides.channel ?? 'email'}`,
    propertyId,
  }) as unknown as NotificationPreference

/** Workflow in-app switched off at Second Property, as a mute from the bell leaves it. */
const mutedAtSecondProperty: readonly NotificationPreference[] = [
  ...preferences,
  preferenceAt(OTHER_PROPERTY_ID, {
    category: 'workflow_collaboration',
    channel: 'in_app',
    enabled: false,
  }),
]

/**
 * D7: exceptions stay when a default changes. Making a default used to replace
 * every other property's own setting, a mute from the bell included; now it
 * leaves them as they are, says which, and asks nothing.
 */
export const MakingADefaultKeepsAMute: Story = {
  args: { preferences: mutedAtSecondProperty },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    resetPropertyCategoryMock.mockClear()
    const button = within(canvasElement).getByRole('button', {
      name: MAKE_WORKFLOW_DEFAULT,
    })
    expect(button).toHaveAccessibleDescription(
      'A new property gets in-app on, email off. Second Property keeps its own setting, including a mute from the notification bell.',
    )

    await userEvent.click(button)
    expect(within(document.body).queryByRole('alertdialog')).toBeNull()
    await expectToast(DEFAULT_SAVED)
    expectWorkflowSavedAsDefault()
    expect(resetPropertyCategoryMock).not.toHaveBeenCalled()
  },
}

/**
 * Ending another property's own setting is a choice of its own, and it asks
 * first: the question names the property and the mute it would undo. Keeping
 * them changes nothing.
 */
export const ResettingAMuteAsksFirst: Story = {
  args: { preferences: mutedAtSecondProperty },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    resetPropertyCategoryMock.mockClear()
    const reset = within(canvasElement).getByRole('button', {
      name: 'Workflow and collaboration: Reset it to my default',
    })
    expect(reset).toHaveTextContent('Reset it to my default')

    await userEvent.click(reset)
    const dialog = await within(document.body).findByRole('alertdialog', {
      name: 'Reset 1 property to your default?',
    })
    expect(dialog).toHaveAccessibleDescription(
      'Second Property loses its own workflow and collaboration settings, including a mute from the notification bell, and follows your default instead.',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep them' }))
    await expectNoDialog()
    expect(resetPropertyCategoryMock).not.toHaveBeenCalled()
    expect(updatePreferenceMock).not.toHaveBeenCalled()
  },
}

const threeProperties = [...properties, { id: THIRD_PROPERTY_ID, name: 'Lakeside Lodge' }]

/** Workflow email set differently at Second Property and Lakeside Lodge; neither is a mute. */
const setAtTwoOtherProperties: readonly NotificationPreference[] = [
  ...preferences,
  preferenceAt(OTHER_PROPERTY_ID, {
    category: 'workflow_collaboration',
    channel: 'email',
  }),
  preferenceAt(THIRD_PROPERTY_ID, {
    category: 'workflow_collaboration',
    channel: 'email',
    cadence: 'immediate',
  }),
]

const RESET_BOTH_OTHERS = 'Workflow and collaboration: Reset them to my default'

/** Presses Workflow's reset and returns the question it asks about both. */
async function askToResetBothOthers(canvasElement: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: RESET_BOTH_OTHERS }),
  )
  return within(document.body).findByRole('alertdialog', {
    name: 'Reset 2 properties to your default?',
  })
}

/** Confirmed, every listed property is reset, one request apiece, and nothing else. */
export const ResetsEachListedPropertyOnceConfirmed: Story = {
  args: { properties: threeProperties, preferences: setAtTwoOtherProperties },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    resetPropertyCategoryMock.mockClear()
    const canvas = within(canvasElement)
    // Both are named beneath the default, which keeps them.
    expect(
      canvas.getByRole('button', { name: MAKE_WORKFLOW_DEFAULT }),
    ).toHaveAccessibleDescription(
      'A new property gets in-app on, email off. Second Property and Lakeside Lodge keep their own setting.',
    )
    expect(canvas.getByRole('button', { name: RESET_BOTH_OTHERS })).toHaveTextContent(
      'Reset them to my default',
    )

    const dialog = await askToResetBothOthers(canvasElement)
    expect(dialog).toHaveAccessibleDescription(
      'Second Property and Lakeside Lodge lose their own workflow and collaboration settings and follow your default instead.',
    )
    expect(resetPropertyCategoryMock).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await expectToast('2 properties now follow your default')
    // One request per listed property; the property in view is not one of them.
    expect(resetPropertyCategoryMock).toHaveBeenCalledTimes(2)
    expect(resetPropertyCategoryMock).toHaveBeenNthCalledWith(1, {
      data: { propertyId: OTHER_PROPERTY_ID, category: 'workflow_collaboration' },
    })
    expect(resetPropertyCategoryMock).toHaveBeenNthCalledWith(2, {
      data: { propertyId: THIRD_PROPERTY_ID, category: 'workflow_collaboration' },
    })
    expect(updatePreferenceMock).not.toHaveBeenCalled()
    await expectNoDialog()
  },
}

/** Resets Second Property, then fails at Lakeside Lodge, as a dropped connection would. */
const resetThenFailMock = fn(async (input: ResetInput): Promise<void> => {
  if (input.data.propertyId === THIRD_PROPERTY_ID) throw new Error('Failed to fetch')
})

/**
 * A reset that fails part-way has already reset the properties before it, so
 * it has to say what happened rather than end in silence.
 */
export const AFailedResetSaysSo: Story = {
  args: {
    properties: threeProperties,
    preferences: setAtTwoOtherProperties,
    resetPropertyCategory: asAction(resetThenFailMock),
  },
  play: async ({ canvasElement }) => {
    resetThenFailMock.mockClear()
    const dialog = await askToResetBothOthers(canvasElement)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(resetThenFailMock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        document.querySelector('[data-sonner-toast][data-type="error"]'),
        'an error toast after a reset that failed part-way',
      ).not.toBeNull(),
    )
    // It says what already happened, not only that something failed.
    await expectToast(
      "1 of 2 properties now follow your default; the rest couldn't be reset. Try again.",
    )
  },
}

/**
 * The property in view has a Workflow setting of its own, so it can follow the
 * default again — this property only: Second Property's mute stays, so there is
 * nothing to ask. A category with no setting of its own here offers nothing.
 */
export const UseMyDefaultHereResetsOnlyThisProperty: Story = {
  args: { preferences: mutedAtSecondProperty },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    resetPropertyCategoryMock.mockClear()
    const canvas = within(canvasElement)
    expect(
      canvas.queryByRole('button', { name: 'Action needed: Use my default here' }),
    ).toBeNull()

    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Workflow and collaboration: Use my default here',
      }),
    )
    expect(within(document.body).queryByRole('alertdialog')).toBeNull()
    await expectToast('This property now follows your default')
    expect(resetPropertyCategoryMock).toHaveBeenCalledOnce()
    expect(resetPropertyCategoryMock).toHaveBeenCalledWith({
      data: { propertyId: PROPERTY_ID, category: 'workflow_collaboration' },
    })
    expect(updatePreferenceMock).not.toHaveBeenCalled()
  },
}

/**
 * Email the Property in view cannot send is not made the default. The email
 * save used to go out anyway, the server refused it for the missing
 * `notification.send_email` capability, and the page reported a failure
 * although in-app had already been saved.
 */
export const MakingADefaultLeavesUnavailableEmailAlone: Story = {
  args: { emailAvailability: 'unavailable' },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()

    await userEvent.click(
      within(canvasElement).getByRole('button', { name: MAKE_WORKFLOW_DEFAULT }),
    )

    await expectToast('In-app is now your default; email is not enabled here')
    expect(updatePreferenceMock).toHaveBeenCalledOnce()
    expect(updatePreferenceMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ channel: 'in_app', applyToAllProperties: true }),
    })
    expect(updatePreferenceMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ channel: 'email' }),
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
      canvas.getByRole('button', { name: MAKE_WORKFLOW_DEFAULT }),
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
