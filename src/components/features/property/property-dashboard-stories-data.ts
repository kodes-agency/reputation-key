import type {
  AttentionSignals,
  DashboardData,
  MetricKPIValue,
} from '#/contexts/dashboard/application/public-api'
import { reviewId } from '#/shared/domain/ids'

// Seed data for property-dashboard.stories.tsx — extracted for line-count compliance.
export const property = {
  id: 'prop-00000000-0000-0000-0000-000000000001',
  name: 'Harborline Suites',
}

const availableMetricKpi = (
  value: number,
  priorValue: number,
  trend: number | null,
): MetricKPIValue => ({
  value,
  priorValue,
  trend,
  evidence: {
    current: {
      state: 'available',
      definitionVersionId: 'property-story-current',
      sampleCount: Math.max(value, 1),
      minimumSample: 1,
    },
    prior: {
      state: 'available',
      definitionVersionId: 'property-story-prior',
      sampleCount: Math.max(priorValue, 1),
      minimumSample: 1,
    },
  },
})

const updatingMetricKpi: MetricKPIValue = {
  value: null,
  priorValue: null,
  trend: null,
  evidence: {
    current: {
      state: 'updating',
      definitionVersionId: null,
      sampleCount: 0,
      minimumSample: null,
    },
    prior: null,
  },
}

export const populatedDashboard: DashboardData = {
  kpis: {
    reviews: { value: 142, priorValue: 120, trend: 18.3 },
    avgRating: { value: 4.3, priorValue: 4.1, trend: 4.9 },
    scans: availableMetricKpi(980, 1100, -10.9),
    feedback: availableMetricKpi(56, 56, 0),
  },
  ratingDistribution: [
    { stars: 5, count: 80 },
    { stars: 4, count: 40 },
    { stars: 3, count: 12 },
    { stars: 2, count: 6 },
    { stars: 1, count: 4 },
  ],
  ratingTrend: [
    { date: '2026-06-01', avgRating: 4.1 },
    { date: '2026-06-15', avgRating: 4.3 },
    { date: '2026-07-01', avgRating: 4.4 },
  ],
  reviewVolume: [
    { date: '2026-06-01', count: 12 },
    { date: '2026-06-15', count: 18 },
    { date: '2026-07-01', count: 15 },
  ],
  replyPerformance: { replyRate: 78, avgReplyHours: 6.5 },
  engagementFunnel: { scans: 980, ratings: 142, reviewLinkClicks: 320 },
  recentReviews: [
    {
      id: reviewId('rev-00000000-0000-0000-0000-000000000001'),
      rating: 5,
      snippet: 'Amazing service and spotless rooms!',
      reviewedAt: new Date('2026-07-01T10:00:00Z'),
      replyStatus: 'published',
    },
    {
      id: reviewId('rev-00000000-0000-0000-0000-000000000002'),
      rating: 2,
      snippet: 'Slow response from the front desk.',
      reviewedAt: new Date('2026-06-28T14:30:00Z'),
      replyStatus: 'none',
    },
  ],
}

export const activeSignals: AttentionSignals = {
  unanswered: 3,
  itemsToTriage: 7,
  goalsBehindPace: 1,
  ratingDrop: false,
  escalated: 2,
  needsAttention: 8,
}

export const emptyDashboard: DashboardData = {
  kpis: {
    reviews: { value: 0, priorValue: 0, trend: null },
    avgRating: { value: 0, priorValue: 0, trend: null },
    scans: updatingMetricKpi,
    feedback: updatingMetricKpi,
  },
  ratingDistribution: [],
  ratingTrend: [],
  reviewVolume: [],
  replyPerformance: { replyRate: 0, avgReplyHours: null },
  engagementFunnel: null,
  recentReviews: [],
}

export const calmSignals: AttentionSignals = {
  unanswered: 0,
  itemsToTriage: 0,
  goalsBehindPace: 0,
  ratingDrop: false,
  escalated: 0,
  needsAttention: 0,
}
