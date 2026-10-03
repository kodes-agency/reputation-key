// The badge tones (UI consistency scan: COLL-05). The six looks it always had,
// and four tones for the colour of a state: positive, warn, negative, neutral.
// A status should go through StatusBadge (which adds the tone's icon and keeps
// the raw status token off the screen); a plain tone badge is for a label such
// as a topic's polarity. Dark is the default theme; the light variant renders
// the same row on the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { Badge } from './badge'

const meta: Meta<typeof Badge> = {
  title: 'Patterns/Badge tones',
  component: Badge,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Badge>

const TONES = [
  ['positive', 'Connected'],
  ['warn', 'Needs attention'],
  ['negative', 'Failed'],
  ['neutral', 'Archived'],
] as const

/** Four tones, each on its own tint with its own edge and ink. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map(([tone, label]) => (
        <Badge key={tone} variant={tone}>
          {label}
        </Badge>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const [tone, label] of TONES) {
      expect(canvas.getByText(label)).toHaveAttribute('data-variant', tone)
    }
  },
}

/** The looks it had before the tones, unchanged. */
export const Looks: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Secondary')).toHaveAttribute(
      'data-variant',
      'secondary',
    )
  },
}

/** As a link, a tone steps its edge under the pointer and leaves its fill alone. */
export const AsLink: Story = {
  render: () => (
    <Badge asChild variant="warn" className="min-h-11 px-4 text-sm">
      <a href="#triage">3 items to triage</a>
    </Badge>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: '3 items to triage' })
    expect(link).toHaveAttribute('data-variant', 'warn')
  },
}

export const TonesLight: Story = { ...Tones, parameters: { theme: 'light' } }
