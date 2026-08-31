import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { AcceptInvitationPage } from './accept-invitation-page'

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
  },
} satisfies Meta<typeof AcceptInvitationPage>

export default meta
type Story = StoryObj<typeof meta>

export const PendingInvitation: Story = {}

export const SpecificAcceptanceFailure: Story = {
  args: {
    acceptInvitation: fn(async () => {
      throw new Error('Invitation is invalid or expired')
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
