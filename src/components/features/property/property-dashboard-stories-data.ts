import type {
  AttentionSignals,
  DashboardData,
} from '#/contexts/dashboard/application/public-api'
import { reviewId } from '#/shared/domain/ids'

// Seed data for property-dashboard.stories.tsx — extracted for line-count compliance.
export const property = {
  id: 'prop-00000000-0000-0000-0000-000000000001',
  name: 'Harborline Suites',
}

export const populatedDashboard: DashboardData = {
  kpis: {
    reviews: { value: 142, priorValue: 120, trend: 18.3 },
    avgRating: { value: 4.3, priorValue: 4.1, trend: 4.9 },
    scans: { value: 980, priorValue: 1100, trend: -10.9 },
    feedback: { value: 56, priorValue: 56, trend: 0 },
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
  newFeedback: 7,
  goalsBehindPace: 1,
  ratingDrop: false,
  escalated: 2,
}

export const emptyDashboard: DashboardData = {
  kpis: {
    reviews: { value: 0, priorValue: 0, trend: null },
    avgRating: { value: 0, priorValue: 0, trend: null },
    scans: { value: 0, priorValue: 0, trend: null },
    feedback: { value: 0, priorValue: 0, trend: null },
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
  newFeedback: 0,
  goalsBehindPace: 0,
  ratingDrop: false,
  escalated: 0,
}
