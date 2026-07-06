import type { Meta, StoryObj } from '@storybook/react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from './alert'

const meta: Meta<typeof Alert> = {
  title: 'UI/Alert',
  component: Alert,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof Alert>

export const Default: Story = {
  render: () => (
    <Alert className="max-w-md">
      <TriangleAlert />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>You can add components to your app.</AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  render: () => (
    <Alert className="max-w-md" variant="destructive">
      <CircleAlert />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>Your session has expired. Please sign in again.</AlertDescription>
    </Alert>
  ),
}

// No leading icon → the `has-[>svg]:grid-cols-[…]` branch is inactive and the
// alert collapses to the single-column `grid-cols-[0_1fr]` track.
export const WithoutIcon: Story = {
  render: () => (
    <Alert className="max-w-md">
      <AlertTitle>Notice</AlertTitle>
      <AlertDescription>
        This alert has no icon, so it lays out without the icon gutter.
      </AlertDescription>
    </Alert>
  ),
}
