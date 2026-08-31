import type {
  FleetEntry,
  FleetOverviewData,
} from '#/contexts/dashboard/application/public-api'

// Story-only seed data; the `.stories.` segment keeps it out of production
// source inventories and bundles.
// `needsAttention` is a distinct work-anchor union; overlapping chips do not
// add twice. A supported rating-drop signal contributes one additional concern.
const reviewEvidence = {
  definitionVersionId: '10000000-0000-4000-8000-000000000004',
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-08-01T00:00:00Z'),
  timezone: 'UTC',
  sourcePolicies: ['google_property_derivative'],
  watermark: new Date('2026-07-31T18:00:00Z'),
  freshness: 'fresh' as const,
  completeness: 1,
  correctionCount: 0,
}
const scanEvidence = {
  ...reviewEvidence,
  definitionVersionId: '10000000-0000-4000-8000-000000000001',
  sourcePolicies: ['portal_first_party_v1'],
}
const feedbackEvidence = {
  ...reviewEvidence,
  definitionVersionId: '10000000-0000-4000-8000-000000000002',
  sourcePolicies: ['portal_first_party_v1'],
}
export const entries: readonly FleetEntry[] = [
  {
    propertyId: 'prop-0001',
    name: 'The Meridian Grand',
    slug: 'meridian-grand',
    timezone: 'America/New_York',
    avgRating: 4.2,
    avgRatingComparison: 0.3, // improving
    reviewCount: 312,
    feedbackCount: 48,
    scanCount: 6,
    reviewEvidence,
    scanEvidence,
    feedbackEvidence,
    attentionSignals: {
      unanswered: 5,
      itemsToTriage: 2,
      goalsBehindPace: 1,
      ratingDrop: false,
      escalated: 0,
      needsAttention: 8,
    },
    totalAttention: 8,
  },
  {
    propertyId: 'prop-0002',
    name: 'Harborline Suites',
    slug: 'harborline-suites',
    timezone: 'America/Los_Angeles',
    avgRating: 3.4,
    avgRatingComparison: -0.8, // declining — drives ratingDrop below
    reviewCount: 189,
    feedbackCount: 31,
    scanCount: 4,
    reviewEvidence,
    scanEvidence,
    feedbackEvidence,
    attentionSignals: {
      unanswered: 9,
      itemsToTriage: 4,
      goalsBehindPace: 2,
      ratingDrop: true,
      escalated: 1,
      needsAttention: 16,
    },
    totalAttention: 16,
  },
  {
    propertyId: 'prop-0003',
    name: 'Northgate Inn',
    slug: 'northgate-inn',
    timezone: 'America/Chicago',
    avgRating: 4.7,
    avgRatingComparison: 0.1,
    reviewCount: 521,
    feedbackCount: 22,
    scanCount: 3,
    reviewEvidence,
    scanEvidence,
    feedbackEvidence,
    attentionSignals: {
      unanswered: 0,
      itemsToTriage: 0,
      goalsBehindPace: 0,
      ratingDrop: false,
      escalated: 0,
      needsAttention: 0,
    },
    totalAttention: 0,
  },
  {
    propertyId: 'prop-0004',
    name: 'Cedar & Vine Boutique',
    slug: 'cedar-vine',
    timezone: 'America/Denver',
    avgRating: 0, // new property, no ratings yet
    avgRatingComparison: null, // no prior period
    reviewCount: 0,
    feedbackCount: 3,
    scanCount: 1,
    reviewEvidence: {
      ...reviewEvidence,
      watermark: null,
      freshness: 'insufficient_data',
      completeness: 0,
    },
    scanEvidence,
    feedbackEvidence,
    attentionSignals: {
      unanswered: 0,
      itemsToTriage: 3,
      goalsBehindPace: 0,
      ratingDrop: false,
      escalated: 0,
      needsAttention: 3,
    },
    totalAttention: 3,
  },
]

export const populatedData: FleetOverviewData = {
  entries,
  totals: {
    propertyCount: entries.length,
    ratingSampleCount: entries.reduce((sum, entry) => sum + entry.reviewCount, 0),
    totalAttention: entries.reduce((sum, e) => sum + e.totalAttention, 0),
    overallAvgRating: 4.3,
  },
  nextCursor: null,
}
