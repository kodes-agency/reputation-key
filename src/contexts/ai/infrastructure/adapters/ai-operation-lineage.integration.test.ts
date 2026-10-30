// How an operation records the provider it was claimed under and the normalizer
// its answer passes through (contract sections 3.1 and 7.3), against real
// PostgreSQL. The columns are migration 0078. What this proves is the seam's rule
// that an operation claimed under one provider is never adopted by a claim under
// another: switching the operator's choice reaches only operations claimed after.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { aiExecutionControlHeads, aiOperations } from '#/shared/db/schema'
import {
  type AiAnalysisFixture,
  installAiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { OPENAI_PROVIDER_ATTESTATION_V1 } from '#/shared/ai-openai-provider-attestation'
import { providerRequestProfileOf } from '#/shared/ai-provider-attestations'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/review-analysis-v3-normalizer'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  analysisExecutionBinding,
  analysisOperationIdentity,
} from '../../application/ai-operation-binding'
import { aiRequestFingerprint } from '../../application/ai-workflow-support'
import type {
  AiOperationNormalizationLineage,
  AiOperationProviderLineage,
} from '../../application/ports/ai-operation-store.port'
import type { AiExecutionStopFence } from '../../domain/types'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'

const ORGANIZATION_ID = organizationId('ai-operation-lineage-test-org')
const PROPERTY_ID = propertyId('7a400000-0000-4000-8000-000000000003')
const REVIEW_ID = reviewId('7a400000-0000-4000-8000-000000000004')
const EVENT_ID = '7a400000-0000-4000-8000-000000000005'
const NOW = new Date('2026-10-29T10:00:00.000Z')

const OPENAI_LINEAGE: AiOperationProviderLineage = (() => {
  const profile = providerRequestProfileOf(OPENAI_PROVIDER_ATTESTATION_V1)
  return {
    providerId: 'openai',
    model: profile.model,
    requestProfileVersion: profile.version,
    requestProfileDigest: profile.digest,
  }
})()
const SECOND_LINEAGE: AiOperationProviderLineage = {
  providerId: 'anthropic',
  model: 'synthetic-model-2026-10-01',
  requestProfileVersion: 'synthetic-request-profile-v1',
  requestProfileDigest: 'b'.repeat(64),
}
const NORMALIZATION: AiOperationNormalizationLineage = {
  version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
  digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
}

