import { useMemo, useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from '#/contexts/integration/server/google-performance'
import type {
  PerformanceMetricValue,
  PerformanceSeries,
  PropertyGooglePerformanceReportV1,
  PropertyPerformancePreset,
} from '#/shared/google-performance-report-contract'
import { GooglePerformanceSection } from './google-performance-section'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

function metric(
  label: string,
  value: number | null,
  priorValue: number | null,
  availability: PerformanceMetricValue['availability'] = 'ready',
): PerformanceMetricValue {
  return Object.freeze({
    label,
    value,
    priorValue,
    deltaPercent:
      value === null || priorValue === null || priorValue === 0
        ? null
        : ((value - priorValue) / priorValue) * 100,
    availability,
    completeDayCount: 30,
    priorCompleteDayCount: 30,
  })
}

const discoverySeries: readonly PerformanceSeries[] = [
  {
    id: 'desktop-search',
    label: 'Desktop Search',
    points: [
      { localDate: '2026-07-10', value: 124, availability: 'returned' },
      { localDate: '2026-07-11', value: 147, availability: 'returned' },
      { localDate: '2026-07-12', value: 138, availability: 'returned' },
      { localDate: '2026-07-13', value: null, availability: 'unavailable' },
    ],
  },
  {
    id: 'mobile-maps',
    label: 'Mobile Maps',
    points: [
      { localDate: '2026-07-10', value: 221, availability: 'returned' },
      { localDate: '2026-07-11', value: 248, availability: 'returned' },
      { localDate: '2026-07-12', value: 263, availability: 'returned' },
      { localDate: '2026-07-13', value: 239, availability: 'returned' },
    ],
  },
]

const actionSeries: readonly PerformanceSeries[] = [
  {
    id: 'website-clicks',
    label: 'Website clicks',
    points: [
      { localDate: '2026-07-10', value: 18, availability: 'returned' },
      { localDate: '2026-07-11', value: 22, availability: 'returned' },
      { localDate: '2026-07-12', value: 17, availability: 'returned' },
      { localDate: '2026-07-13', value: 26, availability: 'returned' },
    ],
  },
  {
    id: 'call-clicks',
    label: 'Call clicks',
    points: [
      { localDate: '2026-07-10', value: 4, availability: 'returned' },
      { localDate: '2026-07-11', value: 7, availability: 'returned' },
      { localDate: '2026-07-12', value: 5, availability: 'returned' },
      { localDate: '2026-07-13', value: 9, availability: 'returned' },
    ],
  },
]

function report(preset: PropertyPerformancePreset): PropertyGooglePerformanceReportV1 {
  return Object.freeze({
    contractVersion: 1,
    catalogVersion: '2026-08-05',
    sourceLabel: 'Google Business Profile',
    retrievedAt: '2026-08-12T12:20:00.000Z',
    contentExpiresAt: '2030-08-12T12:35:00.000Z',
    contentTtlSeconds: 900,
    authorizationLease: {
      leaseRef: `v1.performance-${preset}`,
      expiresAt: '2030-08-12T12:20:30.000Z',
      ttlSeconds: 30,
      renewAfterMs: 10_000 as const,
    },
    period: {
      preset,
      timezone: 'America/New_York',
      currentStartLocalDate: '2026-07-10',
      currentEndLocalDate: '2026-08-08',
      priorStartLocalDate: '2026-06-10',
      priorEndLocalDate: '2026-07-09',
    },
    sourceHealth: {
      state: 'partial' as const,
      providerCheckedThroughLocalDate: '2026-08-08',
      latestReturnedDataLocalDate: '2026-08-08',
      latestCompleteCoreLocalDate: '2026-08-07',
      dataLagDays: 1,
    },
    headlines: {
      totalProfileImpressions: metric('Profile impressions', 4872, 4310),
      websiteClicks: metric('Website clicks', 318, 284),
      callClicks: metric('Call clicks', 86, 91),
      directionRequests: metric('Direction requests', 204, null, 'partial'),
    },
    discoverySeries,
    actionSeries,
    additionalInteractions: [
      metric('Bookings', 42, 35),
      metric('Conversations', null, null, 'not_applicable_or_not_returned'),
      metric('Menu clicks', 129, 118),
    ],
  })
}

const getReadyPerformance = fn(
  async (input: { data: { preset: PropertyPerformancePreset } }) => ({
    status: 'ready' as const,
    data: report(input.data.preset),
  }),
) as unknown as typeof getPropertyGooglePerformance

const renewLease = fn(async (input: { data: { leaseRef: string } }) => ({
  ok: true as const,
  lease: {
    leaseRef: input.data.leaseRef,
    expiresAt: '2030-08-12T12:20:30.000Z',
    ttlSeconds: 30,
    renewAfterMs: 10_000 as const,
  },
})) as unknown as typeof renewPropertyGooglePerformanceLease

const renewDenied = (async () => ({
  ok: false,
})) as unknown as typeof renewPropertyGooglePerformanceLease

const getNoData = (async (input: { data: { preset: PropertyPerformancePreset } }) => {
  const base = report(input.data.preset)
  return {
    status: 'ready' as const,
    data: Object.freeze({
      ...base,
      sourceHealth: Object.freeze({
        ...base.sourceHealth,
        state: 'no_data' as const,
        latestReturnedDataLocalDate: null,
        latestCompleteCoreLocalDate: null,
        dataLagDays: null,
      }),
      headlines: Object.freeze({
        totalProfileImpressions: metric('Profile impressions', 0, 0),
        websiteClicks: metric('Website clicks', 0, 0),
        callClicks: metric('Call clicks', 0, 0),
        directionRequests: metric('Direction requests', 0, 0),
      }),
      discoverySeries: [],
      actionSeries: [],
      additionalInteractions: [],
    }),
  }
}) as unknown as typeof getPropertyGooglePerformance

const getDisconnected = (async () => ({
  status: 'unavailable',
  reason: 'disconnected',
  action: 'open_integrations',
})) as unknown as typeof getPropertyGooglePerformance

const getProviderError = (async () => ({
  status: 'error',
  errorCode: 'provider_timeout',
  retryable: true,
  retryAfterSeconds: null,
})) as unknown as typeof getPropertyGooglePerformance

const getExpired = (async () => ({
  status: 'ready',
  data: Object.freeze({
    ...report('30d'),
    contentExpiresAt: '2020-08-12T12:35:00.000Z',
  }),
})) as unknown as typeof getPropertyGooglePerformance

const neverResolves = (() =>
  new Promise(() => {})) as unknown as typeof getPropertyGooglePerformance

let resolveDelayedReady: (() => void) | null = null
const getDelayedReady = ((input: { data: { preset: PropertyPerformancePreset } }) =>
  new Promise((resolve) => {
    resolveDelayedReady = () =>
      resolve({
        status: 'ready' as const,
        data: report(input.data.preset),
      })
  })) as unknown as typeof getPropertyGooglePerformance

function ControlledPerformanceSection(
  props: ComponentProps<typeof GooglePerformanceSection>,
) {
  const [preset, setPreset] = useState(props.preset)
  return (
    <GooglePerformanceSection
      {...props}
      preset={preset}
      onPresetChange={(nextPreset) => {
        props.onPresetChange(nextPreset)
        setPreset(nextPreset)
      }}
    />
  )
}

function RefreshFailurePerformanceSection(
  props: ComponentProps<typeof GooglePerformanceSection>,
) {
  const serverFns = useMemo(() => {
    let calls = 0
    const getPerformance = (async (input: {
      data: { preset: PropertyPerformancePreset }
    }) => {
      calls += 1
      if (calls === 1) {
        return {
          status: 'ready' as const,
          data: report(input.data.preset),
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 25))
      return {
        status: 'error' as const,
        errorCode: 'provider_timeout' as const,
        retryable: true,
        retryAfterSeconds: null,
      }
    }) as unknown as typeof getPropertyGooglePerformance

    return {
      getPerformance,
      renewLease,
    }
  }, [])

  return <ControlledPerformanceSection {...props} serverFns={serverFns} />
}

const meta = {
  title: 'Property/GooglePerformanceSection',
  component: GooglePerformanceSection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: (args) => <ControlledPerformanceSection {...args} />,
  args: {
    propertyId: PROPERTY_ID,
    preset: '30d',
    onPresetChange: fn(),
    serverFns: {
      getPerformance: getReadyPerformance,
      renewLease,
    },
  },
} satisfies Meta<typeof GooglePerformanceSection>

export default meta
type Story = StoryObj<typeof meta>

export const LiveReport: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.findByRole('heading', { name: 'Google Business Profile performance' }),
    ).resolves.toBeVisible()
    await expect(canvas.findByText('4,872')).resolves.toBeVisible()
    await expect(canvas.getByText('Source: Google Business Profile')).toBeVisible()
    const sevenDays = canvas.getByRole('button', { name: '7 days' })
    sevenDays.focus()
    await userEvent.keyboard('{Enter}')
    await expect(sevenDays).toHaveAttribute('aria-pressed', 'true')
    await expect(getReadyPerformance).toHaveBeenCalled()
  },
}

