import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent } from 'storybook/test'
import { TimeRangePicker } from './time-range-picker'

const meta = {
  title: 'Dashboard/TimeRangePicker',
  component: TimeRangePicker,
  tags: ['autodocs'],
  args: {
    timeRange: '30d',
    onChange: fn(),
  },
} satisfies Meta<typeof TimeRangePicker>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await expect(canvas.getByRole('button', { name: '30 Days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(canvas.getByRole('button', { name: 'All Time' }))
    await expect(args.onChange).toHaveBeenCalledWith('all')
  },
}