let lease: TestLease
let db: Database
let fixture: AiAnalysisFixture

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
  const subject = { digest: 'd'.repeat(64), keyVersion: 'ai-operation-lineage-v1' }
  const identity = analysisOperationIdentity(event, subject, NOW.getTime())
  const binding = analysisExecutionBinding({
    input: event,
    authorization: {
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      redactionProfileFamily: 'gbp-review-global-v1',
      providerDeploymentProfileVersion: 'private-beta-global-v2',
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

describe.sequential('the provider lineage of an operation (real PostgreSQL)', () => {
  const operations = () => createAiOperationStoreAdapter(db, randomUUID)
  const claim = async (
    request: Awaited<ReturnType<typeof analysisRequest>>,
    lineage: Readonly<{
      providerLineage?: AiOperationProviderLineage | null
      normalization?: AiOperationNormalizationLineage | null
    }> = {},
  ) =>
    operations().claim({
      identity: request.identity,
      binding: request.binding,
      idempotencyKey: `analysis:${EVENT_ID}`,
      // The caller left the lineage out of the fingerprint; the store still refuses.
      requestFingerprint: aiRequestFingerprint(request),
      sourceProvenance: request.provenance,
      ...lineage,
      nowEpochMillis: NOW.getTime(),
      expiresAtEpochMillis: NOW.getTime() + 24 * 60 * 60_000,
    })
  const storedColumns = async () =>
    (
      await db
        .select({
          providerId: aiOperations.providerId,
          providerModel: aiOperations.providerModel,
          providerRequestProfileVersion: aiOperations.providerRequestProfileVersion,
          providerRequestProfileDigest: aiOperations.providerRequestProfileDigest,
          normalizationProfileVersion: aiOperations.normalizationProfileVersion,
          normalizationProfileDigest: aiOperations.normalizationProfileDigest,
        })
        .from(aiOperations)
        .where(eq(aiOperations.organizationId, ORGANIZATION_ID))
    )[0]

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
  })

  afterAll(async () => {
    await fixture?.remove()
    await lease?.release()
  })

  it('stores the provider, its model and request profile and the normalizer, and reads them back', async () => {
    const created = await claim(await analysisRequest(), {
      providerLineage: OPENAI_LINEAGE,
      normalization: NORMALIZATION,
    })

    expect(created.status).toBe('created')
    expect(await storedColumns()).toEqual({
      providerId: 'openai',
      providerModel: 'gpt-6-luna',
      providerRequestProfileVersion: 'openai-responses-request-profile-v1',
      providerRequestProfileDigest: OPENAI_PROVIDER_ATTESTATION_V1.digest,
      normalizationProfileVersion: 'review-analysis-normalization-v1',
      normalizationProfileDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
    })
    expect(created.operation.providerLineage).toEqual(OPENAI_LINEAGE)
    expect(created.operation.normalization).toEqual(NORMALIZATION)
  })

  it('records no lineage for an operation claimed without one, which is every v2 operation', async () => {
    const created = await claim(await analysisRequest())

    expect(created.status).toBe('created')
    expect(created.operation.providerLineage).toBeNull()
    expect(created.operation.normalization).toBeNull()
    expect(await storedColumns()).toEqual({
      providerId: null,
      providerModel: null,
      providerRequestProfileVersion: null,
      providerRequestProfileDigest: null,
      normalizationProfileVersion: null,
      normalizationProfileDigest: null,
    })
  })

  // The switch-on retired review-analysis-v2 and left its profile in the catalogue
  // for this: an operation claimed under it before the deploy is read back under the
  // deployment profile it was claimed under (`private-beta-global-v1`), not under the one
  // in force (`private-beta-global-v2`), so it can still be settled or abandoned.
  it('reads the profile versions the operation was claimed under, not those in force', async () => {
    const created = await claim(await analysisRequest())

    expect(created.operation.binding).toMatchObject({
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'review-analysis-v2',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
    })
  })

  it('replays the same request under the same lineage', async () => {
    const request = await analysisRequest()
    await claim(request, {
      providerLineage: OPENAI_LINEAGE,
      normalization: NORMALIZATION,
    })

    const again = await claim(request, {
      providerLineage: OPENAI_LINEAGE,
      normalization: NORMALIZATION,
    })

    expect(again.status).toBe('replayed')
    expect(again.operation.providerLineage).toEqual(OPENAI_LINEAGE)
  })

  it('answers conflict, keeping the recorded provider, when the same key comes under another provider', async () => {
    const request = await analysisRequest()
    await claim(request, {
      providerLineage: OPENAI_LINEAGE,
      normalization: NORMALIZATION,
    })

    const switched = await claim(request, {
      providerLineage: SECOND_LINEAGE,
      normalization: NORMALIZATION,
    })

    expect(switched.status).toBe('conflict')
    expect(switched.operation.providerLineage).toEqual(OPENAI_LINEAGE)
    expect(await storedColumns()).toMatchObject({ providerId: 'openai' })
  })

  it('also conflicts when only the request profile moved, the model changed or the lineage was dropped', async () => {
    const request = await analysisRequest()
    await claim(request, {
      providerLineage: OPENAI_LINEAGE,
      normalization: NORMALIZATION,
    })

    const variants: ReadonlyArray<AiOperationProviderLineage | null> = [
      { ...OPENAI_LINEAGE, requestProfileDigest: 'f'.repeat(64) },
      { ...OPENAI_LINEAGE, requestProfileVersion: 'openai-responses-request-profile-v2' },
      { ...OPENAI_LINEAGE, model: 'gpt-5.6-luna-2' },
      null,
    ]
    for (const providerLineage of variants) {
      const result = await claim(request, {
        providerLineage,
        normalization: NORMALIZATION,
      })
      expect(result.status, JSON.stringify(providerLineage)).toBe('conflict')
    }
  })

  it('answers conflict when the same key comes through another normalizer', async () => {
    const request = await analysisRequest()
    await claim(request, {
      providerLineage: OPENAI_LINEAGE,
      normalization: NORMALIZATION,
    })

    for (const normalization of [
      { ...NORMALIZATION, digest: 'f'.repeat(64) },
      { ...NORMALIZATION, version: 'review-analysis-normalization-v2' },
      null,
    ]) {
      const result = await claim(request, {
        providerLineage: OPENAI_LINEAGE,
        normalization,
      })
      expect(result.status).toBe('conflict')
    }
  })

  // v3 is in the catalogue since the switch-on, so the profile is found; what a v3
  // operation must record is enforced by the database: the hint set it was claimed
  // under and the provider and normalizer (`ai_operations_v3_lineage_required`).
  it('claims no v3 operation that records no hint set, and writes no row', async () => {
    const request = await analysisRequest()

    await expect(
      claim(
        {
          ...request,
          binding: { ...request.binding, operationProfileVersion: 'review-analysis-v3' },
        },
        { providerLineage: OPENAI_LINEAGE, normalization: NORMALIZATION },
      ),
    ).rejects.toThrow(/Failed query: insert into "ai_operations"/)
    const count = await db.execute(
      sql`SELECT count(*)::int AS count FROM ai_operations WHERE organization_id = ${ORGANIZATION_ID}`,
    )
    expect(count.rows[0]).toEqual({ count: 0 })
  })
})
