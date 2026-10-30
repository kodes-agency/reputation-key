// A real-PostgreSQL fixture for tests of the Review Analysis v3 tables: one
// Property, and on demand a Review with its Material Review Revision, the
// operation that analysed it, the analysis (v2 or v3 shaped), and optionally the
// aggregate contribution built from it. It writes only synthetic rows, with
// ids and counters and no review text beyond a placeholder.

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiOperations,
  aiPropertyAggregateContributions,
  aiPropertyIssueGroups,
  aiReviewAnalyses,
  materialReviewRevisions,
  properties,
  reviews,
} from '#/shared/db/schema'
import { deleteTestOrganizationsWithExecutor } from './test-organization-cleanup'

const SYNTHETIC_DIGEST = 'a'.repeat(64)
const SOURCE_EPOCH = 0
const SOURCE_REVISION = 1
const REVIEW_ANALYSIS_EPOCH = 1
const PROPERTY_PROFILE_VERSION = 1

export type AiAnalysisFixtureProfile = 'review-analysis-v2' | 'review-analysis-v3'

export type AiAnalysisKey = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
}>

export type AiAnalysisFixtureSeed = Readonly<{
  profile: AiAnalysisFixtureProfile
  /** The analysis's own stamped deadline (`ai_review_analyses.expires_at`). */
  expiresAt: Date
  analysisSequence: number
  /** Attention of a ready analysis; defaults to 'high'. */
  attention?: 'urgent' | 'high' | 'medium' | 'low'
  urgentReason?: string | null
  /** Insert the aggregate contribution built from the analysis. */
  withContribution?: boolean
}>

export type AiAnalysisFixture = Readonly<{
  organizationId: string
  propertyId: string
  /** Insert one Review, its operation and its analysis; returns the analysis key. */
  seedAnalysis(seed: AiAnalysisFixtureSeed): Promise<AiAnalysisKey>
  /** Delete every analysis, review and operation the fixture seeded; keep the Property. */
  reset(): Promise<void>
  /** Delete everything the fixture wrote. */
  remove(): Promise<void>
}>

export type AiAnalysisFixtureInput = Readonly<{
  db: Database
  organizationId: string
  propertyId: string
  /** Stamped on every seeded row; keep it behind the database clock. */
  now: Date
}>

async function controlHeads(db: Database) {
  const heads = await db
    .select({
      scopeKey: aiExecutionControlHeads.scopeKey,
      controlId: aiExecutionControlHeads.controlId,
      generation: aiExecutionControlHeads.generation,
    })
    .from(aiExecutionControlHeads)
  const find = (scopeKey: string) => {
    const head = heads.find((candidate) => candidate.scopeKey === scopeKey)
    if (!head) throw new Error(`AI execution control ${scopeKey} is not seeded`)
    return head
  }
  return {
    global: find('global'),
    provider: find('provider:private-beta-global-v1'),
    capability: find('capability:review_analysis'),
  }
}

