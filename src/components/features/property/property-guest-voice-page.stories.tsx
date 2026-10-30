import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'
import type {
  AiPropertyInsightsAllTimeReady,
  AiPropertyInsightsPresetReady,
  AiTrendReportView,
} from '#/contexts/ai/application/public-api'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { inboxItemId, reviewId } from '#/shared/domain/ids'
import { PropertyGuestVoicePage } from './property-guest-voice-page'
import {
  LARGE_PROPERTY,
  LARGE_PROPERTY_ROWS,
  SMALL_PROPERTY,
  TOO_FEW_PROPERTY,
} from './property-guest-voice-stories-data'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

/** Every row, without its comparison: what a window with no period before it holds. */
const allTime: AiPropertyInsightsAllTimeReady = {
  status: 'ready',
  provisional: false,
  coverage: LARGE_PROPERTY.coverage,
  range: 'all',
  startLocalDate: '2025-06-25',
  endLocalDate: LARGE_PROPERTY.endLocalDate,
  windowStartBasis: 'earliest_evidence',
  dataThroughLocalDate: LARGE_PROPERTY.dataThroughLocalDate,
  window: { selection: 'chosen', textReviewCount: 128 },
  aspectEvidenceState: LARGE_PROPERTY.aspectEvidenceState,
  basis: LARGE_PROPERTY.basis,
  aspects: LARGE_PROPERTY_ROWS.map((row) => ({
    aspect: row.aspect,
    polarity: row.polarity,
    mentionCount: row.mentionCount,
    reviewCount: row.reviewCount,
    topicReviewCount: row.topicReviewCount,
    ratingCounts: row.ratingCounts,
    stars: row.stars,
    change: 'unknown' as const,
  })),
  weeklyAspectSeries: [],
  emergingIssues: LARGE_PROPERTY.emergingIssues,
}

const provisional: AiPropertyInsightsPresetReady = {
  ...LARGE_PROPERTY,
  provisional: true,
  coverage: {
    settledAnalysisCount: 10,
    expectedAnalysisCount: 10,
    awaitingAnalysisCount: 0,
  },
  // 39 reviews less the 12 with only stars; 10 + 3 + 9 + 5 are the 27.
  window: { selection: 'chosen', textReviewCount: 27 },
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
  aspects: LARGE_PROPERTY_ROWS.slice(0, 6).map((row) => ({
    aspect: row.aspect,
    polarity: row.polarity,
    mentionCount: row.mentionCount,
    reviewCount: Math.min(row.reviewCount, 4),
    topicReviewCount: Math.min(row.topicReviewCount, 4),
    ratingCounts: row.ratingCounts,
    stars: row.stars,
    change: 'unknown' as const,
  })),
  emergingIssues: [{ label: 'front desk delays', count: 4 }],
}

const firstReviewId = reviewId('rev-00000000-0000-4000-8000-000000000001')
const secondReviewId = reviewId('rev-00000000-0000-4000-8000-000000000002')
const firstInboxItemId = inboxItemId('22222222-2222-4222-8222-222222222222')

type TrendWindow = Extract<AiTrendReportView, { status: 'ready' }>['evidence']['current']

/** A window of the comparison, its coverage worked out as the generator does. */
function trendWindow(
  period: TrendWindow['period'],
  textCandidateCount: number,
  analyzedCount: number,
): TrendWindow {
  return {
    period,
    textCandidateCount,
    analyzedCount,
    excludedCount: textCandidateCount - analyzedCount,
    starOnlyCount: 2,
    coverageBasisPoints:
      textCandidateCount === 0
        ? 0
        : Math.floor((analyzedCount * 10_000) / textCandidateCount),
  }
}

const BASELINE_PERIOD = { startLocalDate: '2026-07-13', endLocalDate: '2026-08-11' }
const CURRENT_PERIOD = { startLocalDate: '2026-08-12', endLocalDate: '2026-09-10' }