export const Loading: Story = {
  args: {
    serverFns: { getPerformance: neverResolves, renewLease },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.findByLabelText('Loading Google Business Profile performance'),
    ).resolves.toBeVisible()
  },
}

export const PropertyDisconnected: Story = {
  args: {
    serverFns: { getPerformance: getDisconnected, renewLease },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.findByText('Performance is not available for this property'),
    ).resolves.toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open integrations' })).toBeVisible()
  },
}

export const ProviderUnavailable: Story = {
  args: {
    serverFns: { getPerformance: getProviderError, renewLease },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.findByText('Performance report unavailable'),
    ).resolves.toBeVisible()
    await expect(canvas.getByText(/too long to respond/i)).toBeVisible()
  },
}

export const RefreshFailureRetainsReport: Story = {
  render: (args) => <RefreshFailurePerformanceSection {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.findByText('4,872')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh' }))
    await expect(
      canvas.findByText('Showing the last successful report'),
    ).resolves.toBeVisible()
    await expect(canvas.getByText('4,872')).toBeVisible()
  },
}

export const ExpiredContent: Story = {
  args: {
    serverFns: { getPerformance: getExpired, renewLease },
  },
  play: async ({ canvas }) => {
    await expect(canvas.findByText('Report expired')).resolves.toBeVisible()
    await expect(canvas.queryByText('4,872')).not.toBeInTheDocument()
  },
}

