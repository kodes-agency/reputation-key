import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  EffectiveNotificationSettings,
  NotificationPreference,
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
    urgentBypassEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }) as unknown as NotificationPreference

const preferences: readonly NotificationPreference[] = [
  preference({ category: 'workflow_collaboration', channel: 'in_app', enabled: true }),
  preference({ category: 'workflow_collaboration', channel: 'email', enabled: false }),
  preference({ category: 'recognition', channel: 'email', cadence: 'daily' }),
]

const userSettings: EffectiveNotificationSettings = {
  locale: 'bg',
  timezone: 'Europe/Sofia',
  timezoneSource: 'user',
}

/** A user who never saved anything: delivery runs on the Organization's zone. */
const organizationSettings: EffectiveNotificationSettings = {
  locale: 'en',
  timezone: 'Europe/Sofia',
  timezoneSource: 'organization',
}

type PreferenceInput = Readonly<{
  data: Readonly<{
    propertyId: string
    category: NotificationPreference['category']
    channel: NotificationPreference['channel']
    enabled: boolean
    cadence: NotificationPreference['cadence']
    urgentBypassEnabled: boolean
    quietHoursStart: string | null
    quietHoursEnd: string | null
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
const updatePreference = asAction(updatePreferenceMock)
const updateUserSettings = asAction(updateUserSettingsMock)

const setPropertyId = fn()

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
    userSettings,
    propertyId: PROPERTY_ID,
    emailAllowed: true,
    setPropertyId,
    updatePreference,
    updateUserSettings,
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
    expect(canvas.queryByRole('heading', { name: 'Recognition' })).toBeNull()
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
  args: { emailAllowed: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The defect this story exists for: the whole Email column used to render
    // fully enabled for a property without `notification.send_email`, and every
    // write failed with a generic toast. It must now say so and be inert.
    expect(canvas.getByTestId('email-unavailable-notice')).toBeInTheDocument()
    expect(
      canvas.getByRole('switch', { name: 'Workflow and collaboration: Email' }),
    ).toBeDisabled()
    expect(canvas.queryByRole('switch', { name: /^Past awards/ })).toBeNull()
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
    // Both rows used to announce the same "In-app", "Email", "Cadence",
    // "Quiet from" and "until", so a screen-reader user tabbing through could
    // not tell which category they were changing.
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
      expect(canvas.getByLabelText(`${category}: Quiet from`)).toBeInTheDocument()
      expect(canvas.getByLabelText(`${category}: quiet hours until`)).toBeInTheDocument()
      expect(
        canvas.getByRole('button', { name: `Save quiet hours for ${category}` }),
      ).toBeInTheDocument()
    }
    expect(
      canvas.getByRole('switch', {
        name: 'Action needed: Allow urgent email to bypass quiet hours',
      }),
    ).toBeInTheDocument()
  },
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
    await userEvent.click(canvas.getByRole('button', { name: 'Save formatting' }))
    await waitFor(() => expect(updateUserSettingsMock).toHaveBeenCalledOnce())
    // Only the changed setting travels: the untouched format is not re-sent.
    expect(updateUserSettingsMock).toHaveBeenCalledWith({
      data: { timezone: 'Europe/Berlin' },
    })
  },
}

export const SeedsFormattingFromTheServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Render source is the query result, not a stale local mirror.
    expect(
      canvas.getByRole('combobox', { name: 'Date and time format' }),
    ).toHaveTextContent('Bulgarian')
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
    expect(
      canvas.getAllByText(/daily digest and quiet hours use your timezone, Sofia/),
    ).toHaveLength(2)
    expect(canvas.queryByText(/property-local/)).toBeNull()
  },
}

export const SavingTheLocaleKeepsTheOrganizationTimezone: Story = {
  args: { userSettings: organizationSettings },
  play: async ({ canvasElement }) => {
    updateUserSettingsMock.mockClear()
    const canvas = within(canvasElement)
    const save = canvas.getByRole('button', { name: 'Save formatting' })
    // Nothing differs from what is in effect yet.
    expect(save).toBeDisabled()
    await userEvent.click(canvas.getByRole('combobox', { name: 'Date and time format' }))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'English (UK)' }),
    )
    await userEvent.click(save)
    await waitFor(() => expect(updateUserSettingsMock).toHaveBeenCalledOnce())
    // The timezone is not sent, so the save cannot pin anything over it.
    expect(updateUserSettingsMock).toHaveBeenCalledWith({ data: { locale: 'en-GB' } })
  },
}

export const KeepsALegacyTimezoneTheListNoLongerOffers: Story = {
  args: {
    userSettings: { locale: 'de-DE', timezone: '+03:00', timezoneSource: 'user' },
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
    await userEvent.click(canvas.getByRole('combobox', { name: 'Date and time format' }))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'English (US)' }),
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Save formatting' }))
    await waitFor(() => expect(updateUserSettingsMock).toHaveBeenCalledOnce())
    expect(updateUserSettingsMock).toHaveBeenCalledWith({ data: { locale: 'en' } })
  },
}

export const QuietHoursCanBeCleared: Story = {
  args: {
    preferences: [
      ...preferences.filter(
        (item) =>
          !(item.category === 'workflow_collaboration' && item.channel === 'email'),
      ),
      preference({
        category: 'workflow_collaboration',
        channel: 'email',
        enabled: true,
        quietHoursStart: '09:00',
        quietHoursEnd: '17:00',
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    updatePreferenceMock.mockClear()
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', {
      name: 'Workflow and collaboration',
    })
    const fieldset = heading.closest('fieldset')
    if (!fieldset) throw new Error('workflow notification fieldset is missing')
    const row = within(fieldset)
    await userEvent.clear(row.getByLabelText(/quiet from/i))
    await userEvent.clear(row.getByLabelText(/quiet hours until/i))
    await userEvent.click(row.getByRole('button', { name: /save quiet hours/i }))

    await waitFor(() =>
      expect(updatePreferenceMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: 'workflow_collaboration',
          channel: 'email',
          quietHoursStart: null,
          quietHoursEnd: null,
        }),
      }),
    )
  },
}