function trendEvidence(
  baseline: [candidates: number, analysed: number],
  current: [candidates: number, analysed: number],
) {
  return {
    definitionVersion: 'property-trend-definition-v1',
    definitionDigest: 'a'.repeat(64),
    renderProfileVersion: 'trend-render-v1',
    renderProfileDigest: 'b'.repeat(64),
    timezone: 'Europe/Sofia',
    dataThroughLocalDate: '2026-09-10',
    baseline: trendWindow(BASELINE_PERIOD, ...baseline),
    current: trendWindow(CURRENT_PERIOD, ...current),
    modelLineage: [],
    selectedSignals: [],
    supportingReviews: [],
  }
}

const FINISHED = {
  sourceEpoch: 1,
  reviewAnalysisEpoch: 1,
  propertyTrendsEpoch: 1,
  propertyProfileVersion: 1,
  dueLocalDate: '2026-09-11',
  terminalAnalysisSequence: 24,
  aggregateRevision: 24,
  updating: false,
} as const

// The last 30 days against the 30 before. Its finding agrees with the table's Wait
// time row (the 90-day window against the 12 months before); the table's other
// moving row, Service, is the one the headline does not mention.
const readyTrend: Extract<AiTrendReportView, { status: 'ready' }> = {
  ...FINISHED,
  status: 'ready',
  reportProfileVersion: 'property-trend-v1',
  report: {
    signalKey: 'aspect.wait_time.negative.down',
    direction: 'improving',
    changeMagnitudeBasisPoints: 1_500,
    supportingReviewCount: 10,
    headline: 'Review signals improved',
    sentences: ['Wait time complaints fell from 30.0% to 15.0%'],
    summary: 'Wait time complaints fell from 30.0% to 15.0%.',
  },
  evidence: {
    ...trendEvidence([22, 22], [20, 20]),
    supportingReviews: [
      {
        reviewId: firstReviewId,
        window: 'current',
        localDate: '2026-09-08',
        inboxItemId: firstInboxItemId,
      },
      // No Inbox item this viewer may open: shown as text, not a link.
      {
        reviewId: secondReviewId,
        window: 'baseline',
        localDate: '2026-08-02',
        inboxItemId: null,
      },
    ],
  },
  generatedAtEpochMillis: Date.UTC(2026, 8, 11, 10),
}

const trendFn = (read: unknown) =>
  (async () => read) as unknown as typeof getPropertyAiTrendFn

const EPOCHS = {
  sourceEpoch: 1,
  reviewAnalysisEpoch: 1,
  propertyTrendsEpoch: 1,
  propertyProfileVersion: 1,
} as const

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
    range: 'auto',
    onRangeChange: fn(),
    result: LARGE_PROPERTY,
    serverFns: { getTrend: trendFn(readyTrend) },
  },
} satisfies Meta<typeof PropertyGuestVoicePage>

export default meta
type Story = StoryObj<typeof meta>

