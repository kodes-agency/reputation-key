// A property's AI state for a role that cannot change it: a PropertyManager reads
// whether AI is on and that an account admin decides, with no consent controls.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { MerchantAiReadOnlyCard } from './merchant-ai-read-only-card'

const meta = {
  title: 'Settings/MerchantAiReadOnlyCard',
  component: MerchantAiReadOnlyCard,
  tags: ['autodocs'],
  args: { propertyName: 'Harbor & Pine — A very long property name for narrow screens' },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MerchantAiReadOnlyCard>

export default meta
type Story = StoryObj<typeof meta>

const LOCK_SENTENCE = 'An account admin decides whether AI is on.'

export const On: Story = {
  args: { state: 'on' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'AI features' })).toBeVisible()
    expect(canvas.getByText(/^AI is on for /)).toBeVisible()
    expect(canvas.getByText('On')).toBeVisible()
    expect(canvas.getByText(LOCK_SENTENCE)).toBeVisible()
    expect(canvas.queryByRole('button')).toBeNull()
  },
}

export const Off: Story = {
  args: { state: 'off' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/^AI is off for /)).toBeVisible()
    expect(canvas.getByText('Off')).toBeVisible()
    expect(canvas.getByText(LOCK_SENTENCE)).toBeVisible()
    expect(canvas.queryByRole('button')).toBeNull()
  },
}

export const Checking: Story = {
  args: { state: 'checking' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Checking whether AI is on…')).toBeVisible()
    expect(canvas.getByText(LOCK_SENTENCE)).toBeVisible()
  },
}

export const Unavailable: Story = {
  args: { state: 'unavailable' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/could not be checked/)).toBeVisible()
    expect(canvas.queryByText('On')).toBeNull()
    expect(canvas.queryByText('Off')).toBeNull()
    expect(canvas.getByText(LOCK_SENTENCE)).toBeVisible()
  },
}
