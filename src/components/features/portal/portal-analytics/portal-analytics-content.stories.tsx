import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { PortalAnalyticsContent } from './portal-analytics-content'
import {
  RESULTS_HEALTHY as healthy,
  RESULTS_WEEKS,
  resultsCount,
  resultsEvidence,
  resultsWeeksOf,
} from './portal-results-stories-data'

const PLACE = {
  propertyId: '22222222-2222-4222-8222-222222222222',
  portalId: '11111111-1111-4111-8111-111111111111',
  isLive: true,
  canOpenInbox: true,
} as const

const meta = {
  title: 'Portal/Analytics/Results',
  component: PortalAnalyticsContent,
  // The links in the empty states and the Private notes figure are router links.
  decorators: [AuthedRouterDecorator],
  parameters: { layout: 'padded' },
  args: {
    data: healthy,
    timeRange: '30d',
    onTimeRangeChange: fn(),
    compare: true,
    onCompareChange: fn(),
  },
} satisfies Meta<typeof PortalAnalyticsContent>

export default meta
type Story = StoryObj<typeof meta>

/** Board 07: Pool & Terrace, the last 30 days on 30 Sep. */
export const BoardSeven: Story = {
  play: async ({ canvas }) => {
    const strip = canvas.getByLabelText('Portal results')
    const cells = within(strip)
    await expect(cells.getByText('Qualified scans')).toBeVisible()
    await expect(cells.getByText('+31 vs the 30 days before')).toBeVisible()
    await expect(cells.getByText('Average private rating')).toBeVisible()
    await expect(cells.getByText('from 118 · +0.1')).toBeVisible()
    await expect(cells.getByText('Guests who opened Google')).toBeVisible()
    await expect(canvas.getByText('1–30 Sep, Sofia time')).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', { name: 'Compare with the 30 days before' }),
    ).toBeChecked()
    await expect(
      canvas.getByText('From 118 private ratings, by page language.'),
    ).toBeVisible()
    await expect(canvas.getByText('Български')).toBeVisible()
    // Once on the chart, once in the list under its values.
    await expect(canvas.getAllByText('v5 published 22 Sep')[0]).toBeVisible()
    await expect(canvas.getByText(/1–30 Sep against 2–31 Aug, Sofia time/)).toBeVisible()
  },
}

export const ChartValuesAsATable: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText('View chart values'))
    const table = canvas.getByRole('table', {
      name: 'Qualified scans and average rating by week',
    })
    await expect(within(table).getByText('29–30 Sep')).toBeVisible()
    // The last week has four ratings: too few for an average, and it says so.
    await expect(within(table).getByText('Too few')).toBeVisible()
    // The prior column is named for the days it covers, and the table lists
    // the version marker the picture draws.
    await expect(within(table).getByText('The 30 days before')).toBeVisible()
    await expect(canvas.getAllByText('v5 published 22 Sep').length).toBeGreaterThan(1)
  },
}

export const ComparisonOff: Story = {
  args: {
    compare: false,
    data: {
      ...healthy,
      comparePeriod: null,
      localDays: {
        start: '2026-09-01',
        end: '2026-09-30',
        compareStart: null,
        compareEnd: null,
      },
      kpis: {
        ...healthy.kpis,
        scans: resultsCount(412, null),
        feedback: resultsCount(9, null),
      },
      series: { weeks: RESULTS_WEEKS.map((week) => ({ ...week, priorScans: null })) },
    },
  },
  play: async ({ canvas }) => {
    expect(canvas.queryByText(/vs the 30 days before/)).toBeNull()
    expect(canvas.queryByText('The period before')).toBeNull()
    await expect(
      canvas.getByRole('checkbox', { name: 'Compare with the 30 days before' }),
    ).not.toBeChecked()
  },
}

export const ChangesTheRange: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(
      within(canvas.getByRole('radiogroup', { name: 'Time range' })).getByRole('radio', {
        name: '7 days',
      }),
    )
    await expect(args.onTimeRangeChange).toHaveBeenCalledWith('7d')
  },
}

