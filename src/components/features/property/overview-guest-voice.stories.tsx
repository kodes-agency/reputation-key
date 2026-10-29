// The Guest voice row of Overview: one sentence and two chips.
//
// Replaces two full sections (a trend narrative and a three-panel aspect block
// with its own 318 × 220 px chart). The states that matter here are the ones
// the old sections handled by rendering nothing at all — `disabled` and
// `preparing` — because "nothing" on the front page reads as a broken product
// rather than a young one (redesign row 12).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'
import {
  starsOfMentioned,
  type RatingCounts,
} from '#/contexts/ai/application/aspect-review-evidence'
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { OverviewGuestVoice } from './overview-guest-voice'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

const trend = (value: unknown) =>
  (async () => value) as unknown as typeof getPropertyAiTrendFn
const aggregates = (value: unknown) =>
  (async () => value) as unknown as typeof getPropertyAiAggregatesFn

type Window = Readonly<{ ratingCounts: RatingCounts; reviewCount: number }>

function topic(
  window: Window,
  aspect: string,
  polarity: 'positive' | 'negative',
  ratingCounts: RatingCounts,
  impact: number,
) {
  const reviewCount = ratingCounts.reduce((total, count) => total + count, 0)
  return {
    aspect,
    polarity,
    mentionCount: reviewCount,
    reviewCount,
    ratingCounts,
    stars: starsOfMentioned(ratingCounts, window),
    impact,
  }
}

/** A read of the last 30 days: `analysed` reviews with topics, and the topics they name. */
function thirtyDays(analysed: number, aspects: readonly unknown[]) {
  return {
    status: 'ready',
    provisional: false,
    coverage: {
      settledAnalysisCount: analysed + 8,
      expectedAnalysisCount: analysed + 8,
      awaitingAnalysisCount: 0,
    },
    startLocalDate: '2026-06-01',
    endLocalDate: '2026-06-30',
    reviewCount: analysed + 8,
    analyzedReviewCount: analysed,
    preAspectAnalysisCount: 0,
    impactVersion: 'aspect-impact-v1',
    aspects,
    emergingIssues: [],
    sentimentByDay: [],
    sentimentTotals: { positive: 30, neutral: 10, negative: 6, mixed: 2 },
  }
}

// 40 reviews with topics in the 30 days; the stars they gave, 1 to 5.
const WINDOW: Window = { ratingCounts: [4, 3, 5, 10, 18], reviewCount: 40 }

const readyAggregates = thirtyDays(40, [
  topic(WINDOW, 'staff', 'positive', [0, 0, 0, 3, 8], 7.1),
  // Parking is named by more reviews than any complaint, in reviews that gave
  // the same stars as everyone else: it costs the rating nothing.
  topic(WINDOW, 'parking', 'negative', [0, 1, 2, 3, 3], -2.8),
  // Check-in is named by four, who gave one or two stars: the complaint that costs most.
  topic(WINDOW, 'check_in_out', 'negative', [3, 1, 0, 0, 0], -3.1),
])

// About three reviews with text a month: every count is one or two reviews.
const SMALL_WINDOW: Window = { ratingCounts: [1, 0, 0, 1, 1], reviewCount: 3 }

const smallPropertyAggregates = thirtyDays(3, [
  topic(SMALL_WINDOW, 'staff', 'positive', [0, 0, 0, 1, 1], 1.4),
  topic(SMALL_WINDOW, 'room', 'negative', [1, 0, 0, 0, 0], -0.9),
])

// 128 reviews with text in 30 days: a busy property.
const LARGE_WINDOW: Window = { ratingCounts: [9, 12, 16, 31, 60], reviewCount: 128 }

const largePropertyAggregates = thirtyDays(128, [
  topic(LARGE_WINDOW, 'staff', 'positive', [0, 0, 1, 9, 30], 12.5),
  topic(LARGE_WINDOW, 'service', 'negative', [6, 7, 4, 1, 0], -9.4),
  topic(LARGE_WINDOW, 'parking', 'negative', [0, 2, 5, 8, 9], -3.1),
])

const meta: Meta<typeof OverviewGuestVoice> = {
  title: 'Property/OverviewGuestVoice',
  component: OverviewGuestVoice,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
  args: {
    propertyId: PROPERTY_ID,
    serverFns: {
      getTrend: trend({
        status: 'ready',
        report: { headline: 'Staff praised more often this month' },
      }),
      getAggregates: aggregates(readyAggregates),
    },
  },
}
export default meta
type Story = StoryObj<typeof OverviewGuestVoice>

