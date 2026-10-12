// The same dead links as a signed-out visitor meets them on /join and
// /accept-invitation: each says what to do next and offers sign-in.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { InvitationStateCard } from './invitation-state-card'

const meta = {
  title: 'Identity/Registration/InvitationStateCard',
  component: InvitationStateCard,
} satisfies Meta<typeof InvitationStateCard>

export default meta
type Story = StoryObj<typeof meta>

export const Expired: Story = {
  args: {
    state: 'expired',
    organizationName: 'Meridian Hotels',
    inviterName: 'Dana Whitfield',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/ask dana whitfield to resend it/i)).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    )
  },
}

export const ExpiredInviterGone: Story = {
  args: { state: 'expired', organizationName: 'Meridian Hotels', inviterName: null },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/ask an account admin at meridian hotels/i),
    ).toBeInTheDocument()
  },
}

export const Cancelled: Story = {
  args: {
    state: 'canceled',
    organizationName: 'Meridian Hotels',
    inviterName: 'Dana Whitfield',
  },
}

export const AlreadyUsed: Story = {
  args: { state: 'accepted', organizationName: 'Meridian Hotels', inviterName: null },
}

export const Unavailable: Story = {
  args: { state: 'unavailable' },
}

// The preview's per-IP limit ran out: say to wait, and offer no retry button
// (each retry would spend more of the same budget).
export const RateLimited: Story = {
  args: { state: 'rate_limited' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Too many attempts')).toBeInTheDocument()
    await expect(canvas.getByText(/wait a few minutes/i)).toBeInTheDocument()
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument()
  },
}

// Light surfaces need their own contrast proof.
export const ExpiredLight: Story = {
  ...Expired,
  parameters: { theme: 'light' },
}
