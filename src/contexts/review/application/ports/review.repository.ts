// Review context — review repository port
// Per architecture: "Repository ports for all data access."

import type { Review, ReviewPlatform } from '../../domain/types'
import type {
  OrganizationId,
  PropertyId,
  ReviewId,
  GoogleConnectionId,
} from '#/shared/domain/ids'
import type {
  AiReviewSourceDenial,
  AiReviewSourceRequest,
  AiReviewSourceResult,
  AiTrendPopulationRequest,
  AiTrendPopulationResult,
} from './ai-review-source.port'
import type { ReviewProviderSubject } from '#/shared/review-provider-subject-contract'

export type StableReviewSourceIdentity = Readonly<{
  id: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  sourceContentState: 'active' | 'source_expired' | 'provider_deleted'
  firstFetchedAt: Date | null
  sourceSeenGeneration: string | null
  sentimentLabel: string | null
  sentimentScore: number | null
}>

export type ReviewRepository = Readonly<{
  findById(id: ReviewId, organizationId: OrganizationId): Promise<Review | null>
  readForAi(input: AiReviewSourceRequest): Promise<AiReviewSourceResult>
  readTrendPopulation(input: AiTrendPopulationRequest): Promise<AiTrendPopulationResult>
  assertCurrentForAi(
    input: AiReviewSourceRequest,
  ): Promise<Readonly<{ status: 'current' | AiReviewSourceDenial }>>
  readReplyStateRevision(
    organizationId: OrganizationId,
    reviewId: ReviewId,
  ): Promise<number>
  readAiAnalysisHead(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
    }>,
  ): Promise<
    | Readonly<{ status: 'current'; analysisSequence: number }>
    | Readonly<{ status: 'not_found' | 'source_epoch_changed' | 'policy_unavailable' }>
  >
  findByIds(
    ids: ReadonlyArray<ReviewId>,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<Review>>
  findByExternalId(
    platform: ReviewPlatform,
    externalId: string,
    organizationId: OrganizationId,
  ): Promise<Review | null>
  findStableIdentityByProviderSubjects(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      subjects: readonly [ReviewProviderSubject, ...ReviewProviderSubject[]]
    }>,
  ): Promise<StableReviewSourceIdentity | null>
  upsert(review: Omit<Review, 'createdAt' | 'updatedAt'>, now?: Date): Promise<Review>
  findByPropertyId(
    propertyId: PropertyId,
    organizationId: OrganizationId,
    options?: { limit?: number },
  ): Promise<ReadonlyArray<Review>>
  /**
   * BQC-1.4: serving read for recent reviews — eligible content only
   * (contentExpiresAt IS NOT NULL AND > now, predicate in SQL), newest first.
   * Operations paths use findByPropertyId instead.
   */
  findRecentEligibleByPropertyId(
    propertyId: PropertyId,
    organizationId: OrganizationId,
    options: { limit: number },
    now: Date,
  ): Promise<ReadonlyArray<Review>>
  findByOrganizationId(orgId: OrganizationId): Promise<ReadonlyArray<Review>>
  /**
   * BQC-3.8: keyset-bounded batch of reviews sourced through a Google
   * connection (reviews.google_connection_id), ordered by id. `cursor`
   * resumes strictly AFTER the given review id. Used by the disconnect
   * publication-cancellation flow (same resolution the source-content purge
   * applies: google_connection_id equality within the organization).
   */
  findByConnection(
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
    cursor: Readonly<{ id: string }> | null,
    limit: number,
  ): Promise<ReadonlyArray<Review>>
  /**
   * Review-owned eligible id query for cross-context list filters (BQC-1.2).
   * Returns ids of reviews whose content is eligible at `now`
   * (contentExpiresAt IS NOT NULL AND > now), optionally narrowed by rating
   * range and case-insensitive text search. Callers avoid cross-context JOINs.
   */
  findIdsByContentFilter(
    orgId: OrganizationId,
    filter: Readonly<{ ratingMin?: number; ratingMax?: number; textQuery?: string }>,
    now: Date,
  ): Promise<ReadonlyArray<string>>
  /**
   * ⚠️ CROSS-TENANT: BQC-1.5 keyset-bounded batch of expiring reviews,
   * ordered (contentExpiresAt ASC, id ASC). `cursor` resumes strictly AFTER
   * (contentExpiresAt, id) — no row is skipped or repeated as the cursor
   * advances. Replaces the one-shot 5,000-row scan.
   */
  findExpiringBatchAcrossTenants(
    date: Date,
    cursor: Readonly<{ contentExpiresAt: Date; id: string }> | null,
    limit: number,
  ): Promise<ReadonlyArray<Review>>
  /**
   * ⚠️ CROSS-TENANT: BQC-8.3 keyset-bounded batch of expired reviews —
   * non-null `contentExpiresAt < date` (exclusive; no post-expiry grace,
   * ADR 0031), ordered (contentExpiresAt ASC, id ASC). `cursor` resumes
   * strictly AFTER (contentExpiresAt, id). Used by purge-expired (pass
   * `now`); replaces the one-shot 5,000-row scan
   * (findAllExpiredBeforeAcrossTenants).
   */
  findExpiredBatchBeforeAcrossTenants(
    date: Date,
    cursor: Readonly<{ contentExpiresAt: Date; id: string }> | null,
    limit: number,
  ): Promise<ReadonlyArray<Review>>
  /**
   * ⚠️ CROSS-TENANT: exact count of purge-eligible rows (non-null
   * `contentExpiresAt < date`, exclusive). BQC-8.3: the restore drill's
   * dry-run/zero-remaining probe — a COUNT, not a bounded scan, so the
   * number stays honest at any scale.
   */
  countExpiredBeforeAcrossTenants(date: Date): Promise<number>
  deleteById(id: ReviewId, organizationId: OrganizationId): Promise<void>
  deleteByPropertyId(
    propertyId: PropertyId,
    organizationId: OrganizationId,
  ): Promise<void>
}>