export const TopPraiseAndComplaint: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('Staff praised more often this month')).toBeVisible()
    // Counts of reviews, first: "Staff, 11 of 40 reviews".
    const praise = canvas.getByRole('link', {
      name: 'Praise: Staff, 11 of 40 reviews; open in inbox',
    })
    expect(praise).toBeVisible()
    // The link opens the Inbox on the same 30 days the count is of.
    expect(praise).toHaveAttribute('href', expect.stringContaining('aspect=staff'))
    expect(praise).toHaveAttribute('href', expect.stringContaining('polarity=positive'))
    expect(praise).toHaveAttribute('href', expect.stringContaining('since=2026-06-01'))
    expect(praise).toHaveAttribute('href', expect.stringContaining('until=2026-06-30'))
    // "Guest voice" duplicated the section heading directly above it.
    expect(canvas.getByRole('link', { name: 'All topics' })).toBeVisible()
  },
}

/** Nine reviews name parking and four name check-in: check-in is the one that costs stars. */
export const ComplaintWithMostStarsAtStake: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const complaint = await canvas.findByRole('link', {
      name: 'Complaints: Check-in/out, 4 of 40 reviews; open in inbox',
    })
    expect(complaint).toBeVisible()
    expect(complaint).toHaveAttribute(
      'href',
      expect.stringContaining('polarity=negative'),
    )
    expect(canvas.queryByText(/Parking/)).toBeNull()
  },
}

/** About three reviews with text a month: counts of one or two, and no average to claim. */
export const SmallProperty: Story = {
  args: {
    serverFns: {
      getTrend: trend({ status: 'insufficient_data' }),
      getAggregates: aggregates(smallPropertyAggregates),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByRole('link', {
        name: 'Praise: Staff, 2 of 3 reviews; open in inbox',
      }),
    ).toBeVisible()
    expect(
      canvas.getByRole('link', {
        name: 'Complaints: Room, 1 of 3 reviews; open in inbox',
      }),
    ).toBeVisible()
  },
}

/** 128 reviews with text in 30 days: service is the complaint with the most stars at stake. */
export const LargeProperty: Story = {
  args: {
    serverFns: {
      getTrend: trend({ status: 'insufficient_data' }),
      getAggregates: aggregates(largePropertyAggregates),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByRole('link', {
        name: 'Praise: Staff, 40 of 128 reviews; open in inbox',
      }),
    ).toBeVisible()
    expect(
      canvas.getByRole('link', {
        name: 'Complaints: Service, 18 of 128 reviews; open in inbox',
      }),
    ).toBeVisible()
    expect(canvas.queryByText(/Parking/)).toBeNull()
  },
}

export const AnalysisOffWithAction: Story = {
  args: {
    serverFns: {
      getTrend: trend({ status: 'disabled' }),
      getAggregates: aggregates({ status: 'disabled' }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/Turn on AI analysis to see what guests praise/),
    ).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Turn on AI analysis' })).toBeVisible()
  },
}

export const AnalysisOffWithoutPermission: Story = {
  args: AnalysisOffWithAction.args,
  // Only AccountAdmin holds `ai.manage`; a PropertyManager is told who can, like a Member.
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A manager who cannot turn it on is told who can, not shown a dead button.
    expect(await canvas.findByText(/An account admin can turn it on/)).toBeVisible()
    expect(canvas.queryByRole('link', { name: 'Turn on AI analysis' })).toBeNull()
  },
}

export const StillAnalysing: Story = {
  args: {
    serverFns: {
      getTrend: trend({ status: 'preparing' }),
      getAggregates: aggregates({ status: 'preparing' }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Analysing your reviews/)).toBeVisible()
  },
}

export const NoTopicsYet: Story = {
  args: {
    serverFns: {
      getTrend: trend({ status: 'insufficient_data' }),
      getAggregates: aggregates({
        ...readyAggregates,
        analyzedReviewCount: 0,
        aspects: [],
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/No reviews with text have been analysed yet/),
    ).toBeVisible()
  },
}

export const Unavailable: Story = {
  args: {
    serverFns: {
      // Both islands must fail for the row to give up. A rejected promise built
      // at module scope would be unhandled before any story mounts, which the
      // storybook runner reports as a failure in whichever story ran first.
      getTrend: (() => {
        throw new Error('trend unavailable')
      }) as unknown as typeof getPropertyAiTrendFn,
      getAggregates: (() => {
        throw new Error('aggregates unavailable')
      }) as unknown as typeof getPropertyAiAggregatesFn,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Guest voice is unavailable right now/)).toBeVisible()
  },
}
