import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { PortalAnalyticsContent } from './portal-analytics-content'
import {
  RESULTS_HEALTHY as healthy,
  RESULTS_WEEKS,
  resultsCount,
  resultsEvidence,
} from './portal-results-stories-data'

const meta = {
  title: 'Portal/Analytics/Results',
  component: PortalAnalyticsContent,
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
    await expect(canvas.getByText('1–30 Sep, Europe/Sofia time')).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', { name: 'Compare with the 30 days before' }),
    ).toBeChecked()
    await expect(
      canvas.getByText('From 118 private ratings, by page language.'),
    ).toBeVisible()
    await expect(canvas.getByText('Български')).toBeVisible()
    await expect(canvas.getByText('v5 published 22 Sep')).toBeVisible()
    await expect(
      canvas.getByText(/1–30 Sep against 2–31 Aug, Europe\/Sofia time/),
    ).toBeVisible()
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
    await userEvent.click(canvas.getByRole('combobox', { name: 'Time range' }))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: 'Last 7 days' }),
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
    await expect(canvas.getByText('v3 made live again 10 Sep')).toBeVisible()
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
  },
}

export const NoDataYet: Story = {
  args: {
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
    await expect(canvas.getByText('No data yet')).toBeVisible()
  },
}

export const Narrow320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Guests who opened Google')[0]).toBeVisible()
    await expect(canvas.getByText('Over time')).toBeVisible()
  },
}
