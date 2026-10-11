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

/** The two links of the landmark, by what they open. */
function views(canvasElement: HTMLElement) {
  const nav = within(
    within(canvasElement).getByRole('navigation', { name: 'New goal views' }),
  )
  return {
    links: nav.getAllByRole('link'),
    one: nav.getByRole('link', { name: 'One goal' }),
    several: nav.getByRole('link', { name: 'Several portals' }),
  }
}

export const OneGoal: Story = {
  play: async ({ canvasElement }) => {
    const { links, one, several } = views(canvasElement)
    // Route views, not a tablist: nothing here swaps a panel in the same document.
    expect(within(canvasElement).queryByRole('tablist')).toBeNull()
    expect(links).toEqual([one, several])
    expect(one).toHaveAttribute('aria-current', 'page')
    expect(several).not.toHaveAttribute('aria-current')
  },
}

export const SeveralPortals: Story = {
  args: { view: 'several' },
  play: async ({ canvasElement }) => {
    const { one, several } = views(canvasElement)
    expect(several).toHaveAttribute('aria-current', 'page')
    expect(one).not.toHaveAttribute('aria-current')
  },
}

/** Each view has an address, and the subject a link chose travels with both. */
export const EachViewHasAnAddress: Story = {
  args: { subject: 'portal:lobby' },
  play: async ({ canvasElement }) => {
    const { one, several } = views(canvasElement)
    expect(one).toHaveAttribute('href', `${NEW_GOAL}?subject=portal%3Alobby`)
    expect(several).toHaveAttribute(
      'href',
      `${NEW_GOAL}?subject=portal%3Alobby&mode=several`,
    )
  },
}

/** Both links are Tab stops, in order. */
export const KeyboardOrder: Story = {
  play: async ({ canvasElement }) => {
    const { one, several } = views(canvasElement)
    await userEvent.tab()
    expect(one).toHaveFocus()
    await userEvent.tab()
    expect(several).toHaveFocus()
  },
}

export const OneGoalLight: Story = { ...OneGoal, parameters: { theme: 'light' } }
