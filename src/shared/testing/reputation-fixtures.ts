// Test-only builders for the Review and Reply records that integration suites
// seed through the repositories. Callers name the identity (ids, tenant, property,
// external id); every other field gets a neutral value that a suite overrides
// only where it checks it.

import type { Reply, Review } from '#/contexts/reputation/domain/review-types'
import type {
  OrganizationId,
  PropertyId,
  ReplyId,
  ReviewId,
  UserId,
} from '#/shared/domain/ids'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from './google-provider-identifiers-v1'

export const REPUTATION_FIXTURE_NOW = new Date('2026-08-20T12:00:00.000Z')
export const REPUTATION_FIXTURE_EXPIRES = new Date('2026-09-20T12:00:00.000Z')

export type TestReview = Omit<Review, 'createdAt' | 'updatedAt'>

type TestReviewIdentity = Readonly<{
  id: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  externalId: string
}>

export function buildTestReview(
  overrides: TestReviewIdentity & Partial<TestReview>,
): TestReview {
  return {
    platform: 'google',
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Observation test guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text: 'Material review text',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: REPUTATION_FIXTURE_NOW,
    expiresAt: REPUTATION_FIXTURE_EXPIRES,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: REPUTATION_FIXTURE_NOW,
    sourceUpdatedAt: REPUTATION_FIXTURE_NOW,
    firstFetchedAt: REPUTATION_FIXTURE_NOW,
    lastFetchedAt: REPUTATION_FIXTURE_NOW,
    contentExpiresAt: REPUTATION_FIXTURE_EXPIRES,
    contentHash: null,
    sourceSeenGeneration: 'a1000000-0000-0000-0000-000000000100',
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    ...overrides,
  }
}

type TestReplyIdentity = Readonly<{
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  createdBy: UserId
}>

export function buildTestReply(overrides: TestReplyIdentity & Partial<Reply>): Reply {
  return {
    text: 'Thank you for your review!',
    status: 'pending_approval',
    source: 'internal',
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: REPUTATION_FIXTURE_NOW,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationCycle: 0,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: REPUTATION_FIXTURE_NOW,
    updatedAt: REPUTATION_FIXTURE_NOW,
    ...overrides,
  }
}
