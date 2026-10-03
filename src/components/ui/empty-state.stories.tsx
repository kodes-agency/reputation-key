// The dashed "nothing here" panel in the places the product draws it: a roomy
// first-run or no-results panel for a page, and a compact slot inside a list, a
// card, a rail or a dialog. Dark is the default theme; the light variants render
// the same panels on the light surface (axe runs on both). The Storybook Vitest
// project compiles no Tailwind, so the plays prove structure and the slot order,
// not geometry; the size and tone recipes are pinned by `empty-state.test.ts`.
import type { Meta, StoryObj } from '@storybook/react'
import { Globe, MapPin, SearchX } from 'lucide-react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from './button'
import { EmptyState } from './empty-state'

const meta: Meta<typeof EmptyState> = {
  title: 'Patterns/Empty state',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { icon: Globe, title: 'No portals yet' },
}

export default meta
type Story = StoryObj<typeof EmptyState>

/** First run: the title, one sentence of why, and the way to start. */
export const FirstRun: Story = {
  args: {
    description: 'Create a portal to set up a guest-facing page with links.',
    action: <Button>New portal</Button>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const panel = canvasElement.querySelector('[data-slot="empty-state"]')
    expect(panel?.className).toContain('py-12')
    // Not an alert: nothing went wrong.
    expect(panel).not.toHaveAttribute('role')
    expect(canvas.getByText('No portals yet')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'New portal' })).toBeVisible()
  },
}

/** No results: the recovery is clearing what narrowed the list. */
export const NoResults: Story = {
  args: {
    icon: SearchX,
    title: 'No properties match',
    action: <Button variant="outline">Clear search and filter</Button>,
  },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Clear search and filter' }),
    ).toBeVisible()
  },
}

/** A title alone, when there is nothing to say and nothing to do. */
export const TitleOnly: Story = {
  args: { title: 'No active goals' },
  play: async ({ canvasElement }) => {
    // The icon disc and the title are all there is.
    expect(canvasElement.querySelectorAll('[data-slot="empty-state"] p')).toHaveLength(1)
    expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** The description is a node, so a sentence can carry a link. */
export const DescriptionWithLink: Story = {
  args: {
    title: 'Set the public display name first',
    description: (
      <>
        The look is the Property’s public display name dressed in its colours.{' '}
        <a href="#settings" className="font-medium underline underline-offset-4">
          Set it in Property settings
        </a>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('link', { name: 'Set it in Property settings' }),
    ).toBeVisible()
  },
}

/** A slot inside a list, a rail or a dialog: the same panel at a smaller size. */
export const Compact: Story = {
  args: {
    size: 'compact',
    icon: MapPin,
    title: 'No portals in this group yet',
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-slot="empty-state"]')?.className).toContain(
      'py-6',
    )
  },
}

/** Compact with a way forward. */
export const CompactWithAction: Story = {
  args: {
    size: 'compact',
    title: 'No goal for this group yet',
    description: 'A goal is a monthly target the group’s portals share.',
    action: (
      <Button variant="outline" size="sm">
        Set a goal
      </Button>
    ),
  },
}

/** The failure tone is an alert; RegionError adds "Try again" to it. */
export const ErrorTone: Story = {
  args: {
    tone: 'error',
    size: 'compact',
    title: 'The preview couldn’t be loaded',
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toBeVisible()
  },
}

/** The action is an ordinary control: it is reachable and does its job. */
export const ActionIsReachable: Story = {
  args: { action: <Button onClick={fn()}>New portal</Button> },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'New portal' })
    await userEvent.tab()
    expect(button).toHaveFocus()
  },
}

export const FirstRunLight: Story = {
  ...FirstRun,
  parameters: { theme: 'light' },
}

export const CompactLight: Story = {
  ...CompactWithAction,
  parameters: { theme: 'light' },
}

export const ErrorToneLight: Story = {
  ...ErrorTone,
  parameters: { theme: 'light' },
}
