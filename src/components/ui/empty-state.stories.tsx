// Roomy and compact empty regions preserve their slot order, recovery and padding.
// Both themes use the app stylesheet and accessibility checks.
import { playInThemes } from '../../../.storybook/play-in-themes'
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
  play: playInThemes(async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const panel = canvasElement.querySelector('[data-slot="empty-state"]')
    expect(getComputedStyle(panel!).paddingTop).toBe('48px')
    expect(getComputedStyle(panel!).paddingBottom).toBe('48px')
    // Not an alert: nothing went wrong.
    expect(panel).not.toHaveAttribute('role')
    expect(canvas.getByText('No portals yet')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'New portal' })).toBeVisible()
  }),
}

/** No results: the recovery is clearing what narrowed the list. */
export const NoResults: Story = {
  args: {
    icon: SearchX,
    title: 'No properties match',
    action: <Button variant="outline">Clear search and filters</Button>,
  },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('button', { name: 'Clear search and filters' }),
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
          Set it in property settings
        </a>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('link', { name: 'Set it in property settings' }),
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
    const panel = canvasElement.querySelector('[data-slot="empty-state"]')!
    expect(getComputedStyle(panel).paddingTop).toBe('24px')
    expect(getComputedStyle(panel).paddingBottom).toBe('24px')
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
  play: playInThemes(),
}

/** The failure tone is an alert; RegionError adds "Try again" to it. */
export const ErrorTone: Story = {
  args: {
    tone: 'error',
    size: 'compact',
    title: 'The preview couldn’t be loaded',
  },
  play: playInThemes(async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toBeVisible()
  }),
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
