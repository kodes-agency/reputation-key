// The card between "account created" and the app, and its way out of a failure.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { JoinEntryCard } from './join-entry-card'

const meta = {
  title: 'Identity/Registration/JoinEntryCard',
  component: JoinEntryCard,
  args: { status: 'entering', onRetry: fn() },
} satisfies Meta<typeof JoinEntryCard>

export default meta
type Story = StoryObj<typeof meta>

export const Entering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Signing you in')
    await expect(
      canvas.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.getByRole('link', { name: 'Continue to your workspace' }),
    ).toBeInTheDocument()
  },
}

// Opening the workspace failed: retry, and the link stays as the manual way in.
export const Failed: Story = {
  args: { status: 'failed' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('We could not open your workspace')).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))

    await expect(args.onRetry).toHaveBeenCalledTimes(1)
    await expect(
      canvas.getByRole('link', { name: 'Continue to your workspace' }),
    ).toBeInTheDocument()
  },
}