/** 128 reviews with text in 90 days: the automatic window, topics ranked by stars at stake. */
export const ReadyWithComparison: Story = {
  play: async ({ canvas, args }) => {
    expect(
      await canvas.findByText('Wait time complaints fell from 30.0% to 15.0%.'),
    ).toBeVisible()
    expect(
      canvas.getByText(
        'Based on 20 reviews from the last 30 days and 22 from the 30 days before.',
      ),
    ).toBeVisible()
    const supportingReview = canvas.getByRole('link', {
      name: /Open supporting review from Sep 8, 2026 in the inbox/,
    })
    expect(supportingReview).toHaveAttribute(
      'href',
      `/properties/${PROPERTY_ID}/reviews?itemId=${firstInboxItemId}`,
    )
    expect(canvas.getByText('Previous period · Aug 2, 2026')).toBeVisible()
    expect(
      canvas.queryByRole('link', { name: /Open supporting review from Aug 2, 2026/ }),
    ).not.toBeInTheDocument()

    // The window is named, with the reviews it holds, and the figures say what they count.
    expect(
      canvas.getByText('Last 90 days, chosen because it holds 128 reviews with text.'),
    ).toBeVisible()
    // The rows count 120, not 128: the page says why.
    expect(
      canvas.getByText("120 of them analysed; 8 in a language we don't analyse yet."),
    ).toBeVisible()
    expect(canvas.getByText('Based on 150 reviews · 120 analysed')).toBeVisible()

    const topics = canvas.getByRole('table', { name: 'Topics' })
    expect(within(topics).getAllByRole('row')).toHaveLength(11)
    expect(
      within(topics)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Topic',
      'Reviews',
      'Praise and complaints',
      'Stars when mentioned',
      'Change',
    ])
    expect(within(topics).queryByText('Impact')).not.toBeInTheDocument()

    // Most stars at stake first: Service, whose 19 complaining reviews rate 2.0 stars
    // against 4.2 for the rest.
    const rows = within(topics).getAllByRole('row')
    const serviceRow = rows[1]
    if (!serviceRow) throw new Error('First topic row is missing')
    expect(within(serviceRow).getByText('Service')).toBeVisible()
    expect(within(serviceRow).getByText('26 of 120')).toBeVisible()
    expect(within(serviceRow).getByText(/2\.0★, the rest 4\.2★/)).toBeVisible()
    expect(within(serviceRow).getByText('Complaints likely rising')).toBeVisible()
    // A link's name starts with the words it shows (WCAG 2.5.3).
    expect(
      within(serviceRow).getByRole('link', {
        name: '19 complaints for Service; open in inbox',
      }),
    ).toHaveAttribute('href', expect.stringContaining('polarity=negative'))
    // The drill-down keeps the window the table counted over.
    expect(
      within(serviceRow).getByRole('link', {
        name: '7 praise for Service; open in inbox',
      }),
    ).toHaveAttribute(
      'href',
      expect.stringMatching(
        /since=2026-06-13.*until=2026-09-10|until=2026-09-10.*since=2026-06-13/,
      ),
    )

    const waitRow = within(topics).getByText('Wait time').closest('tr')
    if (!waitRow) throw new Error('Wait time row is missing')
    expect(within(waitRow).getByText('Complaints likely falling')).toBeVisible()

    // A recurring issue is a count of reviews, with no "+7" beside it.
    expect(canvas.getByText('Recurring issues')).toBeVisible()
    expect(canvas.getByText('front desk delays')).toBeVisible()
    expect(canvas.getByText('12', { selector: 'span.font-semibold' })).toBeVisible()
    expect(canvas.queryByLabelText(/compared with the previous period/)).toBeNull()

    // Topics nobody complains about come last, the least praised in the fold.
    await userEvent.click(canvas.getByText('Show all topics'))
    expect(
      within(canvas.getByRole('table', { name: 'More topics' })).getByText('Quality'),
    ).toBeVisible()

    // Automatic is the choice shown; another range is one press away.
    const range = canvas.getByRole('radiogroup', { name: 'Time range' })
    expect(within(range).getByRole('radio', { name: 'Automatic' })).toBeChecked()
    expect(within(range).getByRole('radio', { name: '12 months' })).toBeVisible()
    await userEvent.click(within(range).getByRole('radio', { name: '30 days' }))
    expect(args.onRangeChange).toHaveBeenCalledWith('30d')
  },
}

/** About three reviews with text a month: no window shorter than 12 months holds enough. */
export const SmallProperty: Story = {
  args: { result: SMALL_PROPERTY },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText(
        'Last 12 months, chosen because no shorter period holds enough reviews with text. It holds 36.',
      ),
    ).toBeVisible()
    const topics = canvas.getByRole('table', { name: 'Topics' })
    // Under three reviews there is no average to print and no proportion to draw:
    // the row shows counts only.
    const parkingRow = within(topics).getByText('Parking').closest('tr')
    if (!parkingRow) throw new Error('Parking row is missing')
    expect(within(parkingRow).getByText('too few')).toBeVisible()
    expect(within(parkingRow).getByText('1 of 34')).toBeVisible()
    expect(within(parkingRow).getByText('1 complaint')).toBeVisible()
    expect(parkingRow.querySelector('[data-slot="topic-bar"]')).toBeNull()
    const serviceRow = within(topics).getByText('Service').closest('tr')
    if (!serviceRow) throw new Error('Service row is missing')
    expect(within(serviceRow).getByText('2 of 34')).toBeVisible()
    expect(serviceRow.querySelector('[data-slot="topic-bar"]')).toBeNull()
    // A topic nobody complains about has nothing to compare.
    const staffRow = within(topics).getByText('Staff').closest('tr')
    if (!staffRow) throw new Error('Staff row is missing')
    expect(within(staffRow).getByText('No complaints')).toBeVisible()
    // Enough reviews for the average: Room, 4 complaining reviews of 4.
    const roomRow = within(topics).getByText('Room').closest('tr')
    if (!roomRow) throw new Error('Room row is missing')
    expect(within(roomRow).getByText(/★, the rest/)).toBeVisible()
    expect(roomRow.querySelector('[data-slot="topic-bar"]')).not.toBeNull()
    // Fewer than twenty analysed reviews in the 12 months before: no change is claimed.
    expect(canvas.queryByText(/likely (rising|falling)/)).toBeNull()
    // Two reviews name it: that is the least a recurring issue is.
    expect(canvas.getByText('slow wifi')).toBeVisible()
  },
}

