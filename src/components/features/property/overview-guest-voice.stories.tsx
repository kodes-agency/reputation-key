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
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { OverviewGuestVoice } from './overview-guest-voice'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

const trend = (value: unknown) =>
  (async () => value) as unknown as typeof getPropertyAiTrendFn
const aggregates = (value: unknown) =>
  (async () => value) as unknown as typeof getPropertyAiAggregatesFn

const readyAggregates = {
  status: 'ready',
  provisional: false,
  coverage: {
    settledAnalysisCount: 48,
    expectedAnalysisCount: 48,
    awaitingAnalysisCount: 0,
  },
  startLocalDate: '2026-06-01',
  endLocalDate: '2026-06-30',
  reviewCount: 48,
  analyzedReviewCount: 48,
  preAspectAnalysisCount: 0,
  impactVersion: 'aspect-impact-v1',
  aspects: [
    { aspect: 'staff', polarity: 'positive', mentionCount: 11, impact: 7.1 },
    { aspect: 'parking', polarity: 'negative', mentionCount: 4, impact: -2.8 },
  ],
  emergingIssues: [],
  sentimentByDay: [],
  sentimentTotals: { positive: 30, neutral: 10, negative: 6, mixed: 2 },
}

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
    expect(canvas.getByText('Praise')).toBeVisible()
    expect(canvas.getByText('Staff')).toBeVisible()
    expect(canvas.getByText('×11')).toBeVisible()
    expect(canvas.getByText('Complaints')).toBeVisible()
    expect(canvas.getByText('Parking')).toBeVisible()
    expect(canvas.getByRole('link', { name: 'Guest voice' })).toBeVisible()
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
  // PropertyManager holds `ai.manage`; Member is the role that does not.
  decorators: [withRole('Member')],
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
      getTrend: trend(Promise.reject(new Error('down'))),
      getAggregates: (() => {
        throw new Error('down')
      }) as unknown as typeof getPropertyAiAggregatesFn,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/Guest voice is unavailable right now/)).toBeVisible()
  },
}
