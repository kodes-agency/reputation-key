import type { Meta, StoryObj } from '@storybook/react-vite'
import { AvailabilityLine } from './availability-line'

const meta = {
  title: 'Dashboard/AvailabilityLine',
  component: AvailabilityLine,
  tags: ['autodocs'],
  args: {
    state: 'ready',
    dataThrough: new Date('2026-08-25T10:15:00.000Z'),
    reason: null,
    locale: 'en-GB',
    timeZone: 'UTC',
  },
} satisfies Meta<typeof AvailabilityLine>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const Updating: Story = {
  args: {
    state: 'updating',
    dataThrough: null,
    reason: 'consumer_receipt_pending',
  },
}

export const InsufficientData: Story = {
  args: {
    state: 'insufficient_data',
    dataThrough: null,
  },
}

export const TemporarilyUnavailable: Story = {
  args: {
    state: 'temporarily_unavailable',
    dataThrough: null,
    reason: 'projection_missing',
  },
}