export async function installAiAnalysisFixture(
  input: AiAnalysisFixtureInput,
): Promise<AiAnalysisFixture> {
  const { db, organizationId, propertyId, now } = input

  const reset = async () => {
    // An analysis holds its operation and its review revision with RESTRICT, so
    // analyses go first (their mentions and contribution cascade), then reviews.
    await db
      .delete(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.organizationId, organizationId))
    await db
      .delete(aiPropertyIssueGroups)
      .where(eq(aiPropertyIssueGroups.organizationId, organizationId))
    await db.delete(reviews).where(eq(reviews.organizationId, organizationId))
    await db.delete(aiOperations).where(eq(aiOperations.organizationId, organizationId))
  }
  const clear = async () => {
    await reset()
    await db.delete(properties).where(eq(properties.id, propertyId))
    await deleteTestOrganizationsWithExecutor(db, [organizationId])
  }

  await clear()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organizationId}, 'AI v3 analysis fixture', ${organizationId}, ${now})
  `)
  await db.insert(properties).values({
    id: propertyId,
    organizationId,
    name: 'AI v3 analysis fixture property',
    slug: `ai-v3-fixture-${propertyId.slice(0, 8)}`,
    timezone: 'America/New_York',
    countryCode: 'US',
    profileVersion: 1,
    sourceEpoch: SOURCE_EPOCH,
  })
  const controls = await controlHeads(db)

  return Object.freeze({
    organizationId,
    propertyId,
    async seedAnalysis(seed: AiAnalysisFixtureSeed): Promise<AiAnalysisKey> {
      const reviewId = randomUUID()
      const operationId = randomUUID()
      const isV3 = seed.profile === 'review-analysis-v3'
      const attention = seed.attention ?? 'high'
      await db.insert(reviews).values({
        id: reviewId,
        organizationId,
        propertyId,
        platform: 'google',
        externalId: `ai-v3-fixture-${reviewId}`,
        reviewerName: 'Synthetic reviewer',
        rating: 2,
        text: 'Synthetic review',
        languageCode: 'en',
        reviewedAt: now,
        contentExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: seed.analysisSequence,
        aiSourceByteLength: 16,
        aiSourceDigest: SYNTHETIC_DIGEST,
      })
      await db.insert(materialReviewRevisions).values({
        reviewId,
        revision: SOURCE_REVISION,
        organizationId,
        propertyId,
        sourceEpoch: SOURCE_EPOCH,
        normalizationVersion: 'legacy-unverified-v0',
        rating: 2,
        normalizedText: 'Synthetic review',
      })
      await db.insert(aiOperations).values({
        id: operationId,
        idempotencyScope: `analysis:${operationId}`,
        idempotencyKey: operationId,
        requestFingerprint: 'f'.repeat(64),
        sourceDigest: SYNTHETIC_DIGEST,
        sourceByteCount: 16,
        command: 'analysis',
        capability: 'review_analysis',
        organizationId,
        propertyId,
        actorUserId: null,
        systemPrincipal: 'review_event_consumer',
        reviewId,
        originEventId: randomUUID(),
        subjectHmac: 'd'.repeat(64),
        subjectHmacKeyVersion: 'ai-v3-fixture-v1',
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        reviewedAtEpochMillis: now.getTime(),
        analysisSequence: seed.analysisSequence,
        authorizationLineageId: randomUUID(),
        noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
        noticeDigest: 'c'.repeat(64),
        evaluatedLanguage: 'en',
        propertyProfileVersion: PROPERTY_PROFILE_VERSION,
        routingPolicyVersion: 1,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        operationProfileVersion: seed.profile,
        capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        sourceCanonicalizerDigest: 'e'.repeat(64),
        redactionProfileVersion: 'gbp-review-global-v1',
        globalControlId: controls.global.controlId,
        globalControlGeneration: controls.global.generation,
        providerControlId: controls.provider.controlId,
        providerControlGeneration: controls.provider.generation,
        capabilityControlId: controls.capability.controlId,
        capabilityControlGeneration: controls.capability.generation,
        capabilityFences: {
          capability: 'review_analysis',
          reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
        },
        routeKey: 'review-analysis',
        state: 'succeeded',
        executionAttempt: 1,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        ...(isV3
          ? {
              providerId: 'openai',
              providerModel: 'synthetic-model-2026-10-01',
              providerRequestProfileVersion: 'synthetic-request-profile-v1',
              providerRequestProfileDigest: '1'.repeat(64),
              vocabularyHintSetId: 'generic-service',
              vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
              vocabularyHintSetDigest: '2'.repeat(64),
              normalizationProfileVersion: 'review-analysis-normalization-v1',
              normalizationProfileDigest: '3'.repeat(64),
            }
          : {}),
      })
      await db.insert(aiReviewAnalyses).values({
        organizationId,
        propertyId,
        reviewId,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: seed.analysisSequence,
        operationId,
        authorizationLineageId: randomUUID(),
        reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
        propertyProfileVersion: PROPERTY_PROFILE_VERSION,
        analysisProfileVersion: seed.profile,
        status: 'ready',
        sentiment: 'negative',
        primaryCategory: isV3 ? null : 'service',
        attention,
        urgentReason: isV3 ? (seed.urgentReason ?? null) : null,
        generatedAt: now,
        expiresAt: seed.expiresAt,
      })
      if (seed.withContribution === true) {
        await db.insert(aiPropertyAggregateContributions).values({
          organizationId,
          propertyId,
          reviewId,
          sourceEpoch: SOURCE_EPOCH,
          sourceRevision: SOURCE_REVISION,
          analysisSequence: seed.analysisSequence,
          reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
          propertyProfileVersion: PROPERTY_PROFILE_VERSION,
          calendarProfileVersion: 'property-calendar-v1',
          localDate: '2026-09-08',
          status: 'ready',
          rating: 2,
          sentiment: 'negative',
          primaryCategory: isV3 ? null : 'service',
          attention,
          appliedAggregateRevision: 1,
          appliedAt: now,
        })
      }
      return {
        organizationId,
        propertyId,
        reviewId,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: seed.analysisSequence,
      }
    },
    reset,
    async remove() {
      await clear()
    },
  })
}

/** The ids of the analyses a Property currently holds, for assertions. */
export async function analysisReviewIds(
  db: Database,
  organizationId: string,
): Promise<readonly string[]> {
  const rows = await db
    .select({ reviewId: aiReviewAnalyses.reviewId })
    .from(aiReviewAnalyses)
    .where(eq(aiReviewAnalyses.organizationId, organizationId))
  return rows.map((row) => row.reviewId)
}

export async function countRows(
  db: Database,
  table: string,
  organizationId: string,
  reviewIds?: readonly string[],
): Promise<number> {
  const result = await db.execute(
    reviewIds === undefined
      ? sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`
      : sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId} AND review_id IN (${sql.join(
          reviewIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
  )
  return Number((result.rows[0] as { count: number | string }).count)
}
