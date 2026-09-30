// The metric strip, in both looks and in the states a measure can be in. The
// Storybook Vitest project compiles no Tailwind, so the plays prove structure,
// not geometry: the strip is a named description list, every cell is a term
// followed by its figure, a loading cell keeps its term, and an unavailable
// measure leaves no hollow cell behind.
import type { Meta, StoryObj } from '@storybook/react'
import { Star } from 'lucide-react'
import { expect, within } from 'storybook/test'
import { Metric, MetricStrip, MetricValue } from './metric-strip'

const meta: Meta<typeof MetricStrip> = {
  title: 'UI/Metric Strip',
  component: MetricStrip,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { 'aria-label': 'Portal results' },
}

export default meta
type Story = StoryObj<typeof MetricStrip>

/** Term, then figure, in cell order. */
function cells(canvasElement: HTMLElement): ReadonlyArray<readonly [string, string]> {
  return [...canvasElement.querySelectorAll('dl > div')].map((cell) => [
    cell.querySelector('dt')?.textContent ?? '',
    cell.querySelector('dd')?.textContent ?? '',
  ])
}

export const Ruled: Story = {
  args: { variant: 'ruled' },
  render: (args) => (
    <MetricStrip {...args}>
      <Metric label="Qualified scans">
        <MetricValue value="412" detail="+18 vs the 90 days before" />
      </Metric>
      <Metric label="Private ratings">
        <MetricValue value="118" detail="29% of scans" />
      </Metric>
      <Metric label="Average private rating">
        <MetricValue
          value={
            <span className="inline-flex items-center gap-1.5">
              4.4
              <Star className="size-3.5 fill-current text-rating" aria-hidden="true" />
              <span className="sr-only">stars</span>
            </span>
          }
          detail="from 118"
        />
      </Metric>
      <Metric label="Guests who opened Google">
        <MetricValue value="64" detail="16% of scans" />
      </Metric>
      <Metric label="Private notes">
        <MetricValue value="9" detail="2 waiting in Inbox" />
      </Metric>
    </MetricStrip>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByLabelText('Portal results').tagName).toBe('DL')
    expect(cells(canvasElement).map(([term]) => term)).toEqual([
      'Qualified scans',
      'Private ratings',
      'Average private rating',
      'Guests who opened Google',
      'Private notes',
    ])
    // The figure comes before its context, and the star is decoration.
    expect(cells(canvasElement)[2]?.[1]).toBe('4.4starsfrom 118')
    expect(canvasElement.querySelector('dl')).toHaveAttribute('data-variant', 'ruled')
  },
}

export const Boxed: Story = {
  render: (args) => (
    <MetricStrip {...args}>
      <Metric label="Average rating">
        <MetricValue value="4.6" detail="across 1,284 reviews, all-time" />
      </Metric>
      <Metric label="Needs attention">
        <MetricValue value="3" detail="in 2 properties" />
      </Metric>
      <Metric label="Setup to finish">
        <MetricValue value="0" detail="All set up" />
      </Metric>
    </MetricStrip>
  ),
  play: async ({ canvasElement }) => {
    expect(cells(canvasElement)).toHaveLength(3)
    expect(canvasElement.querySelector('dl')).toHaveAttribute('data-variant', 'boxed')
  },
}

/** A loading cell keeps its term, an unavailable one is not drawn at all. */
export const LoadingAndUnavailable: Story = {
  args: { variant: 'ruled' },
  render: (args) => (
    <MetricStrip {...args}>
      <Metric label="Qualified scans" state="loading">
        <MetricValue value="never shown" />
      </Metric>
      <Metric label="Private ratings" state="unavailable">
        <MetricValue value="never shown" />
      </Metric>
      <Metric label="Private notes">
        <MetricValue value="9" />
      </Metric>
    </MetricStrip>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Qualified scans')).toBeInTheDocument()
    expect(canvas.queryByText('Private ratings')).toBeNull()
    expect(canvas.queryByText('never shown')).toBeNull()
    expect(cells(canvasElement)).toEqual([
      ['Qualified scans', ''],
      ['Private notes', '9'],
    ])
  },
}
