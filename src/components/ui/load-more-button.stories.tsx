// "Load more" for a cursor feed. One outline button; while a page loads it shows a
// spinner and "Loading…" and is aria-disabled rather than disabled, so a focused
// button keeps its focus (the notification popover is non-modal). Dark is the
// default theme; the light variant renders the same states on the light surface.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { LoadMoreButton } from './load-more-button'

const meta: Meta<typeof LoadMoreButton> = {
  title: 'Patterns/Load more button',
  component: LoadMoreButton,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { loading: false, onLoadMore: fn() },
}

export default meta
type Story = StoryObj<typeof LoadMoreButton>

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Load more' }),
    )
    expect(args.onLoadMore).toHaveBeenCalledTimes(1)
  },
}

export const DefaultLight: Story = {
  ...Default,
  parameters: { theme: 'light' },
}

/** Busy, not disabled: it keeps focus, and pressing it again does nothing. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: /loading/i })
    button.focus()
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).not.toBeDisabled()
    await userEvent.click(button)
    expect(args.onLoadMore).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  },
}

export const LoadingLight: Story = {
  ...Loading,
  parameters: { theme: 'light' },
}

/** After a failed attempt the same button reads "Try again". */
export const Failed: Story = {
  args: { failed: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Try again' }),
    )
    expect(args.onLoadMore).toHaveBeenCalledTimes(1)
  },
}

/** A feed with a noun says what it loads. */
export const WithLabel: Story = {
  args: { label: 'Load earlier activity' },
  play: ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Load earlier activity' }),
    ).toBeInTheDocument()
  },
}

/** At the foot of a card, filling its column, at the default size. */
export const BlockInACard: Story = {
  args: { block: true, size: 'default', label: 'Load more accounts' },
  decorators: [
    (Story) => (
      <div className="w-80 rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
  play: ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Load more accounts',
    })
    expect(button).toHaveAttribute('data-size', 'default')
    expect(button.className).toContain('w-full')
  },
}
