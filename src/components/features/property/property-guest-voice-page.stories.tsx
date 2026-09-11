import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'
import type {
  AiPropertyInsightComparedAspect,
  AiPropertyInsightsPresetReady,
  AiPropertyInsightsRead,
  AiTrendReportRead,
} from '#/contexts/ai/application/public-api'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import { reviewId } from '#/shared/domain/ids'
import { PropertyGuestVoicePage } from './property-guest-voice-page'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

function comparedAspect(
  aspect: AspectTaxonomyV1Id,
  polarity: AspectPolarityV1,
  mentionCount: number,
  impact: number,
  mentionCountDelta = 1,
  impactDelta = impact > 0 ? 0.8 : -0.8,
): AiPropertyInsightComparedAspect {
  return {
    aspect,
    polarity,
    mentionCount,
    impact,
    comparison: {
      precedingMentionCount: Math.max(0, mentionCount - mentionCountDelta),
      precedingImpact: impact - impactDelta,
      mentionCountDelta,
      impactDelta,
    },
  }
}

const readyWithComparison: AiPropertyInsightsPresetReady = {
  status: 'ready',
  provisional: false,
  coverage: {
    settledAnalysisCount: 102,
    expectedAnalysisCount: 102,
    awaitingAnalysisCount: 0,
  },
  range: 90,
  startLocalDate: '2026-06-13',
  endLocalDate: '2026-09-10',
  precedingPeriod: {
    startLocalDate: '2026-03-15',
    endLocalDate: '2026-06-12',
  },
  dataThroughLocalDate: '2026-09-10',
  impactVersion: 'aspect-impact-v1',
  aspectEvidenceState: 'available',
  basis: {
    reviewCount: 120,
    analyzedReviewCount: 96,
    preAspectAnalysisCount: 0,
    currentAnalysisCount: 102,
    starOnlyCount: 18,
    notAnalyzableCount: 6,
    awaitingAnalysisCount: 0,
    ratingDistribution: [
      { stars: 1, count: 8 },
      { stars: 2, count: 12 },
      { stars: 3, count: 22 },
      { stars: 4, count: 36 },
      { stars: 5, count: 42 },
    ],
  },
  aspects: [
    comparedAspect('service', 'negative', 28, -18.4, 9, -7.2),
    comparedAspect('service', 'positive', 7, 5, 2, 1),
    comparedAspect('cleanliness', 'positive', 24, 16.7, 4, 3.6),
    comparedAspect('room', 'negative', 17, -10.3, -4, 3.3),
    comparedAspect('room', 'positive', 9, 6.2, 3, 2.2),
    comparedAspect('staff', 'positive', 16, 9.8, 4, 2.4),
    comparedAspect('wait_time', 'negative', 13, -8.5),
    comparedAspect('food_and_drink', 'positive', 12, 7.9),
    comparedAspect('value', 'positive', 11, 6.8),
    comparedAspect('parking', 'negative', 10, -6.5),
    comparedAspect('noise', 'negative', 9, -5.9),
    comparedAspect('amenities', 'positive', 8, 4.8),
    comparedAspect('location', 'positive', 7, 3.5),
    comparedAspect('wifi_and_tech', 'negative', 6, -2.1),
    comparedAspect('quality', 'positive', 5, 1.2),
  ],
  weeklyAspectSeries: [],
  emergingIssues: [
    {
      label: 'front desk delays',
      count: 12,
      comparison: { precedingCount: 5, delta: 7 },
    },
    {
      label: 'bathroom maintenance',
      count: 7,
      comparison: { precedingCount: 9, delta: -2 },
    },
    {
      label: 'air conditioning noise',
      count: 4,
      comparison: { precedingCount: 4, delta: 0 },
    },
  ],
}

