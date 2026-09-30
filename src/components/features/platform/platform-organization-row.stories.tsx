// One Organization in the operator console (ADR 0063). Each state is a
// different answer to "what can the operator do here": act on an ownerless
// Organization, or read an administered one.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  administered,
  awaitingFirstAdmin,
  closing,
  lapsedInvitation,
  makeAction,
  makeActions,
  noInvitationOut,
} from './platform-console-stories-data'
import { PlatformOrganizationRow } from './platform-organization-row'

const actions = makeActions()

const meta: Meta<typeof PlatformOrganizationRow> = {
  title: 'Platform/PlatformOrganizationRow',
  component: PlatformOrganizationRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    organization: awaitingFirstAdmin,
    inviteAdmin: actions.inviteAdmin,
    resend: actions.resend,
    cancel: actions.cancel,
  },
  decorators: [
    (Story) => (
      <ul className="max-w-3xl divide-y rounded-lg border bg-card">
        <Story />
      </ul>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof PlatformOrganizationRow>

export const AwaitingFirstAdmin: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('heading', { name: 'Riviera Hotels', level: 3 }),
    ).toBeVisible()
    expect(canvas.getByText('Needs an Account Admin')).toBeVisible()
    expect(canvas.getByText('owner@rivierahotels.example')).toBeVisible()
    expect(canvas.getByText('Expires Oct 7, 2026, 9:05 AM UTC')).toBeVisible()
    expect(
      canvas.getByRole('button', { name: /resend invitation to owner@/i }),
    ).toBeEnabled()
    expect(
      canvas.getByRole('form', { name: /invite an account admin to riviera/i }),
    ).toBeVisible()
  },
}

export const AwaitingFirstAdminLight: Story = {
  parameters: { theme: 'light' },
}

export const LapsedInvitation: Story = {
  args: { organization: lapsedInvitation },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Expired')).toBeVisible()
    expect(canvas.getByText('Expired Sep 19, 2026, 2:40 PM UTC')).toBeVisible()
    expect(
      canvas.getAllByRole('button', { name: /^resend invitation to/i }),
    ).toHaveLength(2)
  },
}

export const NoInvitationOut: Story = {
  args: { organization: noInvitationOut },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('No open invitation.')).toBeVisible()
    expect(canvas.getByLabelText("Account Admin's email")).toBeVisible()
  },
}

export const Administered: Story = {
  args: { organization: administered },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Least privilege: no invitee addresses, no invite form, nothing to resend.
    expect(canvas.getByText(/its admins manage invitations/i)).toBeVisible()
    expect(canvas.queryByRole('form')).toBeNull()
    expect(canvas.queryByRole('button')).toBeNull()
    // Dark for controlled beta: the row names the id the allowlist needs.
    expect(canvas.getByText('Controlled beta off')).toBeVisible()
    expect(canvas.getByText('org-alpine')).toBeVisible()
  },
}

export const Closing: Story = {
  args: { organization: closing },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Closure requested')).toBeVisible()
    // Cancelling is allowed; resending and inviting need an active Organization.
    expect(canvas.queryByRole('button', { name: /^resend/i })).toBeNull()
    expect(canvas.getByRole('button', { name: /^cancel invitation to/i })).toBeVisible()
    expect(canvas.queryByRole('form')).toBeNull()
    expect(canvas.getByText(/cannot take a new invitation/i)).toBeVisible()
  },
}

const resendSpy = fn(async () => ({
  expiresAt: '2026-10-08T09:05:00.000Z',
  emailSent: true,
}))
const cancelSpy = fn(async () => undefined)

export const ResendAndCancel: Story = {
  args: { resend: makeAction(resendSpy), cancel: makeAction(cancelSpy) },
  play: async ({ canvasElement }) => {
    resendSpy.mockClear()
    cancelSpy.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(
      canvas.getByRole('button', { name: /resend invitation to owner@/i }),
    )
    await waitFor(() =>
      expect(resendSpy).toHaveBeenCalledWith({
        data: { organizationId: 'org-riviera', invitationId: 'inv-live' },
      }),
    )

    // Cancel asks first; keeping the invitation sends nothing.
    await userEvent.click(
      canvas.getByRole('button', { name: /cancel invitation to owner@/i }),
    )
    const dialog = within(await within(document.body).findByRole('alertdialog'))
    await userEvent.click(dialog.getByRole('button', { name: 'Keep invitation' }))
    expect(cancelSpy).not.toHaveBeenCalled()

    await userEvent.click(
      canvas.getByRole('button', { name: /cancel invitation to owner@/i }),
    )
    const confirm = within(await within(document.body).findByRole('alertdialog'))
    await userEvent.click(confirm.getByRole('button', { name: 'Cancel invitation' }))
    await waitFor(() =>
      expect(cancelSpy).toHaveBeenCalledWith({
        data: { organizationId: 'org-riviera', invitationId: 'inv-live' },
      }),
    )
  },
}
