// The Organization's Google connection row. Disconnecting revokes access and
// removes what the account imported, for every Property that uses it, so the
// button asks first (the Property-level disconnect already did).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor } from 'storybook/test'
import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import { openAlertDialog } from '#/components/ui/confirmation-dialog.stories.open'
import { GoogleConnectionSettingsRow } from './google-connection-settings-row'

const connection: GoogleConnectionDto = {
  id: 'connection-7',
  organizationId: 'organization-1',
  accountEmail: 'owner@harborline.test',
  scopes: [],
  connectedBy: 'user-1',
  visibility: 'organization',
  status: 'active',
  createdAt: new Date('2026-08-27T00:00:00Z'),
  updatedAt: new Date('2026-08-27T00:00:00Z'),
}

const meta: Meta<typeof GoogleConnectionSettingsRow> = {
  title: 'Settings/GoogleConnectionSettingsRow',
  component: GoogleConnectionSettingsRow,
  tags: ['autodocs'],
  args: {
    connection,
    authorizationPending: false,
    disconnectPending: false,
    onReauthorize: fn(),
    onDisconnect: fn(),
  },
}
export default meta
type Story = StoryObj<typeof GoogleConnectionSettingsRow>

const openDisconnect = (canvasElement: HTMLElement) =>
  openAlertDialog(canvasElement, 'Disconnect')

/** Pressing Disconnect asks; nothing is disconnected until the dialog is confirmed. */
export const AsksBeforeDisconnecting: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDisconnect(canvasElement)
    expect(args.onDisconnect).not.toHaveBeenCalled()
    expect(
      dialog.getByRole('heading', { name: 'Disconnect this Google account?' }),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Disconnect account' }))
    expect(args.onDisconnect).toHaveBeenCalledTimes(1)
    expect(args.onDisconnect).toHaveBeenCalledWith('connection-7')
  },
}

/** Keeping the connection leaves it exactly as it was. */
export const KeepConnected: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await openDisconnect(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Keep connected' }))
    await waitFor(() => expect(dialog.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(args.onDisconnect).not.toHaveBeenCalled()
  },
}

export const AsksBeforeDisconnectingLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement, args }) => {
    await openDisconnect(canvasElement)
    expect(args.onDisconnect).not.toHaveBeenCalled()
  },
}
