import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { DashboardRangeControl, RangeLimitNote } from './dashboard-range-control'
import type { DashboardRange } from '#/shared/dashboard-range'

function ControlledRange({
  initial,
  onRangeChange,
}: Readonly<{
  initial: DashboardRange
  onRangeChange: (range: DashboardRange) => void
}>) {
  const [range, setRange] = useState(initial)
  return (
    <DashboardRangeControl
      range={range}
      onRangeChange={(next) => {
        onRangeChange(next)
        setRange(next)
      }}
    />
  )
}

const meta = {
  title: 'Dashboard/DashboardRangeControl',
  component: DashboardRangeControl,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { range: '90d', onRangeChange: fn() },
  render: (args) => (
    <ControlledRange initial={args.range} onRangeChange={args.onRangeChange} />
  ),
} satisfies Meta<typeof DashboardRangeControl>

export default meta
type Story = StoryObj<typeof meta>

export const FourPresets: Story = {
  play: async ({ canvas, args }) => {
    const group = canvas.getByRole('group', { name: 'Time range' })
    for (const label of ['30 days', '90 days', '6 months', 'All time']) {
      expect(within(group).getByRole('button', { name: label })).toBeVisible()
    }
    expect(within(group).getByRole('button', { name: '90 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(group).getByRole('button', { name: '6 months' }))
    expect(args.onRangeChange).toHaveBeenCalledWith('180d')
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: '6 months' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
  },
}

/**
 * Carried over from the Google section's story when the range control moved out
 * of it: on a narrow screen the control collapses to a Select, and it has to
 * stay a 44 px target and actually commit a choice (redesign row 13).
 */
export const Compact320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvas, args }) => {
    const trigger = canvas
      .getAllByLabelText('Time range')
      .find((element) => element.getBoundingClientRect().height > 0)!
    expect(trigger.getAttribute('role')).toBe('combobox')
    expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)

    await userEvent.click(trigger)
    const contentId = trigger.getAttribute('aria-controls')!
    const content = trigger.ownerDocument.getElementById(contentId)!
    await userEvent.click(within(content).getByRole('option', { name: '30 days' }))
    await waitFor(() => {
      expect(args.onRangeChange).toHaveBeenCalledWith('30d')
      expect(trigger).toHaveTextContent('30 days')
    })
  },
}

export const ShortMemorySourceStatesItsLimit: StoryObj = {
  render: () => <RangeLimitNote range="all" limit="180d" source="Google" />,
  play: async ({ canvas }) => {
    await expect(
      canvas.findByText('Google provides up to 6 months.'),
    ).resolves.toBeVisible()
  },
}

export const SourceReachesTheWholeRange: StoryObj = {
  render: () => <RangeLimitNote range="90d" limit="180d" source="Google" />,
  play: async ({ canvas }) => {
    // Within the limit there is nothing to say, so nothing is said.
    expect(canvas.queryByText(/provides up to/)).not.toBeInTheDocument()
  },
}
