// The owner disc: initials in a 20 px disc, or a person glyph when a name has
// none to draw. The Storybook Vitest project compiles no Tailwind, so the plays
// assert what is emitted (text, the two glyphs, the class tokens per tone), not
// what a browser paints. The mark is decoration: the person's name is always
// beside it, so it must never reach the accessibility tree.
import type { Meta, StoryObj } from '@storybook/react'
import { expect } from 'storybook/test'
import { OwnerDisc } from './owner-disc'

const meta: Meta<typeof OwnerDisc> = {
  title: 'UI/Owner Disc',
  component: OwnerDisc,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { initials: 'GH', tone: 'neutral' },
}

export default meta
type Story = StoryObj<typeof OwnerDisc>

export const Neutral: Story = {
  play: async ({ canvasElement }) => {
    const disc = canvasElement.querySelector('[data-slot="owner-disc"]')
    expect(disc).toHaveTextContent('GH')
    expect(disc).toHaveAttribute('aria-hidden', 'true')
    expect(disc?.getAttribute('class')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['bg-border', 'text-foreground', 'rounded-full', 'size-5']),
    )
  },
}

export const Accent: Story = {
  args: { tone: 'accent' },
  play: async ({ canvasElement }) => {
    const classes = canvasElement
      .querySelector('[data-slot="owner-disc"]')
      ?.getAttribute('class')
      ?.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['bg-accent', 'text-(--accent)']))
    expect(classes).not.toContain('bg-border')
  },
}

/** Nobody holds it: a plain person, and no disc. */
export const Unassigned: Story = {
  args: { initials: null, isAssigned: false },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-slot="owner-disc"]')).toBeNull()
    expect(canvasElement.querySelector('svg.lucide-user-round')).not.toBeNull()
    expect(canvasElement.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  },
}

/** Someone holds it, but their name has no letter to draw: the checked person. */
export const AssignedWithoutInitials: Story = {
  args: { initials: null, isAssigned: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('svg.lucide-user-round-check')).not.toBeNull()
  },
}