/** Fewer than ten reviews with text in 12 months: the page says it cannot spot patterns. */
export const TooFewToSpotPatterns: Story = {
  args: { result: TOO_FEW_PROPERTY },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText(
        'Last 12 months. It holds 6 reviews with text, too few to spot patterns.',
      ),
    ).toBeVisible()
  },
}

/** A range the reader chose names itself and what it holds. */
export const ChosenWindow: Story = {
  args: {
    range: '30d',
    result: {
      ...LARGE_PROPERTY,
      range: 30,
      window: { selection: 'chosen', textReviewCount: 128 },
    },
  },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText('Last 30 days. It holds 128 reviews with text.'),
    ).toBeVisible()
    expect(canvas.getByRole('radio', { name: '30 days' })).toBeChecked()
  },
}

export const ReadyAllTime: Story = {
  args: {
    range: 'all',
    result: allTime,
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Based on 150 reviews · 120 analysed')).toBeVisible()
    expect(
      canvas.getByText('All time, since Jun 25, 2025. It holds 128 reviews with text.'),
    ).toBeVisible()
    expect(canvas.getByRole('radio', { name: 'All time' })).toBeChecked()
    expect(
      within(canvas.getByRole('table', { name: 'Topics' })).queryByRole('columnheader', {
        name: 'Change',
      }),
    ).not.toBeInTheDocument()
    expect(canvas.queryByText(/likely (rising|falling)/)).toBeNull()
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
    expect(within(breakdown).getByText('Period')).toBeVisible()
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
      ...LARGE_PROPERTY,
      aspectEvidenceState: 'no_mentions',
      aspects: [],
      emergingIssues: [],
    },
    serverFns: { getTrend: trendFn({ status: 'preparing', ...EPOCHS }) },
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Based on 150 reviews · 120 analysed')).toBeVisible()
    expect(
      canvas.getByText(
        'No topic mentions were identified among the analysed reviews in this period.',
      ),
    ).toBeVisible()
    expect(
      canvas.getByText('No issue was named in more than one review in this period.'),
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
    expect(canvas.getByRole('link', { name: 'Turn on AI analysis' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/properties\/[^/]+\/settings\/ai$/),
    )
  },
}

export const AnalysisOffForMember: Story = {
  ...AnalysisOff,
  decorators: [withRole('Member')],
  play: async ({ canvas }) => {
    expect(await canvas.findByText(/An account admin can enable it/)).toBeVisible()
    expect(
      canvas.queryByRole('link', { name: 'Turn on AI analysis' }),
    ).not.toBeInTheDocument()
  },
}

/** The next range is being read: the page stays, dimmed, and its range control with it. */
export const ReadingNextRange: Story = {
  args: { busy: true },
  play: async ({ canvas, canvasElement }) => {
    expect(await canvas.findByRole('heading', { name: 'Guest voice' })).toBeVisible()
    expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
  },
}

export const Preparing: Story = {
  args: {
    result: { status: 'preparing' },
    serverFns: { getTrend: trendFn({ status: 'preparing', ...EPOCHS }) },
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('Guest voice is being prepared')).toBeVisible()
    expect(
      canvas.getByText(/Topics appear as soon as there is enough review evidence/),
    ).toBeVisible()
  },
}

