// The platform operator console (ADR 0063): the list an operator works from.
// Presentational, so each story hands it a list and Actions; the route owns the
// reads and the mutations.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { OperatorConsolePage } from './operator-console-page'
import {
  administered,
  awaitingFirstAdmin,
  fleet,
  makeAction,
  makeActions,
  reauthError,
} from './platform-console-stories-data'

const meta: Meta<typeof OperatorConsolePage> = {
  title: 'Platform/OperatorConsolePage',
  component: OperatorConsolePage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { organizations: fleet, actions: makeActions(), onSignInAgain: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof OperatorConsolePage>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('heading', { name: 'Operator console', level: 1 }),
    ).toBeVisible()
    expect(canvas.getByRole('button', { name: /new organization/i })).toBeVisible()
    // Five Organizations, each with its own heading.
    expect(canvas.getAllByRole('heading', { level: 3 })).toHaveLength(5)
    // Four are waiting for a first Account Admin; one is administered.
    const glance = within(canvas.getByLabelText('Organizations at a glance'))
    expect(glance.getByText('Need an Account Admin')).toBeVisible()
    expect(canvas.getAllByText('Needs an Account Admin')).toHaveLength(4)
  },
}

export const DefaultLight: Story = { parameters: { theme: 'light' } }

export const Phone: Story = {
  globals: { viewport: { value: 'mobileStaff', isRotated: false } },
}

export const Empty: Story = {
  args: { organizations: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('No Organizations yet')).toBeVisible()
    expect(canvas.queryByLabelText('Organizations at a glance')).toBeNull()
    // Creating the first one is still one click away.
    expect(canvas.getByRole('button', { name: /new organization/i })).toBeVisible()
  },
}

export const OneOrganizationAdministered: Story = {
  args: { organizations: [administered] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Needs an Account Admin')).toBeNull()
    // Dark for controlled beta: flagged on the row and counted in the strip.
    const attention = within(
      canvas.getByRole('list', { name: 'Attention for Alpine Stays' }),
    )
    expect(attention.getByText('Controlled beta off')).toBeVisible()
    expect(canvas.getByLabelText('Organizations at a glance')).toBeVisible()
  },
}

// A change on a session older than 30 minutes is refused; the list stays readable.
export const SignInAgainRequired: Story = {
  args: {
    organizations: [awaitingFirstAdmin],
    actions: makeActions({
      resend: makeAction(
        async () => {
          throw reauthError
        },
        { error: reauthError },
      ),
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const notice = canvas.getByText('Sign in again to make changes')
    expect(notice).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in again' }))
    expect(args.onSignInAgain).toHaveBeenCalledOnce()
    // The organization is still listed and readable.
    expect(
      canvas.getByRole('heading', { name: 'Riviera Hotels', level: 3 }),
    ).toBeVisible()
  },
}