export const NoDataAndTrueZeroes: Story = {
  args: {
    serverFns: { getPerformance: getNoData, renewLease },
  },
  play: async ({ canvas }) => {
    await expect(canvas.findByText('No data returned')).resolves.toBeVisible()
    await expect(canvas.getAllByText('0')).toHaveLength(4)
    await expect(canvas.getAllByText('No comparable period')).toHaveLength(4)
    await expect(
      canvas.getAllByText('Google returned no daily values for this period.'),
    ).toHaveLength(2)
    await expect(canvas.queryByText('Additional interactions')).not.toBeInTheDocument()
  },
}

export const LeaseDenied: Story = {
  args: {
    serverFns: { getPerformance: getReadyPerformance, renewLease: renewDenied },
  },
  play: async ({ canvas }) => {
    await expect(canvas.findByText('Authorization changed')).resolves.toBeVisible()
    await expect(canvas.queryByText('4,872')).not.toBeInTheDocument()
  },
}

export const PageLifecycleClearsContent: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.findByText('4,872')).resolves.toBeVisible()
    window.dispatchEvent(new Event('pagehide'))
    await expect(canvas.findByText('Authorization changed')).resolves.toBeVisible()
    await expect(canvas.queryByText('4,872')).not.toBeInTheDocument()
  },
}

export const LateResponseAfterPagehideIsDiscarded: Story = {
  args: {
    serverFns: { getPerformance: getDelayedReady, renewLease },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.findByLabelText('Loading Google Business Profile performance'),
    ).resolves.toBeVisible()
    window.dispatchEvent(new Event('pagehide'))
    await expect(canvas.findByText('Authorization changed')).resolves.toBeVisible()
    resolveDelayedReady?.()
    resolveDelayedReady = null
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(canvas.queryByText('4,872')).not.toBeInTheDocument()
  },
}

export const LightTheme: Story = {
  parameters: { theme: 'light' },
}

export const Compact320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvas }) => {
    const range = canvas
      .getAllByLabelText('Performance range')
      .find((element) => element.getBoundingClientRect().height > 0)!
    await expect(range.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    if (range.getAttribute('role') === 'combobox') {
      await userEvent.click(range)
      const ownerDocument = range.ownerDocument
      const contentId = range.getAttribute('aria-controls')
      expect(contentId).not.toBeNull()
      if (contentId === null) return
      const content = ownerDocument.getElementById(contentId)
      expect(content).not.toBeNull()
      if (content === null) return
      await userEvent.click(within(content).getByRole('option', { name: '7 days' }))
      await waitFor(() => {
        expect(range).toHaveTextContent('7 days')
        expect(ownerDocument.querySelector('[role="listbox"]')).toBeNull()
        expect(ownerDocument.body.style.pointerEvents).toBe('')
      })
      return
    }
    const sevenDays = range.querySelector<HTMLButtonElement>('button')!
    sevenDays.focus()
    await userEvent.keyboard('{Enter}')
    await expect(sevenDays).toHaveAttribute('aria-pressed', 'true')
  },
}

export const Compact390: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}
