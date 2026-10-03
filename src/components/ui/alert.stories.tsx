// The notice tones (UI consistency scan: SURF-05). One Alert, five variants:
// `default` is a plain card for a notice that brings its own icon; the four
// tones draw the one icon they wear everywhere (destructive, warning, success,
// info), so a caller names the tone and writes the words. Dark is the default
// theme; the light variants render the same notices on the light surface (axe
// runs on both). The plays check what every notice must be: announced, named,
// and with exactly one icon the screen reader skips.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { Button } from './button'
import { Alert, AlertDescription, AlertTitle } from './alert'

const meta: Meta<typeof Alert> = {
  title: 'Patterns/Alert tones',
  component: Alert,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Alert>

/** A tone's notice is announced, names its variant, and wears exactly one icon the screen reader skips. */
function expectTone(canvasElement: HTMLElement, variant: string): HTMLElement {
  const alert = within(canvasElement).getByRole('alert')
  expect(alert).toHaveAttribute('data-variant', variant)
  expect(alert.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  return alert
}

/** Something failed or is blocked. Keeps the card surface the form errors use. */
export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive">
      <AlertTitle>Unable to complete this action</AlertTitle>
      <AlertDescription>The address could not be saved. Try again.</AlertDescription>
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    const alert = expectTone(canvasElement, 'destructive')
    expect(alert).toHaveTextContent('Unable to complete this action')
  },
}

/** This needs a person, or may break something. */
export const Warning: Story = {
  render: () => (
    <Alert variant="warning">
      <AlertTitle>Save this address now</AlertTitle>
      <AlertDescription>
        For security, the full address is not shown again after this page is reloaded.
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    expectTone(canvasElement, 'warning')
  },
}

/** It worked. */
export const Success: Story = {
  render: () => (
    <Alert variant="success">
      <AlertTitle>Setup saved</AlertTitle>
      <AlertDescription>
        Every property has its public display name and reply language.
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    expectTone(canvasElement, 'success')
  },
}

/** Worth knowing, nothing to do. */
export const Info: Story = {
  render: () => (
    <Alert variant="info">
      <AlertTitle>View-only access</AlertTitle>
      <AlertDescription>
        You do not have permission to make or replace the portal's code.
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    expectTone(canvasElement, 'info')
  },
}

/**
 * A notice that is already on the page when it loads is not news: `role="status"`
 * keeps it from interrupting a screen reader. A description can carry an action.
 */
export const StaticNoticeWithAction: Story = {
  render: () => (
    <Alert variant="warning" role="status">
      <AlertTitle>Reconnect Google to continue</AlertTitle>
      <AlertDescription>
        <p>None of the saved Google connections can be used for discovery.</p>
        <Button size="sm" variant="outline">
          Open integration settings
        </Button>
      </AlertDescription>
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('status')).toHaveTextContent('Reconnect Google to continue')
    expect(canvas.queryByRole('alert')).toBeNull()
    expect(
      canvas.getByRole('button', { name: 'Open integration settings' }),
    ).toBeVisible()
  },
}

/** The plain card: the caller brings its own icon, or none. */
export const Plain: Story = {
  render: () => (
    <Alert>
      <AlertTitle>Nothing to save</AlertTitle>
      <AlertDescription>Every question was skipped.</AlertDescription>
    </Alert>
  ),
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole('alert')
    expect(alert).toHaveAttribute('data-variant', 'default')
    expect(alert.querySelector('svg')).toBeNull()
  },
}

export const DestructiveLight: Story = { ...Destructive, parameters: { theme: 'light' } }
export const WarningLight: Story = { ...Warning, parameters: { theme: 'light' } }
export const SuccessLight: Story = { ...Success, parameters: { theme: 'light' } }
export const InfoLight: Story = { ...Info, parameters: { theme: 'light' } }
