import type {
  AttentionSignals,
  DashboardData,
  RatingKPIValue,
} from '#/contexts/reporting/public-api'
import { inboxItemId, reviewId } from '#/shared/domain/ids'

// Seed data for property-dashboard.stories.tsx — extracted for line-count compliance.
export const property = {
  id: 'prop-00000000-0000-0000-0000-000000000001',
  name: 'Harborline Suites',
  timezone: 'Europe/Sofia',
  googleBindingState: 'active' as const,
}

const readyRatingEvidence: RatingKPIValue['evidence'] = {
  definitionVersionId: null,
  state: 'ready',
  verifiedThrough: new Date('2026-07-01T12:00:00.000Z'),
  latestActivity: new Date('2026-07-01T10:00:00.000Z'),
  computedAt: new Date('2026-07-01T12:00:00.000Z'),
  completeness: 1,
  availabilityReason: null,
  correctionHead: null,
  sampleCount: 142,
}

const insufficientRatingEvidence: RatingKPIValue['evidence'] = {
  ...readyRatingEvidence,
  state: 'insufficient_data',
  verifiedThrough: null,
  latestActivity: null,
  sampleCount: 0,
}

export const populatedDashboard: DashboardData = {
  kpis: {
    reviews: { value: 142, priorValue: 120, trend: 18.3 },
    avgRating: {
      value: 4.3,
      priorValue: 4.1,
      comparison: 0.2,
      sampleCount: 142,
      priorSampleCount: 120,
      evidence: readyRatingEvidence,
    },
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
  recentReviews: [
    {
      id: reviewId('rev-00000000-0000-0000-0000-000000000001'),
      rating: 5,
      snippet: 'Amazing service and spotless rooms!',
      reviewedAt: new Date('2026-07-01T10:00:00Z'),
      replyStatus: 'published',
      // Opens its own item in the Inbox; the second review has none for this reader.
      inboxItemId: inboxItemId('30000000-0000-4000-8000-000000000001'),
    },
    {
      id: reviewId('rev-00000000-0000-0000-0000-000000000002'),
      rating: 2,
      snippet: 'Slow response from the front desk.',
      reviewedAt: new Date('2026-06-28T14:30:00Z'),
      replyStatus: 'none',
      inboxItemId: null,
    },
  ],
}

export const activeSignals: AttentionSignals = {
  overdue: 3,
  itemsToTriage: 7,
  goalsBehindPace: 1,
  ratingDrop: false,
  escalated: 2,
  needsAttention: 8,
}

export const noDataDashboard: DashboardData = {
  kpis: {
    reviews: { value: 0, priorValue: 0, trend: null },
    avgRating: {
      value: null,
      priorValue: null,
      comparison: null,
      sampleCount: 0,
      priorSampleCount: 0,
      evidence: insufficientRatingEvidence,
    },
  },
  ratingDistribution: [],
  ratingTrend: [],
  reviewVolume: [],
  replyPerformance: { replyRate: 0, avgReplyHours: null },
  recentReviews: [],
}

export const calmSignals: AttentionSignals = {
  overdue: 0,
  itemsToTriage: 0,
  goalsBehindPace: 0,
  ratingDrop: false,
  escalated: 0,
  needsAttention: 0,
}