const allTime: Extract<AiPropertyInsightsRead, { status: 'ready'; range: 'all' }> = {
  status: 'ready',
  provisional: false,
  coverage: readyWithComparison.coverage,
  range: 'all',
  startLocalDate: '2025-06-25',
  endLocalDate: readyWithComparison.endLocalDate,
  windowStartBasis: 'earliest_evidence',
  dataThroughLocalDate: readyWithComparison.dataThroughLocalDate,
  impactVersion: readyWithComparison.impactVersion,
  aspectEvidenceState: readyWithComparison.aspectEvidenceState,
  basis: readyWithComparison.basis,
  aspects: readyWithComparison.aspects.map((entry) => ({
    aspect: entry.aspect,
    polarity: entry.polarity,
    mentionCount: entry.mentionCount,
    impact: entry.impact,
  })),
  weeklyAspectSeries: [],
  emergingIssues: readyWithComparison.emergingIssues.map((issue) => ({
    label: issue.label,
    count: issue.count,
  })),
}

const provisional: AiPropertyInsightsPresetReady = {
  status: 'ready',
  provisional: true,
  coverage: {
    settledAnalysisCount: 10,
    expectedAnalysisCount: 10,
    awaitingAnalysisCount: 0,
  },
  range: 90,
  startLocalDate: '2026-06-13',
  endLocalDate: '2026-09-10',
  dataThroughLocalDate: '2026-09-10',
  impactVersion: 'aspect-impact-v1',
  aspectEvidenceState: 'available',
  basis: {
    reviewCount: 39,
    analyzedReviewCount: 10,
    preAspectAnalysisCount: 5,
    currentAnalysisCount: 18,
    starOnlyCount: 12,
    notAnalyzableCount: 3,
    awaitingAnalysisCount: 9,
    ratingDistribution: [
      { stars: 1, count: 3 },
      { stars: 2, count: 4 },
      { stars: 3, count: 6 },
      { stars: 4, count: 11 },
      { stars: 5, count: 15 },
    ],
  },
  aspects: readyWithComparison.aspects.slice(0, 6).map((entry) => ({
    aspect: entry.aspect,
    polarity: entry.polarity,
    mentionCount: entry.mentionCount,
    impact: entry.impact,
  })),
  weeklyAspectSeries: [],
  emergingIssues: [{ label: 'front desk delays', count: 4 }],
}

const firstReviewId = reviewId('rev-00000000-0000-4000-8000-000000000001')
const secondReviewId = reviewId('rev-00000000-0000-4000-8000-000000000002')
const readyTrend: Extract<AiTrendReportRead, { status: 'ready' }> = {
  status: 'ready',
  sourceEpoch: 1,
  reviewAnalysisEpoch: 1,
  propertyTrendsEpoch: 1,
  propertyProfileVersion: 1,
  dueLocalDate: '2026-09-11',
  terminalAnalysisSequence: 24,
  aggregateRevision: 24,
  reportProfileVersion: 'property-trend-v1',
  report: {
    signalKey: 'aspect.service.negative.down',
    direction: 'improving',
    changeMagnitudeBasisPoints: 1_500,
    supportingReviewCount: 10,
    headline: 'Review signals improved',
    sentences: ['Service complaints fell from 30.0% to 15.0%'],
    summary: 'Service complaints fell from 30.0% to 15.0%.',
  },
  evidence: {
    definitionVersion: 'property-trend-definition-v1',
    definitionDigest: 'a'.repeat(64),
    renderProfileVersion: 'trend-render-v1',
    renderProfileDigest: 'b'.repeat(64),
    timezone: 'Europe/Sofia',
    dataThroughLocalDate: '2026-09-10',
    baseline: {
      period: { startLocalDate: '2026-07-14', endLocalDate: '2026-08-13' },
      textCandidateCount: 10,
      analyzedCount: 10,
      excludedCount: 0,
      starOnlyCount: 2,
      coverageBasisPoints: 10_000,
    },
    current: {
      period: { startLocalDate: '2026-08-14', endLocalDate: '2026-09-10' },
      textCandidateCount: 10,
      analyzedCount: 10,
      excludedCount: 0,
      starOnlyCount: 1,
      coverageBasisPoints: 10_000,
    },
    modelLineage: [],
    selectedSignals: [],
    supportingReviews: [
      {
        reviewId: firstReviewId,
        window: 'current',
        localDate: '2026-09-08',
        href: `/properties/${PROPERTY_ID}/reviews?reviewId=${firstReviewId}`,
      },
      {
        reviewId: secondReviewId,
        window: 'baseline',
        localDate: '2026-08-02',
        href: `/properties/${PROPERTY_ID}/reviews?reviewId=${secondReviewId}`,
      },
    ],
  },
  updating: false,
  generatedAtEpochMillis: Date.UTC(2026, 8, 11, 10),
}

