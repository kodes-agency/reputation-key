// How a Property's Google primary category becomes the hints a review analysis
// is steered with, and how the hint set a request carried is recorded on its
// operation, against real PostgreSQL. The catalogue, the set choice and the
// digests are `review-vocabulary-hints.test.ts`; the columns are migration 0078.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { aiExecutionControlHeads, aiOperations, properties } from '#/shared/db/schema'
import {
  type AiAnalysisFixture,
  installAiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  propertyContextMatchesHintIdentity,
  resolveReviewPropertyContext,
} from '#/shared/review-vocabulary-hints'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  analysisExecutionBinding,
  analysisOperationIdentity,
} from '../../application/ai-operation-binding'
import { aiRequestFingerprint } from '../../application/ai-workflow-support'
import type { AiExecutionStopFence } from '../../domain/types'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'
import { createPropertyVocabularyContextAdapter } from './property-vocabulary-context.adapter'

const ORGANIZATION_ID = organizationId('ai-vocabulary-context-test-org')
const OTHER_ORGANIZATION_ID = organizationId('ai-vocabulary-context-other-org')
const PROPERTY_ID = propertyId('7a300000-0000-4000-8000-000000000003')
const REVIEW_ID = reviewId('7a300000-0000-4000-8000-000000000004')
const EVENT_ID = '7a300000-0000-4000-8000-000000000005'
const NOW = new Date('2026-10-29T10:00:00.000Z')

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture

async function setCategory(category: string | null): Promise<void> {
  await db
    .update(properties)
    .set({
      googlePrimaryCategory: category,
      googlePrimaryCategoryUpdatedAt: category === null ? null : NOW,
    })
    .where(eq(properties.id, PROPERTY_ID))
}

async function currentStopFence(): Promise<AiExecutionStopFence> {
  const heads = await db
    .select({
      scopeKey: aiExecutionControlHeads.scopeKey,
      controlId: aiExecutionControlHeads.controlId,
      generation: aiExecutionControlHeads.generation,
    })
    .from(aiExecutionControlHeads)
  const head = (scopeKey: string) => {
    const found = heads.find((candidate) => candidate.scopeKey === scopeKey)
    if (!found) throw new Error(`AI execution control ${scopeKey} is not seeded`)
    return found
  }
  return {
    globalControlId: head('global').controlId,
    globalGeneration: head('global').generation,
    providerControlId: head('provider:private-beta-global-v2').controlId,
    providerGeneration: head('provider:private-beta-global-v2').generation,
    capabilityControlId: head('capability:review_analysis').controlId,
    capabilityGeneration: head('capability:review_analysis').generation,
  }
}

/** The analysis request as the use case builds and fingerprints it, before any hints. */
async function analysisRequest() {
  const event = {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    reviewId: REVIEW_ID,
    eventEnvelopeId: EVENT_ID,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 1,
  }
  const subject = { digest: 'd'.repeat(64), keyVersion: 'ai-vocabulary-context-v1' }
  const identity = analysisOperationIdentity(event, subject, NOW.getTime())
  const binding = analysisExecutionBinding({
    input: event,
    authorization: {
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      redactionProfileFamily: 'gbp-review-global-v1',
    },
    authorizationLineageId: randomUUID(),
    operationProfile: {
      profileVersion: 'review-analysis-v2',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
    },
    reviewAnalysisEpoch: 1,
    evaluatedLanguage: 'en',
    reviewedAtEpochMillis: NOW.getTime(),
    profile: {
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      countryCode: 'US',
      timezone: 'America/New_York',
      processingRegion: 'global',
      routingPolicyVersion: 1,
      sourceEpoch: 0,
      profileVersion: 1,
      lifecycleState: 'active',
    },
    subjectHmacKeyVersion: subject.keyVersion,
    stopFence: await currentStopFence(),
  })
  return {
    identity,
    binding,
    provenance: { digest: 'e'.repeat(64), byteCount: 20 },
  }
}

