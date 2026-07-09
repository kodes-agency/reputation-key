// Connect Google Account button — kicks off the OAuth handshake.
// The button owns a local pending/error state around the `getAuthUrl` callback
// (NOT an Action wrapper), so stories feed controllable async fns directly and
// reach every state without a live OAuth round-trip.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ConnectGoogleButton } from './connect-google-button'

type AuthOpts = { data: { visibility: 'private' | 'organization' } }
type GetAuthUrl = (opts: AuthOpts) => Promise<{ url: string }>

const meta: Meta<typeof ConnectGoogleButton> = {
  title: 'Integration/ConnectGoogleButton',
  component: ConnectGoogleButton,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof ConnectGoogleButton>

// Never called without a click → the button rests in its idle state.
const idleGetAuthUrl: GetAuthUrl = async () => ({ url: 'https://example.com/oauth' })

export const Idle: Story = {
  args: { getAuthUrl: idleGetAuthUrl },
}

// Never-settling fn → after click the button holds its "connecting" state
// (spinner + disabled + aria-busy) until the OAuth redirect would fire.
export const Connecting: Story = {
  args: {
    getAuthUrl: () => new Promise<{ url: string }>(() => {}),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /connect google account/i }))
    await waitFor(() => {
      expect(canvas.getByRole('button')).toBeDisabled()
      expect(canvas.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    })
  },
}

// Rejecting fn → the catch block surfaces the inline error alert.
export const ConnectionError: Story = {
  args: {
    getAuthUrl: async () => {
      throw new Error('network down')
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /connect google account/i }))
    expect(
      await canvas.findByText(/failed to connect google account/i),
    ).toBeInTheDocument()
  },
}

// Organization-scoped connection (visibility label only differs at the server).
export const Organization: Story = {
  args: { visibility: 'organization', getAuthUrl: idleGetAuthUrl },
}
