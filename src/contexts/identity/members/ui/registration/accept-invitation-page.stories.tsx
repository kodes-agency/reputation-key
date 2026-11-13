import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AcceptInvitationPage } from './accept-invitation-page'
import { ServerFunctionError } from '#/shared/auth/server-function-error'

const meta = {
  title: 'Identity/Registration/AcceptInvitationPage',
  component: AcceptInvitationPage,
  args: {
    invitations: [
      {
        id: 'invitation-1',
        organizationName: 'Meridian Hotels',
        role: 'PropertyManager',
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
    acceptInvitation: fn(async () => undefined),
    joiningNotice: 'By joining you accept the Beta Agreement and the Privacy Notice.',
  },
} satisfies Meta<typeof AcceptInvitationPage>

export default meta
type Story = StoryObj<typeof meta>

export const PendingInvitation: Story = {}

export const SpecificAcceptanceFailure: Story = {
  args: {
    acceptInvitation: fn(async () => {
      throw new ServerFunctionError(
        'InvitationError',
        'Invitation is invalid or expired',
        'invitation_invalid',
        400,
      )
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(canvas.getByText('Invitation is invalid or expired')).toBeInTheDocument(),
    )
  },
}
