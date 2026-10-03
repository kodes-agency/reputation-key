// The Property layout's one answer to a missing Property. The way out is the
// Properties list, a real link, because a second try cannot succeed.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PropertyNotFound } from './property-not-found'

const meta: Meta<typeof PropertyNotFound> = {
  title: 'Property/PropertyNotFound',
  component: PropertyNotFound,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof PropertyNotFound>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Property not found.')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Back to Properties' })).toHaveAttribute(
      'href',
      '/properties',
    )
    expect(canvas.queryByRole('button', { name: /try again/i })).toBeNull()
  },
}

export const LightTheme: Story = {
  ...Default,
  parameters: { layout: 'padded', theme: 'light' },
}