export const AverageHeldBackBelowFive: Story = {
  args: {
    data: {
      ...healthy,
      kpis: {
        ...healthy.kpis,
        ratings: resultsCount(4, null),
        avgRating: {
          value: null,
          priorValue: null,
          comparison: null,
          sampleCount: 4,
          priorSampleCount: 0,
          evidence: resultsEvidence({
            state: 'insufficient_data',
            availabilityReason: 'below_minimum_sample',
            verifiedThrough: null,
            sampleCount: 4,
          }),
        },
      },
      engagementFunnel: { qualifiedScans: 30, ratings: 4, googleOpens: 2 },
      ratingDistribution: [],
      series: { weeks: RESULTS_WEEKS.map((week) => ({ ...week, average: null })) },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('4 ratings, needs 5 to show an average')).toBeVisible()
    await expect(canvas.getByText(/The mix appears from 5 private ratings/)).toBeVisible()
    expect(canvas.queryByText('From 4 private ratings.')).toBeNull()
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
    await expect(canvas.getByText(/without percentages/)).toBeVisible()
    // No share is printed in the funnel when a step out-counts the one before.
    expect(canvas.queryByText(/% of scans/, { selector: 'ol span span' })).toBeNull()
  },
}

export const WindowOpensBeforeQualifiedScans: Story = {
  args: {
    data: {
      ...healthy,
      kpis: {
        ...healthy.kpis,
        scans: {
          ...resultsCount(200, null),
          priorUnavailableReason: 'measure_not_yet_counted',
          evidence: resultsEvidence({
            sampleCount: 200,
            availabilityReason: 'measure_started_mid_period',
          }),
        },
      },
      series: { weeks: RESULTS_WEEKS.map((week) => ({ ...week, priorScans: null })) },
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText('The period before predates this measure'),
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
          evidence: resultsEvidence({
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
    // The status table in the closed "About" drawer repeats the reason.
    await expect(
      canvas.getAllByText(/Some clicks did not record which link was opened/)[0],
    ).toBeVisible()
    expect(canvas.queryByText(/No Google opens recorded/)).toBeNull()
  },
}

export const RatingsWithoutARecordedLanguage: Story = {
  args: {
    data: {
      ...healthy,
      ratingLanguages: {
        total: 118,
        languages: [{ locale: 'en', count: 100 }],
        unrecorded: 18,
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Language not recorded')).toBeVisible()
  },
}

export const VersionMadeLiveAgain: Story = {
  args: {
    data: {
      ...healthy,
      versionMarkers: [
        {
          version: 3,
          kind: 'rollback',
          activatedAt: new Date('2026-09-10T06:00:00.000Z'),
          localDate: '2026-09-10',
          week: 1,
          dayInWeek: 2,
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('v3 made live again 10 Sep')[0]).toBeVisible()
  },
}

export const AllTime: Story = {
  args: {
    timeRange: 'all',
    data: {
      ...healthy,
      localDays: null,
      comparePeriod: null,
      series: null,
      versionMarkers: [],
      kpis: {
        ...healthy.kpis,
        scans: resultsCount(1200, null),
        feedback: resultsCount(30, null),
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText('Weekly figures need a chosen range. All time shows totals only.'),
    ).toBeVisible()
    expect(canvas.queryByRole('checkbox')).toBeNull()
    // All Time has no comparison, so the footer states no floor for one.
    await expect(canvas.getByText('All time, Sofia time')).toBeVisible()
    expect(canvas.queryByText(/Averages compare only/)).toBeNull()
  },
}

export const NoDataYet: Story = {
  args: {
    place: PLACE,
    data: {
      ...healthy,
      kpis: {
        scans: resultsCount(0, 0),
        ratings: resultsCount(0, 0),
        avgRating: {
          value: null,
          priorValue: null,
          comparison: null,
          sampleCount: 0,
          priorSampleCount: 0,
          evidence: resultsEvidence({ state: 'insufficient_data' }),
        },
        feedback: resultsCount(0, 0),
        googleOpens: resultsCount(0, 0),
      },
      engagementFunnel: null,
      ratingDistribution: [],
      ratingLanguages: { total: 0, languages: [], unrecorded: 0 },
      responseIntegrity: {
        accepted: 0,
        filteredAutomatically: 0,
        underReview: 0,
        total: 0,
      },
    },
  },
  play: async ({ canvas }) => {
    // Scoped to the window and honest about it: nothing is known of earlier weeks.
    await expect(canvas.getByText('Nothing recorded in these 30 days')).toBeVisible()
    expect(
      canvas.queryByText('Share your portal to start collecting metrics.'),
    ).toBeNull()
    expect(canvas.queryByLabelText('Portal results')).toBeNull()
  },
}

/** The ratings are still being counted: weeks say nothing about "too few", and the languages wait. */
export const RatingsStillUpdating: Story = {
  args: {
    data: {
      ...healthy,
      kpis: {
        ...healthy.kpis,
        ratings: {
          ...healthy.kpis.ratings,
          value: null,
          trend: null,
          evidence: resultsEvidence({ state: 'updating' }),
        },
        avgRating: {
          ...healthy.kpis.avgRating,
          value: null,
          comparison: null,
          evidence: resultsEvidence({ state: 'updating' }),
        },
      },
      ratingDistribution: [],
      series: {
        weeks: RESULTS_WEEKS.map((week) => ({
          ...week,
          ratings: null,
          average: null,
          averageWithheld: 'not_ready' as const,
        })),
      },
    },
  },
  play: async ({ canvas }) => {
    expect(canvas.queryByText(/too few/i)).toBeNull()
    await userEvent.click(canvas.getByText('View chart values'))
    const table = canvas.getByRole('table', {
      name: 'Qualified scans and average rating by week',
    })
    expect(within(table).queryByText('Too few')).toBeNull()
    await expect(
      canvas.getByText('Languages appear once the ratings are counted.'),
    ).toBeVisible()
    expect(canvas.queryByText('Български')).toBeNull()
  },
}

/** The previous range's figures stay on screen while the new ones load. */
export const NewRangeLoading: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
  },
}

export const Narrow320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Guests who opened Google')[0]).toBeVisible()
    await expect(canvas.getByText('Over time')).toBeVisible()
  },
}

/** A version that went live on the last day: its label must stay inside the plot. */
export const VersionLiveInTheLastWeekNarrow320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  args: {
    data: {
      ...healthy,
      versionMarkers: [
        {
          version: 6,
          kind: 'publish',
          activatedAt: new Date('2026-09-30T06:00:00.000Z'),
          localDate: '2026-09-30',
          week: 4,
          dayInWeek: 1,
        },
      ],
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const label = canvas.getAllByText('v6 published 30 Sep')[0]
    await expect(label).toBeVisible()
    const plot = label?.closest('[role="img"]')?.getBoundingClientRect()
    const box = label?.getBoundingClientRect()
    if (plot === undefined || box === undefined) throw new Error('no chart')
    // The label ends inside the picture rather than running off its right edge.
    expect(box.right).toBeLessThanOrEqual(plot.right + 1)
    const page = canvasElement.ownerDocument.documentElement
    expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth)
  },
}

/**
 * Ninety days on a phone: thirteen weeks in about 24px each. The date labels are
 * thinned to every third week, each with room for its own range; a week with too
 * few ratings is a hollow marker, explained once in the legend and the caption,
 * not a 64px note on top of its neighbours.
 */
export const NinetyDaysOnAPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  args: {
    timeRange: '90d',
    data: {
      ...healthy,
      localDays: {
        start: '2026-07-03',
        end: '2026-09-30',
        compareStart: '2026-04-04',
        compareEnd: '2026-07-02',
      },
      series: { weeks: resultsWeeksOf(13) },
      versionMarkers: [],
    },
  },
  play: async ({ canvas }) => {
    const chart = canvas.getByRole('img', { name: 'Over time' })
    // Thirteen weeks, four labels (every third, the last over four columns).
    expect(chart.querySelectorAll('[style*="grid-column"]')).toHaveLength(4)
    expect(within(chart).queryByText(/ratings, too few/)).toBeNull()
    await expect(canvas.getByText('Too few ratings for an average')).toBeVisible()
    await expect(
      canvas.getByText(/Weeks with fewer than 5 ratings show no average\./),
    ).toBeVisible()
  },
}

const NOTHING_KPIS = {
  avgRating: {
    value: null,
    priorValue: null,
    comparison: null,
    sampleCount: 0,
    priorSampleCount: 0,
    evidence: resultsEvidence({ state: 'insufficient_data' }),
  },
  ratings: resultsCount(0, 0),
  feedback: resultsCount(0, 0),
  googleOpens: resultsCount(0, 0),
} as const

const NO_FIGURES = {
  engagementFunnel: null,
  ratingDistribution: [],
  ratingLanguages: { total: 0, languages: [], unrecorded: 0 },
  responseIntegrity: { accepted: 0, filteredAutomatically: 0, underReview: 0, total: 0 },
} as const

/**
 * A live portal whose scans fell to nothing: the printed code may be gone from
 * the table. The strip stays so the drop shows, and one line names it.
 */
export const QuietWindowOnALivePortal: Story = {
  args: {
    place: PLACE,
    data: {
      ...healthy,
      ...NO_FIGURES,
      kpis: { ...NOTHING_KPIS, scans: resultsCount(0, 40) },
      series: {
        weeks: RESULTS_WEEKS.map((week) => ({
          ...week,
          scans: 0,
          ratings: 0,
          average: null,
          averageWithheld: null,
        })),
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/No scans in these 30 days \(40 in the 30 days before\)/),
    ).toBeVisible()
    // The strip is still there, with the fall written on it.
    const strip = within(canvas.getByLabelText('Portal results'))
    await expect(strip.getByText('−40 vs the 30 days before')).toBeVisible()
    expect(canvas.queryByText('No data yet')).toBeNull()
    const share = canvas.getByRole('link', { name: 'See the code' })
    expect(share.getAttribute('href')).toContain('tab=share')
    // A tap target on a phone, by the Button's own minimum.
    expect(share.className).toContain('max-md:min-h-(--control-touch)')
  },
}

/** A portal nobody has published has nothing to count; the panel says what to do first. */
export const DraftHasNoResultsYet: Story = {
  args: {
    place: { ...PLACE, isLive: false },
    data: {
      ...healthy,
      ...NO_FIGURES,
      kpis: { ...NOTHING_KPIS, scans: resultsCount(0, 0) },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No results yet')).toBeVisible()
    await expect(
      canvas.getByText(
        'Results start once this portal is published and its code is shared.',
      ),
    ).toBeVisible()
    expect(canvas.queryByText(/Share your portal/)).toBeNull()
    const review = canvas.getByRole('link', { name: 'Review & publish' })
    expect(review.getAttribute('href')).toContain('/review')
  },
}

export const NoDataYetOnAllTime: Story = {
  args: {
    place: PLACE,
    timeRange: 'all',
    data: {
      ...healthy,
      ...NO_FIGURES,
      localDays: null,
      comparePeriod: null,
      series: null,
      versionMarkers: [],
      kpis: { ...NOTHING_KPIS, scans: resultsCount(0, null) },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No data yet')).toBeVisible()
    const share = canvas.getByRole('link', { name: 'See the code' })
    expect(share.getAttribute('href')).toContain('tab=share')
  },
}

/** The nine notes lead to the Inbox, where they are read and answered. */
export const PrivateNotesLeadToTheInbox: Story = {
  args: { place: PLACE },
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Read in inbox' })
    await expect(link).toBeVisible()
    expect(link.getAttribute('href')).toContain('/inbox')
    expect(link.className).toContain('max-md:min-h-(--control-touch)')
    // The change against the period before stays above the link.
    await expect(canvas.getByText('+2 vs the 30 days before')).toBeVisible()
  },
}

export const NoInboxLinkWithoutTheRightToOpenIt: Story = {
  args: { place: { ...PLACE, canOpenInbox: false } },
  play: async ({ canvas }) => {
    expect(canvas.queryByRole('link', { name: 'Read in inbox' })).toBeNull()
    await expect(canvas.getByText('+2 vs the 30 days before')).toBeVisible()
  },
}

/** The comparison switch changes what these two cells say, not only the scans. */
export const ShareAndChangeBesideEachOther: Story = {
  play: async ({ canvas }) => {
    const strip = within(canvas.getByLabelText('Portal results'))
    await expect(
      strip.getByText('29% of scans · +15 vs the 30 days before'),
    ).toBeVisible()
    await expect(strip.getByText('16% of scans · +4 vs the 30 days before')).toBeVisible()
  },
}
