// The Goals page's Active / History switch (UI consistency scan: COLL-11). Two
// links in a named navigation landmark, the current one marked with
// `aria-current`, where it used to be two Buttons that said nothing about which
// view was on. Dark is the default theme; the light variant draws the same row on
// the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { GoalViewTabs } from './goal-view-tabs'

const meta: Meta<typeof GoalViewTabs> = {
  title: 'Goals/GoalViewTabs',
  component: GoalViewTabs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { propertyId: 'property-1', view: 'active' },
}

export default meta
type Story = StoryObj<typeof GoalViewTabs>

export const ActiveView: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'Goal views' })
    // Route views, not a tablist: nothing here swaps a panel in the same document.
    expect(within(canvasElement).queryByRole('tablist')).toBeNull()
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
    expect(within(nav).getByRole('link', { name: 'Active' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'History' })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

export const HistoryView: Story = {
  args: { view: 'history' },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'Goal views' })
    expect(within(nav).getByRole('link', { name: 'History' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Active' })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

/** Each view has an address, so it can be bookmarked and Back steps between them. */
export const EachViewHasAnAddress: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'Goal views' })
    expect(within(nav).getByRole('link', { name: 'Active' })).toHaveAttribute(
      'href',
      '/properties/property-1/goals?view=active',
    )
    expect(within(nav).getByRole('link', { name: 'History' })).toHaveAttribute(
      'href',
      '/properties/property-1/goals?view=history',
    )
  },
}

/** Both links are Tab stops, in order. */
export const KeyboardOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: 'Active' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: 'History' })).toHaveFocus()
  },
}

export const ActiveViewLight: Story = { ...ActiveView, parameters: { theme: 'light' } }
