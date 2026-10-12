// A rating as a number with one star after it, drawn once (UI consistency scan:
// COLL-09). The star is the product's `--rating` gold and is decorative; the
// number is the content and a screen reader hears "stars". Dark is the default
// theme; the light variant renders the same figures on the light surface.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { RatingFigure } from './rating-figure'

const meta: Meta<typeof RatingFigure> = {
  title: 'Patterns/Rating figure',
  component: RatingFigure,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { value: 4.3 },
}

export default meta
type Story = StoryObj<typeof RatingFigure>

/** The number to one decimal, one hidden star, and "stars" for a screen reader. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const figure = canvasElement.querySelector('[data-slot="rating-figure"]')
    expect(figure).toHaveTextContent('4.3stars')
    expect(within(canvasElement).getByText('4.3')).toBeVisible()
    expect(figure?.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    expect(figure?.querySelector('svg')).toHaveClass('text-rating')
  },
}

/** A whole rating keeps its decimal, like the delta that qualifies it. */
export const WholeNumber: Story = {
  args: { value: 4 },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('4.0')).toBeVisible()
  },
}

/** The three sizes: a list cell, a summary strip and a KPI tile's headline. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-4">
      <RatingFigure {...args} size="sm" className="text-sm font-medium" />
      <RatingFigure {...args} size="md" className="text-lg font-semibold" />
      <RatingFigure {...args} size="lg" className="text-3xl font-semibold" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const glyphs = [...canvasElement.querySelectorAll('svg')]
    expect(glyphs).toHaveLength(3)
    expect(glyphs[0]).toHaveClass('size-3.5')
    expect(glyphs[1]).toHaveClass('size-4')
    expect(glyphs[2]).toHaveClass('size-6')
  },
}

export const DefaultLight: Story = { ...Default, parameters: { theme: 'light' } }
export const SizesLight: Story = { ...Sizes, parameters: { theme: 'light' } }
