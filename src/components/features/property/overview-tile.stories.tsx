// The caption under an Overview tile's figure: "in the last 30 days · Up 18% vs
// the previous 30 days". The dot between the two has to behave: on one line it
// stands between them, and when the change drops to its own line it must not be
// left dangling at the end of the line above. The two stories show both widths;
// the Vitest story runner compiles no Tailwind, so where the dot and the baseline
// land is measured against Storybook proper, in
// `e2e/storybook-metrics/overview-tile-caption.metrics.ts`
// (`pnpm test:storybook:metrics`). What a reader and a screen reader get is
// checked here.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { MetricDelta } from '#/components/ui/metric-delta'
import { TileCaption } from './overview-tile'

const meta: Meta<typeof TileCaption> = {
  title: 'Property/OverviewTileCaption',
  component: TileCaption,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    caption: '4.3 over the last 30 days',
    detail: <MetricDelta value={0.2} comparisonLabel="vs the previous 30 days" />,
  },
}

export default meta
type Story = StoryObj<typeof TileCaption>

function widthFrame(widthPx: number): NonNullable<Story['decorators']> {
  return [
    (Story) => (
      <div style={{ width: widthPx }} className="text-sm text-muted-foreground">
        <Story />
      </div>
    ),
  ]
}

/** What both widths say: the caption, a dot a screen reader skips, then the change. */
function expectCaption(canvasElement: HTMLElement): void {
  const caption = canvasElement.querySelector('[data-slot="tile-caption"]')
  expect(caption).toHaveTextContent(
    '4.3 over the last 30 days · Up 0.2 vs the previous 30 days',
  )
  expect(caption?.querySelector('[aria-hidden="true"]')).toHaveTextContent('·')
}

/** Roomy: the change shares the caption's line and the dot stands between them. */
export const SharesALine: Story = {
  decorators: widthFrame(480),
  play: async ({ canvasElement }) => {
    expectCaption(canvasElement)
  },
}

/** Narrow: the change drops to its own line and takes no dot with it. */
export const DropsToItsOwnLine: Story = {
  decorators: widthFrame(190),
  play: async ({ canvasElement }) => {
    expectCaption(canvasElement)
  },
}
