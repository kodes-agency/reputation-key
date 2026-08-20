import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent } from 'storybook/test'
import type { PerformanceSeries } from '#/shared/google-performance-report-contract'
import { GooglePerformanceChart } from './google-performance-chart'

const series: readonly PerformanceSeries[] = [
  {
    id: 'desktop-search',
    label: 'Desktop Search',
    points: [
      { localDate: '2026-08-01', value: 128, availability: 'returned' },
      { localDate: '2026-08-02', value: 152, availability: 'returned' },
      { localDate: '2026-08-03', value: null, availability: 'unavailable' },
      { localDate: '2026-08-04', value: 171, availability: 'returned' },
    ],
  },
  {
    id: 'mobile-maps',
    label: 'Mobile Maps',
    points: [
      { localDate: '2026-08-01', value: 244, availability: 'returned' },
      { localDate: '2026-08-02', value: 279, availability: 'returned' },
      { localDate: '2026-08-03', value: 263, availability: 'returned' },
      { localDate: '2026-08-04', value: 301, availability: 'returned' },
    ],
  },
]

const longLabelSeries: readonly PerformanceSeries[] = series.map((item) => ({
  ...item,
  label: `${item.label} — exceptionally long translated reporting label`,
}))

const meta = {
  title: 'Property/GooglePerformanceChart',
  component: GooglePerformanceChart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    title: 'How people found you',
    description: 'Search and Maps profile impressions by device.',
    series,
  },
} satisfies Meta<typeof GooglePerformanceChart>

export default meta
type Story = StoryObj<typeof meta>

export const WithDailyValues: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('figure', { name: 'How people found you' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', { name: 'How people found you' }),
    ).toBeVisible()
    const disclosure = canvas.getByText('View daily values')
    await userEvent.click(disclosure)
    await expect(disclosure).toHaveFocus()
    await expect(canvas.getByRole('table')).toBeVisible()
    await expect(canvas.getByText('Not returned')).toBeVisible()
  },
}

export const NoReturnedValues: Story = {
  args: { series: [] },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText('Google returned no daily values for this period.'),
    ).toBeVisible()
  },
}

export const LongLabelsAt320: Story = {
  args: { series: longLabelSeries },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText('View daily values'))
    await expect(
      canvas.getAllByRole('columnheader', {
        name: /exceptionally long translated reporting label/,
      }),
    ).toHaveLength(2)
  },
}

export const Zoom200Percent: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: '50%', zoom: 2 }}>
        <Story />
      </div>
    ),
  ],
}
