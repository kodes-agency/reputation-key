// Dashboard → Google. The report's lifecycle states live beside the section;
// these stories prove the page owns one range and keeps the full report inside
// its 390 px layout.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import type {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from '#/contexts/integration/server/google-performance'
import type {
  PerformanceMetricValue,
  PerformanceSeries,
  PropertyGooglePerformanceReportV1,
} from '#/shared/google-performance-report-contract'
import { PropertyGooglePage } from './property-google-page'

const property = { id: '11111111-1111-4111-8111-111111111111', name: 'Harborline Suites' }

function metric(label: string, value: number): PerformanceMetricValue {
  return {
    label,
    value,
    priorValue: Math.max(0, value - 10),
    deltaPercent: value === 0 ? null : 10,
    availability: 'ready',
    completeDayCount: 30,
    priorCompleteDayCount: 30,
  }
}

const localDates = Array.from({ length: 30 }, (_, index) =>
  new Date(Date.UTC(2026, 7, 12 + index)).toISOString().slice(0, 10),
)

const discoverySeries: readonly PerformanceSeries[] = (
  [
    ['desktop-search', 'Desktop Search', 124],
    ['mobile-search', 'Mobile Search', 221],
    ['desktop-maps', 'Desktop Maps', 147],
    ['mobile-maps', 'Mobile Maps', 248],
  ] as const
).map(([id, label, baseline]) => ({
  id,
  label,
  points: localDates.map((localDate, index) => ({
    localDate,
    value: baseline + index * 3,
    availability: 'returned' as const,
  })),
}))

const actionSeries: readonly PerformanceSeries[] = [
  {
    id: 'website-clicks',
    label: 'Website clicks',
    points: localDates.map((localDate, index) => ({
      localDate,
      value: 18 + (index % 7),
      availability: 'returned' as const,
    })),
  },
]

const readyReport: PropertyGooglePerformanceReportV1 = {
  contractVersion: 1,
  catalogVersion: '2026-08-05',
  sourceLabel: 'Google Business Profile',
  retrievedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  contentExpiresAt: '2030-09-11T16:15:00.000Z',
  contentTtlSeconds: 900,
  authorizationLease: {
    leaseRef: 'v1.performance-30d',
    expiresAt: '2030-09-11T16:00:30.000Z',
    ttlSeconds: 30,
    renewAfterMs: 10_000,
  },
  period: {
    preset: '30d',
    timezone: 'Europe/Sofia',
    currentStartLocalDate: '2026-08-12',
    currentEndLocalDate: '2026-09-10',
    priorStartLocalDate: '2026-07-13',
    priorEndLocalDate: '2026-08-11',
  },
  sourceHealth: {
    state: 'ready',
    providerCheckedThroughLocalDate: '2026-09-10',
    latestReturnedDataLocalDate: '2026-09-10',
    latestCompleteCoreLocalDate: '2026-09-10',
    dataLagDays: 0,
  },
  headlines: {
    totalProfileImpressions: metric('Profile impressions', 4872),
    websiteClicks: metric('Website clicks', 318),
    callClicks: metric('Call clicks', 86),
    directionRequests: metric('Direction requests', 204),
  },
  discoverySeries,
  actionSeries,
  additionalInteractions: [
    metric('Conversations', 0),
    metric('Bookings', 0),
    metric('Menu clicks', 0),
  ],
}

const renewLease = (async () => ({
  ok: true as const,
  lease: readyReport.authorizationLease,
})) as unknown as typeof renewPropertyGooglePerformanceLease

const readyPerformanceFns = {
  getPerformance: (async () => ({
    status: 'ready' as const,
    data: readyReport,
  })) as unknown as typeof getPropertyGooglePerformance,
  renewLease,
}

const unavailablePerformanceFns = {
  getPerformance: (async () => ({
    status: 'unavailable',
    reason: 'disconnected',
    action: 'open_integrations',
  })) as unknown as typeof getPropertyGooglePerformance,
  renewLease,
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
    performanceFns: readyPerformanceFns,
  },
}
export default meta
type Story = StoryObj<typeof PropertyGooglePage>

export const Default: Story = {
  play: async ({ canvas }) => {
    expect(
      canvas.getByRole('heading', { name: 'Google Business Profile', level: 1 }),
    ).toBeVisible()
    expect(canvas.getAllByRole('group', { name: 'Time range' })).toHaveLength(1)
    expect(canvas.queryByLabelText('Performance range')).toBeNull()
    expect(canvas.queryByText(/independent from the Dashboard range/i)).toBeNull()
    expect(canvas.queryByText(/provides up to/)).toBeNull()
    await expect(canvas.findByText('4,872')).resolves.toBeVisible()
  },
}

export const AllTimeStatesGoogleLimit: Story = {
  args: { range: 'all' },
  play: async ({ canvas }) => {
    expect(canvas.getByText('Google provides up to 6 months.')).toBeVisible()
  },
}

export const UnavailableWithCta: Story = {
  args: { performanceFns: unavailablePerformanceFns },
  play: async ({ canvas }) => {
    await expect(
      canvas.findByRole('link', { name: 'Open integrations' }),
    ).resolves.toBeVisible()
  },
}

export const NoProperty: Story = {
  args: { property: null },
  play: async ({ canvas }) => {
    expect(canvas.queryByText('Google Business Profile')).toBeNull()
  },
}

export const Compact390: Story = {
  args: { range: '30d' },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvas }) => {
    await expect(canvas.findByText('4,872')).resolves.toBeVisible()
    const disclosures = canvas.getAllByText('View daily values')
    await userEvent.click(disclosures[0]!)

    const table = canvas.getByRole('table', {
      name: /How people found you daily values/,
    })
    const scroller = table.closest('[data-slot="table-container"]')
    const disclosure = table.closest('details')
    const card = table.closest('[data-slot="card"]')
    if (
      !(table instanceof HTMLTableElement) ||
      !(scroller instanceof HTMLElement) ||
      !(disclosure instanceof HTMLDetailsElement) ||
      !(card instanceof HTMLElement)
    ) {
      throw new Error('Expected the daily-values table inside its card scroller')
    }

    expect(scroller).toHaveClass('w-full', 'overflow-x-auto')
    expect(disclosure).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden')
    expect(card).toHaveClass('min-w-0')

    const dailyTable = within(scroller)
    expect(dailyTable.getByRole('columnheader', { name: 'Mobile Maps' })).toBeVisible()
  },
}