const trendFn = (read: unknown) =>
  (async () => read) as unknown as typeof getPropertyAiTrendFn

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
    propertyId: PROPERTY_ID,
    propertyName: 'Harbour House Hotel',
    range: '90d',
    onRangeChange: fn(),
    result: readyWithComparison,
    serverFns: { getTrend: trendFn(readyTrend) },
  },
} satisfies Meta<typeof PropertyGuestVoicePage>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyWithComparison: Story = {
  play: async ({ canvas, args }) => {
    expect(
      await canvas.findByText('Service complaints fell from 30.0% to 15.0%.'),
    ).toBeVisible()
    const supportingReview = canvas.getByRole('link', {
      name: /Open supporting review from 8 Sept 2026 in the inbox/,
    })
    expect(supportingReview).toHaveAttribute(
      'href',
      expect.stringContaining(`reviewId=${firstReviewId}`),
    )
    expect(canvas.getByText('Based on 120 reviews · 96 analysed')).toBeVisible()

    const topics = canvas.getByRole('table', { name: 'Topics' })
    expect(within(topics).getAllByRole('row')).toHaveLength(11)
    expect(within(topics).getAllByText('Room')).toHaveLength(1)
    expect(
      within(topics).getByRole('link', {
        name: '7 praise mentions for Service; open in inbox',
      }),
    ).toHaveAttribute('href', expect.stringContaining('polarity=positive'))
    expect(
      within(topics).getByRole('link', {
        name: '28 complaint mentions for Service; open in inbox',
      }),
    ).toHaveAttribute('href', expect.stringContaining('polarity=negative'))
    const cleanlinessRow = within(topics).getByText('Cleanliness').closest('tr')
    if (!cleanlinessRow) throw new Error('Cleanliness topic row is missing')
    expect(within(cleanlinessRow).getByText('+16.7')).toBeVisible()
    expect(within(cleanlinessRow).getByText('+4 mentions')).toBeVisible()
    expect(within(cleanlinessRow).getByText('+3.6 impact')).toBeVisible()

    expect(canvas.getByText('front desk delays')).toBeVisible()
    expect(canvas.getByLabelText('+7 compared with the previous period')).toBeVisible()

    await userEvent.click(canvas.getByText('Show all topics'))
    expect(
      within(canvas.getByRole('table', { name: 'More topics' })).getByText(
        'Wi-Fi and tech',
      ),
    ).toBeVisible()

    const range = canvas.getByRole('group', { name: 'Time range' })
    await userEvent.click(within(range).getByRole('button', { name: '30 days' }))
    expect(args.onRangeChange).toHaveBeenCalledWith('30d')
  },
}

export const ReadyAllTime: Story = {
  args: {
    range: 'all',
    result: allTime,
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Based on 120 reviews · 96 analysed')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'All time' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      within(canvas.getByRole('table', { name: 'Topics' })).queryByRole('columnheader', {
        name: 'Change',
      }),
    ).not.toBeInTheDocument()
    expect(canvas.queryByLabelText(/compared with the previous period/)).toBeNull()
  },
}

