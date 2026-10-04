// The row-actions menu: the one three-dots trigger, the one name for it, and the
// item rules (a destructive flag, an ellipsis for an item that opens a dialog).
// Dark is the default theme; the light variant renders the same menu on the light
// surface (axe runs on both). The Storybook Vitest project compiles no Tailwind,
// so the plays pin names, roles, variants and text, not pixels.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import {
  RowActionsItem,
  RowActionsLabel,
  RowActionsMenu,
  RowActionsSeparator,
} from './row-actions-menu'

const meta: Meta<typeof RowActionsMenu> = {
  title: 'Patterns/Row actions menu',
  component: RowActionsMenu,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { name: 'Pool & Terrace' },
  render: (args) => (
    <RowActionsMenu {...args}>
      <RowActionsItem asChild>
        <a href="#open">Open overview</a>
      </RowActionsItem>
      <RowActionsItem onSelect={fn()}>Rename</RowActionsItem>
      <RowActionsSeparator />
      <RowActionsItem opensDialog onSelect={fn()}>
        Archive
      </RowActionsItem>
      <RowActionsItem destructive opensDialog onSelect={fn()}>
        Remove
      </RowActionsItem>
    </RowActionsMenu>
  ),
}

export default meta
type Story = StoryObj<typeof RowActionsMenu>

const trigger = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('button', { name: 'More actions for Pool & Terrace' })

/** Opens the menu and reads its items by name. */
async function openMenu(canvasElement: HTMLElement) {
  await userEvent.click(trigger(canvasElement))
  const menu = within(await screen.findByRole('menu'))
  return (name: string) => menu.getByRole('menuitem', { name })
}

/** Leaves the page as it found it: the menu portals out of the story and would outlive it. */
async function closeMenu(canvasElement: HTMLElement) {
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(trigger(canvasElement)).toHaveAttribute('aria-expanded', 'false'),
  )
}

/** The trigger is named after the row, and opens a menu. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const button = trigger(canvasElement)
    expect(button).toHaveAttribute('data-variant', 'ghost')
    expect(button).toHaveAttribute('data-size', 'icon-sm')
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(button)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4)
    await closeMenu(canvasElement)
  },
}

/** The same menu on the light surface. */
export const Light: Story = {
  parameters: { theme: 'light' },
  play: Default.play,
}

/** An item that opens a dialog ends in an ellipsis; one that acts at once does not. */
export const EllipsisForItemsThatAskForMore: Story = {
  play: async ({ canvasElement }) => {
    const item = await openMenu(canvasElement)
    expect(item('Archive…')).toBeInTheDocument()
    expect(item('Rename')).toBeInTheDocument()
    // A link item writes its own label, and the primitive adds nothing to it.
    expect(item('Open overview')).toBeInTheDocument()
    await closeMenu(canvasElement)
  },
}

/** Only an action that cannot be taken back is the red item. */
export const DestructiveFlag: Story = {
  play: async ({ canvasElement }) => {
    const item = await openMenu(canvasElement)
    expect(item('Remove…')).toHaveAttribute('data-variant', 'destructive')
    expect(item('Archive…')).toHaveAttribute('data-variant', 'default')
    await closeMenu(canvasElement)
  },
}

/** A link item is the anchor itself, so it is followed, not only announced. */
export const LinkItem: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const link = await screen.findByRole('menuitem', { name: 'Open overview' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '#open')
    await closeMenu(canvasElement)
  },
}

/** Choosing an item runs it and closes the menu. */
export const SelectClosesTheMenu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    await waitFor(() =>
      expect(trigger(canvasElement)).toHaveAttribute('aria-expanded', 'false'),
    )
    await waitFor(() => expect(trigger(canvasElement)).toHaveFocus())
  },
}

/** An outline trigger, for a menu that sits among outline controls (a toolbar). */
export const Outline: Story = {
  args: { variant: 'outline', name: 'this review' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'More actions for this review',
    })
    expect(button).toHaveAttribute('data-variant', 'outline')
  },
}

/** The small trigger for a dense feed row: 24px from md, a tap target on a phone. */
export const SmallForADenseRow: Story = {
  args: { size: 'small' },
  play: async ({ canvasElement }) => {
    const button = trigger(canvasElement)
    expect(button).toHaveAttribute('data-size', 'icon-xs')
    expect(button.className).toContain('max-md:min-h-(--control-touch)')
  },
}

/** Disabled keeps its name, and cannot be opened. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const button = trigger(canvasElement)
    expect(button).toBeDisabled()
    await userEvent.click(button, { pointerEventsCheck: 0 })
    expect(button).toHaveAttribute('aria-expanded', 'false')
  },
}

/** A label that explains why an item is not offered, above a disabled item. */
export const WithLabelAndDisabledItem: Story = {
  render: (args) => (
    <RowActionsMenu {...args}>
      <RowActionsLabel className="text-xs font-normal text-muted-foreground">
        Make another language the fallback to remove this one.
      </RowActionsLabel>
      <RowActionsSeparator />
      <RowActionsItem disabled>Remove language</RowActionsItem>
    </RowActionsMenu>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(trigger(canvasElement))
    const item = await screen.findByRole('menuitem', { name: 'Remove language' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    await closeMenu(canvasElement)
  },
}
