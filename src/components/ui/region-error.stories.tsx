// A region that could not be read: a list, a strip, a card, a rail, a preview.
// It says what failed and always offers the same recovery, "Try again", wired to
// the region's own refetch. Dark is the default theme; the light variant renders
// the same panel on the light surface (axe runs on both). The plays check the
// announced alert, the single label, and that the button calls the retry.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { RegionError, RetryButton } from './region-error'

const meta: Meta<typeof RegionError> = {
  title: 'Patterns/Region error',
  component: RegionError,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { message: 'The goal couldn’t be loaded.', onRetry: fn(), retrying: false },
}

export default meta
type Story = StoryObj<typeof RegionError>

/**
 * The panel is announced, names the thing, and "Try again" calls the refetch.
 * It never takes focus when it appears: a failed side read on a page with several
 * regions would otherwise pull focus on load. (The ring this story's screenshot
 * shows is the play's own click below, not the component.)
 */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('The goal couldn’t be loaded.')
    const retry = canvas.getByRole('button', { name: 'Try again' })
    expect(retry).not.toHaveFocus()
    await userEvent.click(retry)
    expect(args.onRetry).toHaveBeenCalledTimes(1)
  },
}

/** A sentence under the message says what is unaffected. */
export const WithDescription: Story = {
  args: {
    size: 'compact',
    message: 'Results couldn’t be loaded.',
    description: 'The portals below are unaffected.',
  },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByText('The portals below are unaffected.'),
    ).toBeVisible()
  },
}

/** A rail, a card or a dialog: the same panel, tighter. */
export const Compact: Story = {
  args: { size: 'compact', message: 'The preview couldn’t be loaded' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-slot="empty-state"]')?.className).toContain(
      'py-6',
    )
  },
}

/**
 * The retry is reading: the panel stays, its button reads "Trying again…" and a
 * second press does nothing. The button is aria-disabled, not disabled, so a
 * keyboard user's focus is not dropped onto <body>. Its accessible name stays
 * "Try again" (the visible words are hidden from the tree), so the alert around
 * it is not announced a second time each time the retry starts and ends.
 */
export const Retrying: Story = {
  args: { retrying: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Try again' })
    expect(button).toHaveTextContent('Trying again…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('aria-busy', 'true')
    button.focus()
    await userEvent.click(button)
    expect(button).toHaveFocus()
    expect(args.onRetry).not.toHaveBeenCalled()
  },
}

/** A region that can be left, such as a restore check, offers Cancel beside Try again. */
export const WithCancel: Story = {
  args: {
    size: 'compact',
    message: 'What would change couldn’t be checked.',
    onCancel: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const buttons = canvas.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Try again', 'Cancel'])
    expect(canvasElement.contains(document.activeElement)).toBe(false)
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    expect(args.onCancel).toHaveBeenCalledTimes(1)
  },
}

/**
 * The dense-workspace density (the Inbox's panes): 36px on a phone where the
 * default is the 44px touch target. Browsers below `md` only; this story pins
 * the class pair so it cannot drift back to the default.
 */
export const CompactDensity: Story = {
  args: { size: 'compact', density: 'compact' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Try again' })
    expect(button.className).toContain('max-md:h-9')
    expect(button.className).not.toContain('max-md:min-h-11')
  },
}

/** A press that succeeds is the region's to resolve: here it clears the panel. */
export const RecoversOnRetry: Story = {
  render: function Render(args) {
    const [failed, setFailed] = useState(true)
    return failed ? (
      <RegionError {...args} onRetry={() => setFailed(false)} />
    ) : (
      <p>Loaded.</p>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(canvas.getByText('Loaded.')).toBeVisible()
    expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/** The inline control, for a notice or a status line that is not a whole panel. */
export const InlineRetryButton: StoryObj<typeof RetryButton> = {
  render: () => (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      Couldn’t refresh notifications.
      <RetryButton size="xs" onRetry={fn()} />
    </p>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

export const DefaultLight: Story = {
  ...Default,
  parameters: { theme: 'light' },
}

export const CompactLight: Story = {
  ...WithDescription,
  parameters: { theme: 'light' },
}
