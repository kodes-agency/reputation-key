// The IconButton: a Button with no words. The name is required and becomes the
// tooltip a pointer or a keyboard user reads (UI consistency scan: ACT-16,
// SURF-12). The app mounts one TooltipProvider at the root, and the Storybook
// preview mounts the same one. Dark is the default theme; the light variant
// renders the same row on the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { Copy, Ellipsis, RefreshCw, X } from 'lucide-react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { IconButton } from './icon-button'

const meta: Meta<typeof IconButton> = {
  title: 'Patterns/Icon button',
  component: IconButton,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'Refresh', onClick: fn(), children: <RefreshCw /> },
}

export default meta
type Story = StoryObj<typeof IconButton>

/** Hover shows the label; the button's name is the label too. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Refresh' })
    expect(button).toHaveAttribute('data-size', 'icon')
    await userEvent.hover(button)
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh'))
    await userEvent.click(button)
    expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

/** A keyboard user gets the same hint on focus. */
export const KeyboardFocus: Story = {
  play: async () => {
    await userEvent.tab()
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh'))
  },
}

/** A string replaces the words, for a label that carries a shortcut. */
export const CustomTooltip: Story = {
  args: {
    label: 'Copy review text',
    tooltip: 'Copy review text (C)',
    children: <Copy />,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Copy review text' })
    await userEvent.hover(button)
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Copy review text (C)'),
    )
  },
}

/** A trigger whose open menu already says what it is goes without a tooltip, keeping its name. */
export const WithoutTooltip: Story = {
  args: { label: 'More actions for Anna', tooltip: false, children: <Ellipsis /> },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'More actions for Anna',
    })
    await userEvent.hover(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  },
}

/** Pending takes the glyph's place with a spinner, and the button is inert. */
export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Refresh' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelectorAll('svg')).toHaveLength(1)
    await userEvent.click(button, { pointerEventsCheck: 0 })
    expect(args.onClick).not.toHaveBeenCalled()
  },
}

/** The four square sizes. All but `icon-xs` are tap targets below `md`. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton label="Close, extra small" size="icon-xs" variant="outline">
        <X />
      </IconButton>
      <IconButton label="Close, small" size="icon-sm" variant="outline">
        <X />
      </IconButton>
      <IconButton label="Close" variant="outline">
        <X />
      </IconButton>
      <IconButton label="Close, large" size="icon-lg" variant="outline">
        <X />
      </IconButton>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const sizes = within(canvasElement)
      .getAllByRole('button')
      .map((button) => button.dataset.size)
    expect(sizes).toEqual(['icon-xs', 'icon-sm', 'icon', 'icon-lg'])
  },
}

/** The same row on the light surface: ghost, outline and a disabled one. */
export const Light: Story = {
  parameters: { theme: 'light' },
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton label="Refresh">
        <RefreshCw />
      </IconButton>
      <IconButton label="Copy" variant="outline">
        <Copy />
      </IconButton>
      <IconButton label="Close" disabled>
        <X />
      </IconButton>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Refresh',
      'Copy',
      'Close',
    ])
    expect(buttons[2]).toBeDisabled()
  },
}
