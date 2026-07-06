import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Button' },
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = {}

export const Destructive: Story = { args: { variant: 'destructive' } }
export const Outline: Story = { args: { variant: 'outline' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Link: Story = { args: { variant: 'link' } }

export const ExtraSmall: Story = { args: { size: 'xs' } }
export const Small: Story = { args: { size: 'sm' } }
export const Large: Story = { args: { size: 'lg' } }

// Icon-only square sizes (matches the `icon*` size variants in buttonVariants).
export const IconXSmall: Story = {
  args: { size: 'icon-xs', variant: 'ghost', 'aria-label': 'Delete' },
  render: (args) => (
    <Button {...args}>
      <Trash2 />
    </Button>
  ),
}
export const IconSmall: Story = {
  args: { size: 'icon-sm', variant: 'ghost', 'aria-label': 'Delete' },
  render: (args) => (
    <Button {...args}>
      <Trash2 />
    </Button>
  ),
}
export const IconLarge: Story = {
  args: { size: 'icon-lg', variant: 'ghost', 'aria-label': 'Delete' },
  render: (args) => (
    <Button {...args}>
      <Trash2 />
    </Button>
  ),
}

export const WithIcon: Story = {
  render: (args) => (
    <Button {...args}>
      <Plus />
      Add property
    </Button>
  ),
}

// `asChild` forwards props to the slotted child via Radix Slot — here an anchor.
export const AsChild: Story = {
  args: {
    asChild: true,
    variant: 'link',
  },
  render: (args) => (
    <Button {...args}>
      <a href="https://example.com">Go to example</a>
    </Button>
  ),
}

// Asserts the onClick handler fires on click.
export const Clickable: Story = {
  args: {
    onClick: fn(),
    children: 'Click me',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /click me/i })
    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

export const IconButton: Story = {
  args: { size: 'icon', variant: 'ghost', 'aria-label': 'Delete' },
  render: (args) => (
    <Button {...args}>
      <Trash2 />
    </Button>
  ),
}

export const Disabled: Story = { args: { disabled: true } }
