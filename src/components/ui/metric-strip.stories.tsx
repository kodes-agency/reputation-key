// The metric strip, in both looks and in the states a measure can be in. The
// Storybook Vitest project compiles no Tailwind, so the plays prove structure,
// not geometry: the strip is a named description list, every cell is a term
// followed by its figure, a loading cell keeps its term, and an unavailable
// measure leaves no hollow cell behind.
import type { Meta, StoryObj } from '@storybook/react'
import { Star } from 'lucide-react'
import { expect, within } from 'storybook/test'
import { Card, CardContent, CardHeader, CardTitle } from './card'
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

/**
 * Separate bordered tiles that wrap: for a set of independent measures longer than
 * a row (an import's counts, an analytics summary). Two columns narrow, `columns`
 * from 2xl. A measure with nothing to average yet is a note (`value={null}`), not a
 * sentence set in the figure's 24px type, which wraps to three lines in a tile.
 */
export const Tiles: Story = {
  args: { variant: 'tiles', columns: 3, 'aria-label': 'Response targets' },
  render: (args) => (
    <MetricStrip {...args}>
      <Metric label="Measured cycles">
        <MetricValue value="128" />
      </Metric>
      <Metric label="Currently open">
        <MetricValue value="7" />
      </Metric>
      <Metric label="Target time passed">
        <MetricValue value="2" />
      </Metric>
      <Metric label="Completed within target">
        <MetricValue value="104" />
      </Metric>
      <Metric label="Average time to first handling">
        <MetricValue value={null} detail="Not enough measured data" />
      </Metric>
    </MetricStrip>
  ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('dl')).toHaveAttribute('data-variant', 'tiles')
    expect(cells(canvasElement)).toHaveLength(5)
    expect(cells(canvasElement)[4]).toEqual([
      'Average time to first handling',
      'Not enough measured data',
    ])
  },
}

export const TilesLight: Story = {
  ...Tiles,
  parameters: { theme: 'light' },
}

/** In a card, which is the frame: the cells keep their hairlines and lose their own edge. */
export const Embedded: Story = {
  args: { variant: 'embedded', 'aria-label': 'Google performance' },
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>At a glance</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <MetricStrip {...args}>
          <Metric label="Profile views">
            <MetricValue value="1,204" detail="Up 12% vs the previous 90 days" />
          </Metric>
          <Metric label="Website clicks">
            <MetricValue value="88" detail="No comparable period" />
          </Metric>
          <Metric label="Call clicks">
            <MetricValue value="Not returned" detail="Not applicable or not returned" />
          </Metric>
          <Metric label="Direction requests">
            <MetricValue value="41" detail="Down 3% vs the previous 90 days" />
          </Metric>
        </MetricStrip>
      </CardContent>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('dl')).toHaveAttribute('data-variant', 'embedded')
    expect(cells(canvasElement)).toHaveLength(4)
  },
}

/** A measure with no number says why, in its place, and keeps its term. */
export const NoFigure: Story = {
  args: { variant: 'ruled' },
  render: (args) => (
    <MetricStrip {...args}>
      <Metric label="Average rating">
        <MetricValue value={null} detail="No ratings in this period." />
      </Metric>
      <Metric label="Reviews">
        <MetricValue value="12" detail="Up 4% vs the previous 30 days" />
      </Metric>
    </MetricStrip>
  ),
  play: ({ canvasElement }) => {
    expect(cells(canvasElement)).toEqual([
      ['Average rating', 'No ratings in this period.'],
      ['Reviews', '12Up 4% vs the previous 30 days'],
    ])
  },
}
