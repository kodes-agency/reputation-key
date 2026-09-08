import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { withRole } from '../../../../../.storybook/AuthedRouterDecorator'
import { GoogleReviewDestinationCard } from './google-review-destination-card'

const meta = {
  title: 'Portal/GoogleReviewDestinationCard',
  component: GoogleReviewDestinationCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    destination: { state: 'unavailable', retrievedAt: null },
  },
} satisfies Meta<typeof GoogleReviewDestinationCard>

export default meta
type Story = StoryObj<typeof meta>

export const NeedsConnectionForPropertyManager: Story = {
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/guests cannot continue to Google/i)).toBeVisible()
    await expect(
      canvas.getByText(/ask an account admin to connect or refresh Google/i),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('link', { name: /open Google integrations/i }),
    ).toBeNull()
  },
}

export const NeedsConnectionForAccountAdmin: Story = {
  decorators: [withRole('AccountAdmin')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const actions = [
      {
        link: canvas.getByRole('link', { name: /open Google integrations/i }),
        href: '/settings/integrations',
      },
      {
        link: canvas.getByRole('link', { name: /review property import/i }),
        href: '/properties/import-google',
      },
    ] as const
    for (const action of actions) {
      await expect(action.link).toBeVisible()
      await expect(action.link).toHaveAttribute('href', action.href)
    }

    const integrations = actions[0].link
    integrations.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    })
    await userEvent.click(integrations)
  },
}