export const ProvisionalFillingIn: Story = {
  args: { result: provisional },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Based on 39 reviews · 10 analysed')).toBeVisible()
    expect(
      canvas.getByText(
        '9 reviews still being analysed. Change is hidden until analysis is complete.',
      ),
    ).toBeVisible()
    await userEvent.click(canvas.getByText('What is in this figure'))
    const breakdown = canvas.getByText('What is in this figure').closest('details')
    if (!breakdown) throw new Error('Basis disclosure is missing')
    expect(within(breakdown).getByText('Awaiting analysis')).toBeVisible()
    expect(within(breakdown).getByText('9')).toBeVisible()
    expect(
      within(canvas.getByRole('table', { name: 'Topics' })).queryByRole('columnheader', {
        name: 'Change',
      }),
    ).not.toBeInTheDocument()
  },
}

export const NoTopics: Story = {
  args: {
    result: {
      ...readyWithComparison,
      aspectEvidenceState: 'no_mentions',
      aspects: [],
      emergingIssues: [],
    },
    serverFns: { getTrend: trendFn({ status: 'preparing' }) },
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Based on 120 reviews · 96 analysed')).toBeVisible()
    expect(
      canvas.getByText(
        'No topic mentions were identified among the analysed reviews in this period.',
      ),
    ).toBeVisible()
    expect(
      canvas.getByText(
        'No emerging issues were found among the analysed reviews in this period.',
      ),
    ).toBeVisible()
    expect(canvas.queryByText(/unavailable right now/i)).not.toBeInTheDocument()
  },
}

export const AnalysisOff: Story = {
  args: {
    result: { status: 'disabled' },
    serverFns: { getTrend: trendFn({ status: 'disabled' }) },
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('AI analysis is off for this property')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Enable AI analysis' })).toHaveAttribute(
      'href',
      expect.stringContaining('/settings/ai?propertyId='),
    )
  },
}

export const AnalysisOffForMember: Story = {
  ...AnalysisOff,
  decorators: [withRole('Member')],
  play: async ({ canvas }) => {
    expect(await canvas.findByText(/An account admin can enable it/)).toBeVisible()
    expect(
      canvas.queryByRole('link', { name: 'Enable AI analysis' }),
    ).not.toBeInTheDocument()
  },
}

export const Preparing: Story = {
  args: {
    result: { status: 'preparing' },
    serverFns: { getTrend: trendFn({ status: 'preparing' }) },
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Guest voice is being prepared')).toBeVisible()
    expect(
      canvas.getByText(/Topics appear as soon as there is enough review evidence/),
    ).toBeVisible()
  },
}

export const InsufficientData: Story = {
  args: {
    result: {
      status: 'insufficient_data',
      startLocalDate: '2026-06-13',
      endLocalDate: '2026-09-10',
    },
    serverFns: { getTrend: trendFn({ status: 'insufficient_data' }) },
  },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText('Not enough review evidence in this period'),
    ).toBeVisible()
    expect(canvas.getByText(/Choose a longer range to look further back/)).toBeVisible()
    expect(canvas.queryByText(/Based on/)).not.toBeInTheDocument()
  },
}

export const Compact390: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText('Service complaints fell from 30.0% to 15.0%.'),
    ).toBeVisible()
    const control = canvas
      .getAllByLabelText('Time range')
      .find((element) => element.getBoundingClientRect().height > 0)
    if (!control) throw new Error('Visible range control is missing')
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(
      canvas
        .getAllByText('Praise')
        .some((element) => element.getBoundingClientRect().height > 0),
    ).toBe(true)
    expect(
      canvas.getByRole('link', {
        name: '7 praise mentions for Service; open in inbox',
      }),
    ).toBeVisible()
    await userEvent.click(canvas.getByText('Show all topics'))
    expect(canvas.getByText('Wi-Fi and tech')).toBeVisible()
  },
}
