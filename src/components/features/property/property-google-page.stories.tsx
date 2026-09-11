// Dashboard → Google. The report's own states are covered by
// `google-performance-section.stories.tsx`; these cover what the page adds —
// one range control instead of two, and the limit note when the chosen range
// reaches past what Google provides (redesign rows 6, 7b).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import type {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from '#/contexts/integration/server/google-performance'
import { PropertyGooglePage } from './property-google-page'

const property = { id: '11111111-1111-4111-8111-111111111111', name: 'Harborline Suites' }

const performanceFns = {
  getPerformance: (async () => ({
    status: 'unavailable',
    reason: 'integration_unavailable',
    action: null,
  })) as unknown as typeof getPropertyGooglePerformance,
  renewLease: (async () => ({
    ok: false,
  })) as unknown as typeof renewPropertyGooglePerformanceLease,
}

const meta: Meta<typeof PropertyGooglePage> = {
  title: 'Property/PropertyGooglePage',
  component: PropertyGooglePage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    property,
    propertyId: property.id,
    range: '90d',
    onRangeChange: () => {},
    performanceFns,
  },
}
export default meta
type Story = StoryObj<typeof PropertyGooglePage>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('heading', { name: 'Google Business Profile', level: 1 }),
    ).toBeVisible()
    // Exactly one range control on the page — the second picker is gone, and so
    // is the sentence that had to apologise for it.
    expect(canvas.getAllByRole('group', { name: 'Time range' })).toHaveLength(1)
    expect(canvas.queryByLabelText('Performance range')).toBeNull()
    expect(canvas.queryByText(/independent from the Dashboard range/i)).toBeNull()
    // Within Google's six-month memory there is nothing to explain.
    expect(canvas.queryByText(/provides up to/)).toBeNull()
  },
}

export const AllTimeStatesGoogleLimit: Story = {
  args: { range: 'all' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Google provides up to 6 months.')).toBeVisible()
  },
}

export const NoProperty: Story = {
  args: { property: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Google Business Profile')).toBeNull()
  },
}

export const Compact390: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}
