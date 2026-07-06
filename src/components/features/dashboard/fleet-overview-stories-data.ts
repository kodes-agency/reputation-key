import type {
  FleetEntry,
  FleetOverviewData,
} from '#/contexts/dashboard/application/public-api'

// Seed data for fleet-overview.stories.tsx — extracted for line-count compliance.
// Attention signals sum into totalAttention (ratingDrop counts as 1):
//   unanswered + newFeedback + goalsBehindPace + escalated + (ratingDrop ? 1 : 0)
export const entries: readonly FleetEntry[] = [
  {
    propertyId: 'prop-0001',
    name: 'The Meridian Grand',
    slug: 'meridian-grand',
    timezone: 'America/New_York',
    avgRating: 4.2,
    avgRatingTrend: 0.3, // improving
    reviewCount: 312,
    feedbackCount: 48,
    scanCount: 6,
    attentionSignals: {
      unanswered: 5,
      newFeedback: 2,
      goalsBehindPace: 1,
      ratingDrop: false,
      escalated: 0,
    },
    totalAttention: 8,
  },
  {
    propertyId: 'prop-0002',
    name: 'Harborline Suites',
    slug: 'harborline-suites',
    timezone: 'America/Los_Angeles',
    avgRating: 3.4,
    avgRatingTrend: -0.8, // declining — drives ratingDrop below
    reviewCount: 189,
    feedbackCount: 31,
    scanCount: 4,
    attentionSignals: {
      unanswered: 9,
      newFeedback: 4,
      goalsBehindPace: 2,
      ratingDrop: true,
      escalated: 1,
    },
    totalAttention: 17,
  },
  {
    propertyId: 'prop-0003',
    name: 'Northgate Inn',
    slug: 'northgate-inn',
    timezone: 'America/Chicago',
    avgRating: 4.7,
    avgRatingTrend: 0.1,
    reviewCount: 521,
    feedbackCount: 22,
    scanCount: 3,
    attentionSignals: {
      unanswered: 0,
      newFeedback: 0,
      goalsBehindPace: 0,
      ratingDrop: false,
      escalated: 0,
    },
    totalAttention: 0,
  },
  {
    propertyId: 'prop-0004',
    name: 'Cedar & Vine Boutique',
    slug: 'cedar-vine',
    timezone: 'America/Denver',
    avgRating: 0, // new property, no ratings yet
    avgRatingTrend: null, // no prior period
    reviewCount: 0,
    feedbackCount: 3,
    scanCount: 1,
    attentionSignals: {
      unanswered: 0,
      newFeedback: 3,
      goalsBehindPace: 0,
      ratingDrop: false,
      escalated: 0,
    },
    totalAttention: 3,
  },
]

export const populatedData: FleetOverviewData = {
  entries,
  // Mean of rated properties (Cedar & Vine's 0 is excluded): (4.2 + 3.4 + 4.7) / 3.
  totals: {
    propertyCount: entries.length,
    totalAttention: entries.reduce((sum, e) => sum + e.totalAttention, 0),
    overallAvgRating: 4.1,
  },
}
