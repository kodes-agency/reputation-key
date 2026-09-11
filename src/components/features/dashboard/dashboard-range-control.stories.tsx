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
 * of it: whichever rendering the viewport produces has to stay a 44 px target
 * and actually commit a choice (redesign row 13).
 *
 * It branches on the rendering rather than asserting which one appears, as the
 * original did: the storybook browser shares one viewport across story files,
 * so a narrow-viewport parameter is not guaranteed to have taken effect by the
 * time this play function runs.
 */
export const Compact320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvas, args }) => {
    const control = canvas
      .getAllByLabelText('Time range')
      .find((element) => element.getBoundingClientRect().height > 0)!
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)

    if (control.getAttribute('role') === 'combobox') {
      await userEvent.click(control)
      const contentId = control.getAttribute('aria-controls')!
      const content = control.ownerDocument.getElementById(contentId)!
      await userEvent.click(within(content).getByRole('option', { name: '30 days' }))
      await waitFor(() => {
        expect(args.onRangeChange).toHaveBeenCalledWith('30d')
        expect(control).toHaveTextContent('30 days')
      })
      return
    }

    const thirtyDays = within(control).getByRole('button', { name: '30 days' })
    thirtyDays.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(args.onRangeChange).toHaveBeenCalledWith('30d')
      expect(thirtyDays).toHaveAttribute('aria-pressed', 'true')
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
