// The Button, with the two things it owns (UI consistency scan: ACT-03, ACT-05):
// the pending state and the touch density. Dark is the default theme; the light
// variant renders the same rows on the light surface (axe runs on both).
//
// The Storybook Vitest project compiles no Tailwind, so no height is read back
// here. The plays prove what a screenshot cannot: a pending button is busy and
// inert and its name does not move, a press on it does nothing, and a
// `data-density="compact"` container changes the one token the controls read.
// The pixels are measured by `pnpm test:storybook:metrics`.
import type { Meta, StoryObj } from '@storybook/react'
import { Plus } from 'lucide-react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from './button'

const meta: Meta<typeof Button> = {
  title: 'Patterns/Button',
  component: Button,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Button>

const VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'link',
] as const
const SIZES = ['xs', 'sm', 'default', 'lg'] as const

/** Every variant at the default size: the Button is the one control, in six inks. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button')
    expect(buttons).toHaveLength(VARIANTS.length)
    for (const button of buttons) expect(button).toBeEnabled()
  },
}

/** The sizes. `xs` is text-sized; the others are tap targets below `md`. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {SIZES.map((size) => (
        <Button key={size} variant="outline" size={size}>
          {size}
        </Button>
      ))}
      <Button variant="outline" size="icon" aria-label="Add">
        <Plus />
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const sizes = within(canvasElement)
      .getAllByRole('button')
      .map((button) => button.dataset.size)
    expect(sizes).toEqual(['xs', 'sm', 'default', 'lg', 'icon'])
  },
}

/**
 * In flight: a spinner, `aria-busy`, and the button is disabled. The label stays,
 * so the name a screen reader hears does not move; a press does nothing.
 */
export const Pending: Story = {
  args: { pending: true, onClick: fn(), children: 'Save changes' },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save changes' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    const spinner = button.querySelector('svg')
    expect(spinner).toHaveAttribute('aria-hidden', 'true')
    expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none')
    // Disabled, but not faded: the label and the spinner are what the person reads.
    expect(button.className).toContain('aria-busy:disabled:opacity-100')
    await userEvent.click(button, { pointerEventsCheck: 0 })
    expect(args.onClick).not.toHaveBeenCalled()
  },
}

/** The label changes while pending when a word says more than the spinner ("Saving…"). */
export const PendingWithLabel: Story = {
  args: { pending: true, pendingLabel: 'Saving…', children: 'Save changes' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Saving…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(within(canvasElement).queryByText('Save changes')).toBeNull()
  },
}

/** Idle and busy side by side, on the light surface. */
export const PendingLight: Story = {
  parameters: { theme: 'light' },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Save changes</Button>
      <Button pending>Save changes</Button>
      <Button variant="outline" pending pendingLabel="Connecting…">
        Connect Google
      </Button>
      <Button variant="destructive" pending>
        Remove
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const busy = within(canvasElement)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-busy') === 'true')
    expect(busy).toHaveLength(3)
  },
}

/** Blocked, but still focusable so its reason can be reached: dimmed by the primitive. */
export const BlockedWithReason: Story = {
  render: () => (
    <Button aria-disabled="true" aria-describedby="why">
      Confirm and publish
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button')
    button.focus()
    expect(button).toHaveFocus()
    expect(button.className).toContain('aria-disabled:opacity-50')
  },
}

function Density({ density }: Readonly<{ density?: 'compact' }>) {
  return (
    <div data-density={density} data-testid={density ?? 'default'} className="flex gap-3">
      <Button>Save</Button>
      <Button variant="outline" size="sm">
        Cancel
      </Button>
      <Button variant="ghost" size="icon" aria-label="More">
        <Plus />
      </Button>
    </div>
  )
}

/**
 * The density is one token on a container. Below `md` a control is `--control-touch`
 * tall: 44px by default, 36px inside a `data-density="compact"` workspace (the
 * Inbox, the top bar). A Button never says either number itself.
 */
export const DensityToken: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Density />
      <Density density="compact" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const touch = (id: string): string =>
      getComputedStyle(within(canvasElement).getByTestId(id)).getPropertyValue(
        '--control-touch',
      )
    expect(touch('default').trim()).toBe('2.75rem')
    expect(touch('compact').trim()).toBe('2.25rem')
    for (const button of within(canvasElement).getAllByRole('button', { name: 'Save' })) {
      expect(button.className).toContain('max-md:min-h-(--control-touch)')
    }
  },
}

/** A link in a line of text is the `inline` size: no height, no padding, the line's own box. */
export const InlineLinkSize: Story = {
  render: () => (
    <p className="max-w-md text-sm text-muted-foreground">
      Nothing to show yet.{' '}
      <Button variant="link" size="inline" className="text-sm">
        Show earlier versions
      </Button>
    </p>
  ),
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button')
    expect(button.dataset.size).toBe('inline')
    expect(button.className).not.toContain('--control-touch')
  },
}