/** The automatic window reaches back 12 months: a year with no review has nothing longer to try. */
export const NoReviewsInTheYear: Story = {
  args: {
    result: {
      status: 'insufficient_data',
      startLocalDate: '2025-09-11',
      endLocalDate: '2026-09-10',
    },
    serverFns: { getTrend: trendFn({ status: 'disabled' }) },
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('No reviews in the last 12 months')).toBeVisible()
    expect(canvas.queryByText(/Based on/)).not.toBeInTheDocument()
  },
}

export const InsufficientData: Story = {
  args: {
    range: '30d',
    result: {
      status: 'insufficient_data',
      startLocalDate: '2026-06-13',
      endLocalDate: '2026-09-10',
    },
    serverFns: { getTrend: trendFn({ status: 'disabled' }) },
  },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText('Not enough review evidence in this period'),
    ).toBeVisible()
    expect(canvas.getByText(/Choose a longer range to look further back/)).toBeVisible()
    expect(canvas.queryByText(/Based on/)).not.toBeInTheDocument()
  },
}

// The monthly comparison in each state it can be in. Each says where it stands,
// with the numbers it stands on, in the place the finding takes when there is one.

export const TrendStillAnalysing: Story = {
  args: {
    serverFns: {
      getTrend: trendFn({
        status: 'updating',
        ...EPOCHS,
        evidence: trendEvidence([22, 20], [20, 14]),
      }),
    },
  },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText(
        'Still analysing: 14 of 20 reviews done in the last 30 days.',
      ),
    ).toBeVisible()
    expect(canvas.queryByRole('heading', { name: /Wait time complaints/ })).toBeNull()
  },
}

export const TrendNotEnoughReviews: Story = {
  args: {
    serverFns: {
      getTrend: trendFn({
        ...FINISHED,
        status: 'insufficient_data',
        evidence: trendEvidence([22, 22], [14, 14]),
      }),
    },
  },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText(
        'Not enough reviews yet to compare months: 14 of the 20 needed in the last 30 days.',
      ),
    ).toBeVisible()
    expect(
      canvas.getByText(
        'Reviews analysed: 14 in the last 30 days, 22 in the 30 days before.',
      ),
    ).toBeVisible()
  },
}

/** A quiet property sat in Updating with 0 of 0: it was never waiting for anything. */
export const TrendEmptyWindowIsNotUpdating: Story = {
  args: {
    serverFns: {
      getTrend: trendFn({
        status: 'updating',
        ...EPOCHS,
        evidence: trendEvidence([0, 0], [2, 2]),
      }),
    },
  },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText(
        'Not enough reviews yet to compare months: 0 of the 20 needed in the 30 days before.',
      ),
    ).toBeVisible()
    expect(canvas.queryByText(/Still analysing/)).toBeNull()
  },
}

export const TrendNoClearChange: Story = {
  args: {
    serverFns: {
      getTrend: trendFn({
        ...FINISHED,
        status: 'no_material_change',
        evidence: trendEvidence([22, 22], [20, 20]),
      }),
    },
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByText('No clear change in the last 30 days.')).toBeVisible()
    expect(
      canvas.getByText(
        'Compared 20 reviews from the last 30 days with 22 from the 30 days before.',
      ),
    ).toBeVisible()
  },
}

export const TrendBeingPrepared: Story = {
  args: { serverFns: { getTrend: trendFn({ status: 'preparing', ...EPOCHS }) } },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText('The comparison with the month before is being prepared.'),
    ).toBeVisible()
  },
}

export const Compact390: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvas }) => {
    expect(
      await canvas.findByText('Wait time complaints fell from 30.0% to 15.0%.'),
    ).toBeVisible()
    const control = canvas
      .getAllByLabelText('Time range')
      .find((element) => element.getBoundingClientRect().height > 0)
    if (!control) throw new Error('Visible range control is missing')
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    expect(
      canvas
        .getAllByText('Praise and complaints')
        .some((element) => element.getBoundingClientRect().height > 0),
    ).toBe(true)
    expect(
      canvas.getByRole('link', {
        name: '7 praise for Service; open in inbox',
      }),
    ).toBeVisible()
    await userEvent.click(canvas.getByText('Show all topics'))
    expect(canvas.getByText('Quality')).toBeVisible()
  },
}
