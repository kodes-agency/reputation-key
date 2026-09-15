import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { SetupWizard } from './setup-wizard'

const meta = {
  title: 'PropertySetup/SetupWizard',
  component: SetupWizard,
  parameters: { layout: 'padded' },
  args: {
    step: 'confirm',
    children: <p>Confirm-details table</p>,
  },
} satisfies Meta<typeof SetupWizard>

export default meta
type Story = StoryObj<typeof meta>

/** The frame names every step and marks where the merchant is. */
export const ConfirmDetails: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('tablist', { name: /import steps/i })
    const current = within(steps).getByRole('tab', { selected: true })
    await expect(current).toHaveAttribute('aria-current', 'step')
    await expect(current).toHaveAccessibleName(/confirm details/i)
    await expect(within(steps).getAllByRole('tab')).toHaveLength(5)
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Confirm-details table')
  },
}

export const SetUpProperties: Story = {
  args: { step: 'setup', children: <p>Setup questions</p> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { selected: true })).toHaveAccessibleName(
      /set up properties/i,
    )
    await expect(
      canvas.getAllByRole('tab').filter((tab) => tab.dataset.state === 'completed'),
    ).toHaveLength(4)
  },
}

/** Phones print the step as a caption; the tabs keep their names for readers. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('tab', { selected: true })).toHaveAccessibleName(
      /confirm details/i,
    )
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}
