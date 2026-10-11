// The New goal page's One goal / Several portals switch. Two links in a named
// navigation landmark, the open one marked with `aria-current`; the table is
// the same route under `?mode=several`. Dark is the default theme; the light
// variant draws the same row on the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { GoalNewTabs } from './goal-new-tabs'

const meta: Meta<typeof GoalNewTabs> = {
  title: 'Goals/GoalNewTabs',
  component: GoalNewTabs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { propertyId: 'property-1', view: 'one' },
}

export default meta
type Story = StoryObj<typeof GoalNewTabs>

const NEW_GOAL = '/properties/property-1/goals/new'

export const OneGoal: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'New goal views' })
    // Route views, not a tablist: nothing here swaps a panel in the same document.
    expect(within(canvasElement).queryByRole('tablist')).toBeNull()
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
    expect(within(nav).getByRole('link', { name: 'One goal' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(nav).getByRole('link', { name: 'Several portals' }),
    ).not.toHaveAttribute('aria-current')
  },
}

export const SeveralPortals: Story = {
  args: { view: 'several' },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'New goal views' })
    expect(within(nav).getByRole('link', { name: 'Several portals' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'One goal' })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

/** Each view has an address, and the subject a link chose travels with both. */
export const EachViewHasAnAddress: Story = {
  args: { subject: 'portal:lobby' },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', { name: 'New goal views' })
    expect(within(nav).getByRole('link', { name: 'One goal' })).toHaveAttribute(
      'href',
      `${NEW_GOAL}?subject=portal%3Alobby`,
    )
    expect(within(nav).getByRole('link', { name: 'Several portals' })).toHaveAttribute(
      'href',
      `${NEW_GOAL}?subject=portal%3Alobby&mode=several`,
    )
  },
}

/** Both links are Tab stops, in order. */
export const KeyboardOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: 'One goal' })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('link', { name: 'Several portals' })).toHaveFocus()
  },
}

export const OneGoalLight: Story = { ...OneGoal, parameters: { theme: 'light' } }
