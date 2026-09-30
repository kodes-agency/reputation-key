// The signed-in side of an invitation link: confirm, mismatch, and the links
// that cannot be used. Nothing here accepts until the person presses the button.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { InvitationLinkPage } from './invitation-link-page'
import type { InvitationLink } from './invitation-link'

const pending: InvitationLink = {
  state: 'pending',
  invitationId: 'invitation-1',
  invitedEmail: 'new.hire@meridian.test',
  details: {
    organizationName: 'Meridian Hotels',
    inviterName: 'Dana Whitfield',
    role: 'PropertyManager',
    propertyNames: ['Harbour View', 'Old Town Inn'],
    expiresAt: new Date('2026-10-07T12:00:00.000Z'),
  },
}

const meta = {
  title: 'Identity/Registration/InvitationLinkPage',
  component: InvitationLinkPage,
  args: {
    link: pending,
    signedInEmail: 'new.hire@meridian.test',
    acceptInvitation: fn(async () => undefined),
    signOut: fn(async () => undefined),
    joiningNotice: 'By joining you accept the Beta Agreement and the Privacy Notice.',
  },
} satisfies Meta<typeof InvitationLinkPage>

export default meta
type Story = StoryObj<typeof meta>

// Opening the link shows what is offered and waits: no acceptance yet.
export const Confirm: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Join Meridian Hotels')).toBeInTheDocument()
    await expect(canvas.getByText('Dana Whitfield')).toBeInTheDocument()
    await expect(canvas.getByText('Property Manager')).toBeInTheDocument()
    await expect(canvas.getByText('Harbour View')).toBeInTheDocument()
    await expect(canvas.getByText(/signed in as/i)).toBeInTheDocument()
    await expect(args.acceptInvitation).not.toHaveBeenCalled()
  },
}

export const AccountAdminInvitation: Story = {
  args: {
    link: {
      ...pending,
      details: { ...pending.details, role: 'AccountAdmin', propertyNames: [] },
    },
  },
}

export const AcceptsOnRequest: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept and join' }))

    await waitFor(() =>
      expect(args.acceptInvitation).toHaveBeenCalledWith({
        data: { invitationId: 'invitation-1' },
      }),
    )
    await expect(await canvas.findByText('Welcome to the team!')).toBeInTheDocument()
    await expect(args.acceptInvitation).toHaveBeenCalledTimes(1)
  },
}

export const AcceptanceFailure: Story = {
  args: {
    acceptInvitation: fn(async () => {
      throw new Error('This invitation has expired. Ask your Account Admin to resend it.')
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept and join' }))

    await expect(await canvas.findByText(/has expired/i)).toBeInTheDocument()
    // The person can try again.
    await expect(canvas.getByRole('button', { name: 'Accept and join' })).toBeEnabled()
  },
}

export const SignOutFromConfirm: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(args.signOut).toHaveBeenCalledTimes(1))
    await expect(args.acceptInvitation).not.toHaveBeenCalled()
  },
}

// Signed in as someone else: the card names both addresses and offers sign-out.
export const Mismatch: Story = {
  args: { signedInEmail: 'dana@other.test' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('This invitation is for another address'),
    ).toBeInTheDocument()
    await expect(canvas.getByText(/new\.hire@meridian\.test/)).toBeInTheDocument()
    await expect(canvas.getByText(/dana@other\.test/)).toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: /accept/i }),
    ).not.toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(args.signOut).toHaveBeenCalledTimes(1))
  },
}

// Addresses compare without regard to case.
export const MatchIgnoresCase: Story = {
  args: { signedInEmail: 'New.Hire@Meridian.test' },
}

export const SignOutFailure: Story = {
  args: {
    signedInEmail: 'dana@other.test',
    signOut: fn(async () => {
      throw new Error('Could not sign out. Please try again.')
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Sign out' }))

    await expect(await canvas.findByText(/could not sign out/i)).toBeInTheDocument()
  },
}

export const Expired: Story = {
  args: {
    link: {
      state: 'expired',
      organizationName: 'Meridian Hotels',
      inviterName: 'Dana Whitfield',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('This invitation has expired')).toBeInTheDocument()
    await expect(canvas.getByText(/ask dana whitfield to resend it/i)).toBeInTheDocument()
    await expect(
      canvas.getByRole('link', { name: 'Go to your workspace' }),
    ).toBeInTheDocument()
  },
}

export const Cancelled: Story = {
  args: {
    link: { state: 'canceled', organizationName: 'Meridian Hotels', inviterName: null },
  },
}

export const AlreadyUsed: Story = {
  args: {
    link: { state: 'accepted', organizationName: 'Meridian Hotels', inviterName: null },
  },
}

export const Unavailable: Story = {
  args: { link: { state: 'unavailable' } },
}
