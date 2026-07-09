import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './badge'
import { Star } from 'lucide-react'

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'Badge' },
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof Badge>

export const Default: Story = {}
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Destructive: Story = { args: { variant: 'destructive' } }
export const Outline: Story = { args: { variant: 'outline' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Link: Story = { args: { variant: 'link' } }

export const WithIcon: Story = {
  render: () => (
    <Badge>
      <Star />
      Verified
    </Badge>
  ),
}

// asChild renders the Badge styles onto a child element (Slot) — here a link,
// exercising the `[a&]:hover` variants in badgeVariants.
export const AsLink: Story = {
  render: () => (
    <Badge asChild>
      <a href="https://example.com">View profile</a>
    </Badge>
  ),
}
