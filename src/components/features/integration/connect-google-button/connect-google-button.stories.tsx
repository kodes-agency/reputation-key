// Connect Google button — kicks off the OAuth handshake, wherever it is: the import
// page, the Integrations page (a first account, another account) and a connection that
// needs Reauthorize. One wording, one glyph, one pending state, one failure.
// Stories feed controllable async fns into the shared Action-backed component
// and reach every state without a live OAuth round-trip.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { GoogleAuthUrlInput } from '#/contexts/integration/application/public-api'
import { ToasterDecorator } from '../../../../../.storybook/ToasterDecorator'
import { ConnectGoogleButton } from './connect-google-button'

type GetAuthUrl = (opts: { data: GoogleAuthUrlInput }) => Promise<{ url: string }>

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
  play: ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Connect Google' })
    expect(button).toBeEnabled()
  },
}

export const IdleLight: Story = { ...Idle, parameters: { theme: 'light' } }

// Where an account is already connected the same button is another account.
export const AnotherAccount: Story = {
  args: { getAuthUrl: idleGetAuthUrl, label: 'Connect another account' },
  play: ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Connect another account' }),
    ).toBeEnabled()
  },
}

// A connection that needs fresh permission: the same ceremony, targeted at it.
export const Reauthorize: Story = {
  args: {
    getAuthUrl: async () => {
      throw new Error('network down')
    },
    label: 'Reauthorize',
    variant: 'outline',
    size: 'sm',
    request: {
      visibility: 'organization',
      connectionMode: 'reauth',
      targetConnectionId: 'connection-7',
    },
  },
  decorators: [ToasterDecorator],
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Reauthorize' }),
    )
    expect(
      await within(document.body).findByText(
        "Couldn't reauthorize your Google account. Try again.",
      ),
    ).toBeInTheDocument()
  },
}

// Never-settling fn → after click the button holds its "connecting" state
// (spinner + disabled + aria-busy) until the OAuth redirect would fire.
export const Connecting: Story = {
  args: {
    getAuthUrl: () => new Promise<{ url: string }>(() => {}),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Google' }))
    await waitFor(() => {
      expect(canvas.getByRole('button')).toBeDisabled()
      expect(canvas.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    })
  },
}

// Rejecting fn → connecting is an immediate action, so the failure is a toast
// (the app's Toaster lives in the root route; the story mounts its own).
export const ConnectionError: Story = {
  args: {
    getAuthUrl: async () => {
      throw new Error('network down')
    },
  },
  decorators: [ToasterDecorator],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Google' }))
    expect(
      await within(document.body).findByText(
        "Couldn't connect your Google account. Try again.",
      ),
    ).toBeInTheDocument()
  },
}
