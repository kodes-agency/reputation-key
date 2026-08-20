import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  NotificationPreference,
  NotificationUserSettings,
} from '#/contexts/notification/application/public-api'
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
  preference({ category: 'digest_summary', channel: 'email', cadence: 'daily' }),
]

const userSettings = {
  locale: 'bg',
  timezone: 'Europe/Sofia',
} as NotificationUserSettings

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
    const emailSwitch = canvas.getByLabelText('Email', {
      selector: '#workflow_collaboration-email',
    })
    expect(emailSwitch).toBeEnabled()
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
      canvas.getByLabelText('Email', { selector: '#workflow_collaboration-email' }),
    ).toBeDisabled()
    expect(
      canvas.getByLabelText('Email', { selector: '#digest_summary-email' }),
    ).toBeDisabled()
    // In-app is a separate capability and stays operable.
    expect(
      canvas.getByLabelText('In-app', { selector: '#workflow_collaboration-in_app' }),
    ).toBeEnabled()
  },
}

export const MandatoryCategoryIsLocked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Account and safety notices are not opt-out on either channel.
    expect(
      canvas.getByLabelText('In-app', { selector: '#mandatory-in_app' }),
    ).toBeDisabled()
    expect(
      canvas.getByLabelText('Email', { selector: '#mandatory-email' }),
    ).toBeDisabled()
  },
}

export const FormattingSubmitsOnEnter: Story = {
  play: async ({ canvasElement }) => {
    updateUserSettingsMock.mockClear()
    const canvas = within(canvasElement)
    const timezone = canvas.getByLabelText('IANA timezone')
    // Locale and timezone were bare inputs with no enclosing form, so Enter did
    // nothing at all and the only way to save was finding the button.
    await userEvent.clear(timezone)
    await userEvent.type(timezone, 'Europe/Berlin{Enter}')
    await waitFor(() => expect(updateUserSettingsMock).toHaveBeenCalledOnce())
    expect(updateUserSettingsMock).toHaveBeenCalledWith({
      data: { locale: 'bg', timezone: 'Europe/Berlin' },
    })
  },
}

export const SeedsFormattingFromTheServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Render source is the query result, not a stale local mirror.
    expect(canvas.getByLabelText('Locale')).toHaveValue('bg')
    expect(canvas.getByLabelText('IANA timezone')).toHaveValue('Europe/Sofia')
  },
}
