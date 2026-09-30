import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import type {
  PortalAnalyticsData,
  PortalMetricEvidence,
} from '#/contexts/reporting/application/public-api'
import { PortalAnalyticsContent } from './portal-analytics-content'

const COMPUTED_AT = new Date('2026-09-30T09:00:00.000Z')

function evidence(overrides: Partial<PortalMetricEvidence> = {}): PortalMetricEvidence {
  return {
    definitionVersionId: 'story-version',
    state: 'ready',
    verifiedThrough: COMPUTED_AT,
    latestActivity: COMPUTED_AT,
    computedAt: COMPUTED_AT,
    completeness: 1,
    availabilityReason: null,
    correctionHead: null,
    sampleCount: 0,
    ...overrides,
  }
}

function count(value: number, priorValue: number | null, trend: number | null) {
  return { value, priorValue, trend, evidence: evidence({ sampleCount: value }) }
}

const healthy: PortalAnalyticsData = {
  period: {
    startAt: new Date('2026-08-31T00:00:00.000Z'),
    endAt: COMPUTED_AT,
    timezone: 'Europe/Sofia',
  },
  qualifiedScansSince: new Date('2026-08-01T00:00:00.000Z'),
  lifetimeReconciliation: null,
  kpis: {
    scans: count(200, 160, 25),
    ratings: count(50, 40, 25),
    avgRating: {
      value: 4.6,
      priorValue: 4.4,
      comparison: 0.2,
      sampleCount: 50,
      priorSampleCount: 40,
      evidence: evidence({ sampleCount: 50 }),
    },
    feedback: count(9, 6, 50),
    googleOpens: count(10, 8, 25),
  },
  engagementFunnel: { qualifiedScans: 200, ratings: 50, googleOpens: 10 },
  ratingDistribution: [
    { stars: 1, count: 1 },
    { stars: 2, count: 2 },
    { stars: 3, count: 4 },
    { stars: 4, count: 13 },
    { stars: 5, count: 30 },
  ],
  ratingTrend: [
    { date: '2026-09-01', avgRating: 4.4 },
    { date: '2026-09-02', avgRating: 4.7 },
  ],
  responseIntegrity: {
    accepted: 50,
    filteredAutomatically: 0,
    underReview: 0,
    total: 50,
  },
}

const meta = {
  title: 'Portal/Analytics/Results',
  component: PortalAnalyticsContent,
  parameters: { layout: 'padded' },
  args: { data: healthy, timeRange: '30d', onTimeRangeChange: fn() },
} satisfies Meta<typeof PortalAnalyticsContent>

export default meta
type Story = StoryObj<typeof meta>

export const HonestMeasures: Story = {
  play: async ({ canvas }) => {
    for (const label of [
      'Qualified scans',
      'Private ratings',
      'Average private rating (n = 50)',
      'Guests who opened Google',
      'Private notes',
    ]) {
      // The label also names a row in the closed Data status table.
      await expect(canvas.getAllByText(label)[0]).toBeVisible()
    }
    await expect(canvas.getByText('4.6 / 5')).toBeVisible()
    await expect(canvas.getByText('↑ 25% · prior 160')).toBeVisible()
    await expect(canvas.getByText('25% of qualified scans')).toBeVisible()
  },
}

export const AverageHeldBackBelowFive: Story = {
  args: {
    data: {
      ...healthy,
      kpis: {
        ...healthy.kpis,
        ratings: count(4, null, null),
        avgRating: {
          value: null,
          priorValue: null,
          comparison: null,
          sampleCount: 4,
          priorSampleCount: 0,
          evidence: evidence({
            state: 'insufficient_data',
            availabilityReason: 'below_minimum_sample',
            verifiedThrough: null,
            sampleCount: 4,
          }),
        },
      },
      engagementFunnel: { qualifiedScans: 30, ratings: 4, googleOpens: 2 },
      ratingDistribution: [],
      ratingTrend: [],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Average private rating (n = 4)')).toBeVisible()
    await expect(
      canvas.getAllByText('Too few ratings to show an average yet.')[0],
    ).toBeVisible()
    expect(canvas.queryByText('Private rating distribution')).toBeNull()
  },
}

export const RatingsOutnumberScans: Story = {
  args: {
    data: {
      ...healthy,
      engagementFunnel: { qualifiedScans: 3, ratings: 50, googleOpens: 10 },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('3 qualified scans')).toBeVisible()
    await expect(canvas.getByText('50 private ratings')).toBeVisible()
    await expect(canvas.getByText(/without percentages/)).toBeVisible()
    expect(canvas.queryByText(/% of/)).toBeNull()
  },
}

export const WindowOpensBeforeQualifiedScans: Story = {
  args: {
    data: {
      ...healthy,
      kpis: {
        ...healthy.kpis,
        scans: {
          value: 200,
          priorValue: null,
          priorUnavailableReason: 'measure_not_yet_counted',
          trend: null,
          evidence: evidence({
            sampleCount: 200,
            availabilityReason: 'measure_started_mid_period',
          }),
        },
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Prior period predates this measure')).toBeVisible()
    await expect(
      canvas.getAllByText(/counted only from the day the measure began/)[0],
    ).toBeVisible()
  },
}

export const GoogleOpensUnattributed: Story = {
  args: {
    data: {
      ...healthy,
      kpis: {
        ...healthy.kpis,
        googleOpens: {
          value: null,
          priorValue: null,
          trend: null,
          evidence: evidence({
            state: 'insufficient_data',
            availabilityReason: 'destination_unattributed',
            verifiedThrough: null,
          }),
        },
      },
      engagementFunnel: null,
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getAllByText(/Some clicks did not record which link was opened/)[0],
    ).toBeVisible()
    expect(canvas.queryByText(/No Google opens recorded/)).toBeNull()
  },
}

export const Narrow320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Guests who opened Google')[0]).toBeVisible()
  },
}
