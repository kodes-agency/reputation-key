import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withPermissions,
} from '../../../../../.storybook/AuthedRouterDecorator'
import { PropertyGuestVoicePage } from './property-guest-voice-page'
import { HAMPTON_READ } from './guest-voice-fixtures-check-in'

const meta = {
  title: 'Property/PropertyGuestVoicePage',
  component: PropertyGuestVoicePage,
  tags: ['autodocs'],
  decorators: [AuthedRouterDecorator],
  parameters: {
    layout: 'padded',
    viewport: { defaultViewport: 'desktopManager' },
  },
  args: {
    propertyId: '11111111-1111-4111-8111-111111111111',
    propertyName: 'Harbour House Hotel',
    range: 'auto',
    onRangeChange: fn(),
  },
} satisfies Meta<typeof PropertyGuestVoicePage>

export default meta
type Story = StoryObj<typeof meta>

export const AnalysisOff: Story = {
  args: {
    state: 'disabled',
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('AI analysis is off for this property')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Turn on AI analysis' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/properties\/[^/]+\/settings\/ai$/),
    )
  },
}

export const AnalysisOffForMember: Story = {
  ...AnalysisOff,
  decorators: [withPermissions(['property.read', 'dashboard.read'])],
  play: async ({ canvas }) => {
    expect(await canvas.findByText(/An account admin can enable it/)).toBeVisible()
    expect(
      canvas.queryByRole('link', { name: 'Turn on AI analysis' }),
    ).not.toBeInTheDocument()
  },
}

/** The next range is being read: the page stays, dimmed, and its range control with it. */
export const ReadingNextRange: Story = {
  args: { busy: true, v2: { read: HAMPTON_READ } },
  play: async ({ canvas, canvasElement }) => {
    expect(await canvas.findByRole('heading', { name: 'Guest voice' })).toBeVisible()
    expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
  },
}

export const Preparing: Story = {
  args: {
    state: 'preparing',
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Guest voice is being prepared')).toBeVisible()
    expect(
      canvas.getByText(/Topics appear as soon as there is enough review evidence/),
    ).toBeVisible()
  },
}
