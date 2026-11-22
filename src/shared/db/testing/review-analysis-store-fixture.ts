// Test fixture: the rows a Review Analysis store suite starts from. A Property
// with its analysis head, a Review with its source content and Material Review
// Revision, and the analysis operation that is working on it. Every row is
// synthetic; the review and operation inserts keep their upsert and
// fresh-origin-event semantics so a suite can seed the same review again.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiOperations,
  aiPropertyProcessingProfiles,
  materialReviewRevisions,
  properties,
  reviewAiAnalysisHeads,
  reviewSourceContents,
  reviews,
} from '#/shared/db/schema'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation/ai-operation-profiles'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { REVIEW_ANALYSIS_NORMALIZATION_DIGEST } from '#/shared/analysis/normalizer'
import { readOperationControlColumns } from './ai-execution-control-fixture'

const SYNTHETIC_BYTE_COUNT = 24

export type AnalysisPropertyInput = Readonly<{
  organizationId: string
  propertyId: string
  name: string
  slug: string
  timezone: string
  countryCode: string
  sourceEpoch: number
  headSequence: number
  now: Date
  /** Also writes the active processing profile of the Property. */
  processingProfile?: boolean
}>

/** An organization, its Property, the Review Analysis head, and optionally the processing profile. */
export async function seedAnalysisProperty(
  db: Database,
  input: AnalysisPropertyInput,
): Promise<void> {
  const { organizationId, propertyId, sourceEpoch, now } = input
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organizationId}, ${input.name}, ${organizationId}, ${now})
  `)
  await db.insert(properties).values({
    id: propertyId,
    organizationId,
    name: `${input.name} property`,
    slug: input.slug,
    timezone: input.timezone,
    countryCode: input.countryCode,
    profileVersion: 1,
    sourceEpoch,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId,
    propertyId,
    sourceEpoch,
    headSequence: input.headSequence,
    createdAt: now,
    updatedAt: now,
  })
  if (!input.processingProfile) return
  await db.insert(aiPropertyProcessingProfiles).values({
    propertyId,
    organizationId,
    countryCode: input.countryCode,
    timezone: input.timezone,
    processingRegion: 'global',
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
    sourceEpoch,
    profileVersion: 1,
    lifecycleState: 'active',
    updatedAt: now,
  })
}

export type SeedReviewInput = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  externalId: string
  externalLocationId: string
  reviewedAt: Date
  contentExpiresAt: Date
}>

/** One review, its source content and its revision; seeding it again moves the sequence and revision. */
export async function seedReview(db: Database, input: SeedReviewInput): Promise<void> {
  const { id, organizationId, propertyId, sourceEpoch, sourceRevision } = input
  const { analysisSequence, reviewedAt } = input
  await db
    .insert(reviews)
    .values({
      id,
      organizationId,
      propertyId,
      platform: 'google',
      firstFetchedAt: reviewedAt,
      sourceEpoch,
      sourceRevision,
      analysisSequence,
    })
    .onConflictDoUpdate({
      target: reviews.id,
      set: { analysisSequence, sourceRevision },
    })
  await db
    .insert(reviewSourceContents)
    .values({
      reviewId: id,
      organizationId,
      propertyId,
      platform: 'google',
      externalId: input.externalId,
      externalLocationId: input.externalLocationId,
      reviewerName: 'Synthetic reviewer',
      rating: 2,
      text: 'Synthetic review',
      languageCode: 'en',
      reviewedAt,
      lastFetchedAt: reviewedAt,
      contentExpiresAt: input.contentExpiresAt,
      sourceEpoch,
      sourceRevision,
      aiSourceByteLength: SYNTHETIC_BYTE_COUNT,
      aiSourceDigest: 'a'.repeat(64),
    })
    .onConflictDoUpdate({
      target: reviewSourceContents.reviewId,
      set: { sourceRevision },
    })
  await db
    .insert(materialReviewRevisions)
    .values({
      reviewId: id,
      revision: sourceRevision,
      organizationId,
      propertyId,
      sourceEpoch,
      normalizationVersion: 'legacy-unverified-v0',
      rating: 2,
      normalizedText: 'Synthetic review',
    })
    .onConflictDoNothing()
}

export type InsertOperationInput = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  reviewId: string
  authorizationLineageId: string
  analysisSequence: number
  sourceEpoch: number
  sourceRevision: number
  profile: 'review-analysis-v2' | 'review-analysis-v3'
  state: 'executing' | 'failed' | 'succeeded' | 'pending'
  idempotencyKey: string
  requestFingerprint: string
  sourceDigest: string
  subjectHmacKeyVersion: string
  reviewedAt: Date
  now: Date
  expiresAt: Date
  executionAttempt: number
  /** Defaults to a fresh id for each operation. */
  originEventId?: string
  failureCode?: string | null
  reviewAnalysisEpoch?: number
}>

/**
 * One analysis operation stamped from the current control heads. Under the v3
 * profile it also carries the provider, vocabulary and normalization lineage
 * the database requires of it; under v2 it carries none.
 */
export async function insertAnalysisOperation(
  db: Database,
  input: InsertOperationInput,
): Promise<void> {
  const controls = await readOperationControlColumns(db)
  const v3 = input.profile === 'review-analysis-v3'
  await db.insert(aiOperations).values({
    id: input.id,
    idempotencyScope: `analysis:${input.id}`,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    sourceDigest: input.sourceDigest,
    sourceByteCount: SYNTHETIC_BYTE_COUNT,
    command: 'analysis',
    capability: 'review_analysis',
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    actorUserId: null,
    systemPrincipal: 'review_event_consumer',
    reviewId: input.reviewId,
    originEventId: input.originEventId ?? randomUUID(),
    subjectHmac: 'd'.repeat(64),
    subjectHmacKeyVersion: input.subjectHmacKeyVersion,
    sourceEpoch: input.sourceEpoch,
    sourceRevision: input.sourceRevision,
    reviewedAtEpochMillis: input.reviewedAt.getTime(),
    analysisSequence: input.analysisSequence,
    authorizationLineageId: input.authorizationLineageId,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    evaluatedLanguage: 'en',
    propertyProfileVersion: 1,
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
    operationProfileVersion: input.profile,
    capabilityRuntimeProfileVersion: v3
      ? 'review-analysis-runtime-v2'
      : 'review-analysis-runtime-v1',
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    sourceCanonicalizerDigest: 'e'.repeat(64),
    redactionProfileVersion: 'gbp-review-global-v1',
    ...controls,
    capabilityFences: {
      capability: 'review_analysis',
      reviewAnalysisEpoch: input.reviewAnalysisEpoch ?? 1,
    },
    routeKey: 'review-analysis',
    state: input.state,
    executionAttempt: input.executionAttempt,
    failureCode: input.failureCode ?? null,
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: input.expiresAt,
    ...(v3
      ? {
          providerId: 'openai',
          providerModel: 'synthetic-model-2026-10-01',
          providerRequestProfileVersion: 'synthetic-request-profile-v1',
          providerRequestProfileDigest: '1'.repeat(64),
          vocabularyHintSetId: 'generic-service',
          vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
          vocabularyHintSetDigest: '2'.repeat(64),
          normalizationProfileVersion: 'review-analysis-normalization-v1',
          normalizationProfileDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
        }
      : {}),
  })
}
