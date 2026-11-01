import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import { PortalAnalyticsContent } from './portal-analytics-content'
import {
  RESULTS_HEALTHY as healthy,
  RESULTS_WEEKS,
  resultsCount,
  resultsEvidence,
} from './portal-results-stories-data'

const place = {
  propertyId: '22222222-2222-4222-8222-222222222222',
  portalId: '11111111-1111-4111-8111-111111111111',
  isLive: true,
  scansCounted: true,
  canOpenInbox: true,
}
const meta = {
  title: 'Portal/Analytics/Results',
  component: PortalAnalyticsContent,
  decorators: [AuthedRouterDecorator],
  parameters: { layout: 'padded', theme: 'light' },
  args: { data: healthy, timeRange: '30d', onTimeRangeChange: fn(), place },
} satisfies Meta<typeof PortalAnalyticsContent>
export default meta
type Story = StoryObj<typeof meta>

export const BusyPortal: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Yes, 412 guests scanned the code')).toBeVisible()
    await expect(canvas.getByText('Mostly. 4.4★ from 118 ratings')).toBeVisible()
    await expect(canvas.getByText('31 more than the 30 days before')).toBeVisible()
    await expect(canvas.queryByRole('checkbox')).toBeNull()
    await expect(canvas.queryByRole('table')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'More detail' }))
    await expect(
      // The first open reads its own chunk.
      await canvas.findByRole(
        'table',
        { name: /Scans, ratings and average/ },
        { timeout: 10_000 },
      ),
    ).toBeVisible()
    await expect(canvas.getByText('v5 published 22 Sep')).toBeVisible()
  },
}
export const BusyPortalDark: Story = { ...BusyPortal, parameters: { theme: 'dark' } }
export const ThirtyDaysOneVersion: Story = {}
export const UpdatingRange: Story = { args: { busy: true } }
export const OlderCode: Story = {
  args: { place: { ...place, scansCounted: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('We can’t count scans on this code')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'See the code' })).toBeVisible()
    await expect(canvas.queryByRole('group', { name: /Scans;/ })).toBeNull()
  },
}
export const NoLinks: Story = { args: { data: { ...healthy, linkTaps: null } } }
export const AllTime: Story = {
  args: {
    timeRange: 'all',
    data: {
      ...healthy,
      kpis: {
        scans: resultsCount(412, null),
        ratings: resultsCount(118, null),
        feedback: resultsCount(9, null),
        googleOpens: resultsCount(64, null),
        avgRating: {
          ...healthy.kpis.avgRating,
          comparison: null,
          priorValue: null,
          priorSampleCount: 0,
        },
      },
      lifetimeReconciliation: {
        state: 'reconciled',
        projectionRevision: 1,
        sealedThroughLocalDate: null,
        lastRebuiltAt: healthy.period.endAt,
        lastSealedAt: null,
      },
      series: null,
      localDays: null,
      comparePeriod: null,
      versionMarkers: [],
      scanPatterns: null,
    },
  },
}
const zeroKpis = {
  scans: resultsCount(0, 0),
  ratings: resultsCount(0, 0),
  feedback: resultsCount(0, 0),
  googleOpens: resultsCount(0, 0),
  avgRating: {
    ...healthy.kpis.avgRating,
    value: null,
    sampleCount: 0,
    comparison: null,
    priorValue: null,
    evidence: resultsEvidence({
      state: 'insufficient_data',
      availabilityReason: 'below_minimum_sample',
    }),
  },
}
const emptyData = {
  ...healthy,
  kpis: zeroKpis,
  linkTaps: null,
  ratingLanguages: { total: 0, languages: [], unrecorded: 0 },
  ratingDistribution: [],
  responseIntegrity: { accepted: 0, filteredAutomatically: 0, underReview: 0, total: 0 },
  engagementFunnel: null,
  series: {
    bucketDays: 7 as const,
    buckets: RESULTS_WEEKS.map((bucket) => ({
      ...bucket,
      scans: 0,
      priorScans: 0,
      ratings: 0,
      average: null,
      averageWithheld: 'below_floor' as const,
    })),
  },
}
export const Draft: Story = {
  args: { data: emptyData, place: { ...place, isLive: false } },
}
export const NothingYet: Story = { args: { data: emptyData } }
export const QuietWindow: Story = {
  args: {
    data: {
      ...emptyData,
      kpis: { ...zeroKpis, scans: resultsCount(0, 34) },
      scanPatterns: null,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No guests scanned in these days')).toBeVisible()
    await expect(canvas.getByText(/No scans in these 30 days/)).toBeVisible()
    await expect(canvas.queryByRole('alert')).toBeNull()
  },
}
export const FiguresUpdating: Story = {
  args: {
    data: {
      ...emptyData,
      series: {
        bucketDays: 7,
        buckets: RESULTS_WEEKS.map((bucket) => ({
          ...bucket,
          scans: null,
          priorScans: null,
          ratings: null,
          average: null,
          averageWithheld: 'not_ready' as const,
        })),
      },
      kpis: {
        ...zeroKpis,
        scans: {
          ...zeroKpis.scans,
          value: null,
          evidence: resultsEvidence({
            state: 'updating',
            availabilityReason: 'consumer_receipt_pending',
          }),
        },
        ratings: {
          ...zeroKpis.ratings,
          value: null,
          evidence: resultsEvidence({ state: 'updating' }),
        },
        googleOpens: {
          ...zeroKpis.googleOpens,
          value: null,
          evidence: resultsEvidence({ state: 'updating' }),
        },
      },
    },
  },
}
export const NewPortal: Story = {
  args: {
    data: {
      ...emptyData,
      kpis: {
        ...zeroKpis,
        scans: resultsCount(3, 0),
        ratings: resultsCount(1, 0),
        avgRating: { ...zeroKpis.avgRating, sampleCount: 1 },
      },
      linkTaps: {
        total: 0,
        countedSince: '2026-11-01',
        removedTaps: 0,
        rows: healthy.linkTaps!.rows.slice(0, 2).map((row) => ({ ...row, taps: 0 })),
      },
      series: {
        bucketDays: 7,
        buckets: RESULTS_WEEKS.map((bucket, i) => ({
          ...bucket,
          scans: i === 0 ? 3 : 0,
          priorScans: 0,
          ratings: i === 0 ? 1 : 0,
          average: null,
          averageWithheld: 'below_floor',
        })),
      },
      scanPatterns: { channels: { qr: 3, nfc: 0 }, busiest: null },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('1 guest rated their visit')).toBeVisible()
    await expect(canvas.getByText(/An average shows from 5 ratings/)).toBeVisible()
  },
}

/** The owner’s live failure case: seven days, two scans, two page updates. */
const ownerDays = [
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
  '2026-11-01',
]
const ownerData = {
  ...emptyData,
  period: {
    startAt: new Date('2026-10-25T22:00:00Z'),
    endAt: new Date('2026-11-01T12:00:00Z'),
    timezone: 'Europe/Sofia',
  },
  localDays: {
    start: ownerDays[0]!,
    end: ownerDays[6]!,
    compareStart: '2026-10-19',
    compareEnd: '2026-10-25',
  },
  kpis: { ...zeroKpis, scans: resultsCount(2, 0) },
  series: {
    bucketDays: 1 as const,
    buckets: ownerDays.map((date, index) => ({
      index,
      startLocalDate: date,
      endLocalDate: date,
      days: 1,
      scans: index === 1 ? 2 : 0,
      priorScans: 0,
      ratings: 0,
      average: null,
      averageWithheld: 'below_floor' as const,
    })),
  },
  versionMarkers: [0, 1].map((index) => ({
    version: index + 2,
    kind: 'publish' as const,
    activatedAt: new Date(`${ownerDays[index]}T10:00:00Z`),
    localDate: ownerDays[index]!,
    bucket: index,
    dayInBucket: 0,
  })),
  scanPatterns: { channels: { qr: 2, nfc: 0 }, busiest: null },
}
export const OwnersSevenDays: Story = {
  args: { timeRange: '7d', data: ownerData },
  play: async ({ canvas }) => {
    const chart = canvas.getByRole('group', { name: /Scans;/ })
    await expect(chart.querySelectorAll('[data-bucket]')).toHaveLength(7)
    await expect(canvas.getByText('Page updated 26 Oct, 27 Oct')).toBeVisible()
    chart.focus()
    await userEvent.keyboard('{Home}{ArrowRight}')
    await expect(
      canvas.getAllByText('Tue 27 Oct · 2 scans · page updated')[0],
    ).toBeVisible()
    await userEvent.keyboard('{End}')
    await expect(canvas.getAllByText('Sun 1 Nov · 0 scans')[0]).toBeVisible()
  },
}
export const OwnersSevenDaysDark: Story = {
  ...OwnersSevenDays,
  parameters: { theme: 'dark' },
}
export const OnlyOneNonzeroBar: Story = {
  args: {
    data: {
      ...healthy,
      kpis: { ...healthy.kpis, scans: resultsCount(7, 0) },
      series: {
        bucketDays: 7,
        buckets: RESULTS_WEEKS.map((bucket, i) => ({
          ...bucket,
          scans: i === 2 ? 7 : 0,
        })),
      },
    },
  },
}
export const FourDigitWeek: Story = {
  args: {
    data: {
      ...healthy,
      kpis: { ...healthy.kpis, scans: resultsCount(4312, 4200) },
      series: {
        bucketDays: 7,
        buckets: RESULTS_WEEKS.map((bucket, i) => ({
          ...bucket,
          scans: i === 0 ? 3900 : 103,
        })),
      },
    },
  },
}
export const NinetyDaysPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  args: {
    timeRange: '90d',
    data: {
      ...healthy,
      period: { ...healthy.period, startAt: new Date('2026-07-02T21:00:00Z') },
      kpis: { ...healthy.kpis, scans: resultsCount(1196, 1200) },
      versionMarkers: healthy.versionMarkers.map((marker) => ({
        ...marker,
        bucket: 11,
        dayInBucket: 4,
      })),
      localDays: {
        start: '2026-07-03',
        end: '2026-09-30',
        compareStart: '2026-04-04',
        compareEnd: '2026-07-02',
      },
      series: {
        bucketDays: 7,
        buckets: Array.from({ length: 13 }, (_, index) => {
          const date = (offset: number) =>
            new Date(Date.UTC(2026, 6, 3 + offset)).toISOString().slice(0, 10)
          return {
            ...RESULTS_WEEKS[0]!,
            index,
            startLocalDate: date(index * 7),
            endLocalDate: date(Math.min(89, index * 7 + 6)),
            days: Math.min(7, 90 - index * 7),
            scans: 50 + index * 7,
            priorScans: index === 0 ? 1200 : 0,
            ratings: index === 0 ? 118 : 0,
            average: index === 0 ? 4.4 : null,
            averageWithheld: index === 0 ? null : ('below_floor' as const),
          }
        }),
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(
      within(canvas.getByRole('group', { name: /Scans;/ })).getAllByText(/^134$/),
    ).toHaveLength(1)
  },
}
export const NinetyDaysPhoneDark: Story = {
  ...NinetyDaysPhone,
  parameters: { ...NinetyDaysPhone.parameters, theme: 'dark' },
}

export const NewPortalDark: Story = {
  ...NewPortal,
  parameters: { ...NewPortal.parameters, theme: 'dark' },
}
export const DraftDark: Story = {
  ...Draft,
  parameters: { ...Draft.parameters, theme: 'dark' },
}
export const QuietWindowDark: Story = {
  ...QuietWindow,
  parameters: { ...QuietWindow.parameters, theme: 'dark' },
}
export const OlderCodeDark: Story = {
  ...OlderCode,
  parameters: { ...OlderCode.parameters, theme: 'dark' },
}
export const FiguresUpdatingDark: Story = {
  ...FiguresUpdating,
  parameters: { ...FiguresUpdating.parameters, theme: 'dark' },
}
export const AllTimeDark: Story = {
  ...AllTime,
  parameters: { ...AllTime.parameters, theme: 'dark' },
}
export const NoLinksDark: Story = {
  ...NoLinks,
  parameters: { ...NoLinks.parameters, theme: 'dark' },
}
export const FourDigitWeekDark: Story = {
  ...FourDigitWeek,
  parameters: { ...FourDigitWeek.parameters, theme: 'dark' },
}
export const OnlyOneNonzeroBarDark: Story = {
  ...OnlyOneNonzeroBar,
  parameters: { ...OnlyOneNonzeroBar.parameters, theme: 'dark' },
}