describe.sequential('the vocabulary hints of a review analysis (real PostgreSQL)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    fixture = await installAiAnalysisFixture({
      db,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      now: NOW,
    })
  })

  beforeEach(async () => {
    await fixture.reset()
    await setCategory(null)
  })

  afterAll(async () => {
    await fixture?.remove()
    await lease?.release()
  })

  describe('reading the category of a Property', () => {
    const reader = () => createPropertyVocabularyContextAdapter(db)

    it('reads the stored category', async () => {
      await setCategory('Boat rental service')

      await expect(
        reader().readGooglePrimaryCategory({
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
        }),
      ).resolves.toBe('Boat rental service')
    })

    it('reads none for a Property without one, which selects the generic hints', async () => {
      const category = await reader().readGooglePrimaryCategory({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      })

      expect(category).toBeNull()
      expect(resolveReviewPropertyContext(category).propertyContext).toMatchObject({
        googlePrimaryCategory: null,
        vocabularyHintSetId: 'generic-service',
      })
    })

    it('does not read across Organizations', async () => {
      await setCategory('Hotel')

      await expect(
        reader().readGooglePrimaryCategory({
          organizationId: OTHER_ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
        }),
      ).resolves.toBeNull()
    })

    it('reads none for a deleted Property', async () => {
      await setCategory('Hotel')
      await db
        .update(properties)
        .set({ deletedAt: NOW })
        .where(eq(properties.id, PROPERTY_ID))

      await expect(
        reader().readGooglePrimaryCategory({
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
        }),
      ).resolves.toBeNull()
      await db
        .update(properties)
        .set({ deletedAt: null })
        .where(eq(properties.id, PROPERTY_ID))
    })

    it('chooses the hints for the category it read', async () => {
      await setCategory('Day spa')
      const category = await reader().readGooglePrimaryCategory({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      })

      expect(resolveReviewPropertyContext(category).propertyContext).toMatchObject({
        googlePrimaryCategory: 'Day spa',
        vocabularyHintSetId: 'spa-wellness',
        vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
      })
    })
  })

  describe('recording the hint set on the operation', () => {
    const operations = () => createAiOperationStoreAdapter(db, randomUUID)
    const claim = async (
      request: Awaited<ReturnType<typeof analysisRequest>>,
      extra: Readonly<{
        vocabularyHints?: ReturnType<typeof resolveReviewPropertyContext>['hintIdentity']
        fingerprintHints?: boolean
      }> = {},
    ) =>
      operations().claim({
        identity: request.identity,
        binding: request.binding,
        idempotencyKey: `analysis:${EVENT_ID}`,
        requestFingerprint: aiRequestFingerprint(
          extra.fingerprintHints === true
            ? { ...request, vocabularyHints: extra.vocabularyHints ?? null }
            : request,
        ),
        sourceProvenance: request.provenance,
        ...(extra.vocabularyHints === undefined
          ? {}
          : { vocabularyHints: extra.vocabularyHints }),
        nowEpochMillis: NOW.getTime(),
        expiresAtEpochMillis: NOW.getTime() + 24 * 60 * 60_000,
      })
    const storedColumns = async () =>
      (
        await db
          .select({
            id: aiOperations.vocabularyHintSetId,
            version: aiOperations.vocabularyHintSetVersion,
            digest: aiOperations.vocabularyHintSetDigest,
          })
          .from(aiOperations)
          .where(eq(aiOperations.organizationId, ORGANIZATION_ID))
      )[0]

    it('stores the id, version and digest of the set the request carried, and reads them back', async () => {
      const resolved = resolveReviewPropertyContext('Boat rental service')
      const request = await analysisRequest()

      const created = await claim(request, { vocabularyHints: resolved.hintIdentity })

      expect(created.status).toBe('created')
      expect(await storedColumns()).toEqual({
        id: 'boat-water-activities',
        version: 'review-vocabulary-hints-v1',
        digest: resolved.hintIdentity.digest,
      })
      expect(created.operation.vocabularyHints).toEqual(resolved.hintIdentity)
      // What was sent is provably what was recorded.
      expect(
        propertyContextMatchesHintIdentity(
          resolved.propertyContext,
          created.operation.vocabularyHints!,
        ),
      ).toBe(true)
    })

    it('records no hints for an operation that carried none', async () => {
      const created = await claim(await analysisRequest())

      expect(created.status).toBe('created')
      expect(created.operation.vocabularyHints).toBeNull()
      expect(await storedColumns()).toEqual({ id: null, version: null, digest: null })
    })

    it('replays the same request with the same hints', async () => {
      const resolved = resolveReviewPropertyContext('Hotel')
      const request = await analysisRequest()
      await claim(request, { vocabularyHints: resolved.hintIdentity })

      const again = await claim(request, { vocabularyHints: resolved.hintIdentity })

      expect(again.status).toBe('replayed')
      expect(again.operation.vocabularyHints).toEqual(resolved.hintIdentity)
    })

    it('answers conflict, keeping the recorded hints, when the same key comes with other hints', async () => {
      const hotel = resolveReviewPropertyContext('Hotel')
      const spa = resolveReviewPropertyContext('Day spa')
      const request = await analysisRequest()
      await claim(request, { vocabularyHints: hotel.hintIdentity })

      // The caller left the hints out of the fingerprint; the store still refuses.
      const other = await claim(request, { vocabularyHints: spa.hintIdentity })
      const none = await claim(request)

      expect(other.status).toBe('conflict')
      expect(none.status).toBe('conflict')
      expect(other.operation.vocabularyHints).toEqual(hotel.hintIdentity)
      expect(await storedColumns()).toMatchObject({ id: 'lodging' })
    })

    it('also conflicts when the hints are in the fingerprint, as the use case will put them', async () => {
      const hotel = resolveReviewPropertyContext('Hotel')
      const spa = resolveReviewPropertyContext('Day spa')
      const request = await analysisRequest()
      await claim(request, {
        vocabularyHints: hotel.hintIdentity,
        fingerprintHints: true,
      })

      const other = await claim(request, {
        vocabularyHints: spa.hintIdentity,
        fingerprintHints: true,
      })

      expect(other.status).toBe('conflict')
    })

    it('moves no row except its own: the operation count is one', async () => {
      const request = await analysisRequest()
      await claim(request, {
        vocabularyHints: resolveReviewPropertyContext('Gym').hintIdentity,
      })
      await claim(request, {
        vocabularyHints: resolveReviewPropertyContext('Gym').hintIdentity,
      })

      const count = await db.execute(
        sql`SELECT count(*)::int AS count FROM ai_operations WHERE organization_id = ${ORGANIZATION_ID}`,
      )
      expect(count.rows[0]).toEqual({ count: 1 })
    })
  })
})
