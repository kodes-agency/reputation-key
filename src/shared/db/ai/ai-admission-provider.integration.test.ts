// Admission and settlement price an operation by the provider it was claimed under
// (contract section 7.1). An operation that records none is a v2 operation and is
// priced exactly as before; one recorded under Anthropic is priced by Anthropic's
// list, never OpenAI's (a provider with no list at all is refused and priced by
// nothing: ai-provider-pricing.test.ts). Real PostgreSQL.

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { aiOperations, aiOrganizationCostWindows } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import {
  maximumCostMicros,
  OPENAI_PRICE_CATALOGUE_V2,
  settledCostMicros,
} from '#/shared/ai-openai-provider-profile'
import { settledCostMicrosWith } from '#/shared/ai-provider-pricing'
import { priceCatalogueOfProvider } from '#/shared/ai-provider-pricing-registry'
import type {
  AiAdmissionDescriptorV1,
  AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import {
  AI_REPLY_OPERATION_PROFILE,
  installAiOperationFixture,
  type AiOperationFixture,
} from '#/shared/db/testing/ai-operation-fixture'
import { createAiBudgetControl, type AiBudgetAdmissionInput } from './ai-budget'
import { createPostgresAiAdmissionAuthority } from './postgres-admission-authority'

type PropertyDescriptor = Extract<AiAdmissionDescriptorV1, { subjectKind: 'property' }>

const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-admission-provider-test-org')
const PROPERTY_ID = propertyId('77000000-0000-4000-8000-000000000001')
const SIGNING_KID = 'grant-v1'
const SOURCE_DIGEST = 'd'.repeat(64)
const SOURCE_BYTES = 40
const PAYLOAD_BYTES = 512
const BINDING = { keyId: 'binding-v1', hmac: 'A'.repeat(43) } as const
const ROUTE_KEY = AI_REPLY_OPERATION_PROFILE.routeKey

const profile = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.sourceRoute === ROUTE_KEY,
)
if (!profile) throw new Error('reply-suggestion profile is not registered')
const RESERVED = maximumCostMicros(profile, PAYLOAD_BYTES)

function descriptor(
  input: { operationId: string; permitId: string },
  operationProfileVersion: string = AI_REPLY_OPERATION_PROFILE.profileVersion,
): PropertyDescriptor {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'reply-suggestion',
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: 1,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    internalSubjectId: 'subject-1',
    actorId: 'ai-admission-provider-test-user',
    binding: {
      authorizationLineageId: '77000000-0000-4000-8000-000000000003',
      noticeVersion: 'merchant-ai-notice-v2',
      noticeDigest: 'b'.repeat(64),
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: 0,
      },
      sourceEpoch: 1,
      evaluatedLanguage: 'en',
      concreteReplyLanguage: null,
      languageCatalogueDigest: null,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 1,
      reviewedAtEpochMillis: NOW.getTime(),
      propertyProfileVersion: 1,
      replyBrandProfileVersion: null,
      replyBrandDisplayNameDigest: null,
      routingPolicyVersion: 1,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: 'a'.repeat(64),
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
      replyTemplateCatalogueDigest: 'a'.repeat(64),
      aiSubjectHmacKeyVersion: null,
      stopFence: {
        globalControlId: '77000000-0000-4000-8000-000000000010',
        globalGeneration: 1,
        providerControlId: '77000000-0000-4000-8000-000000000011',
        providerGeneration: 1,
        capabilityControlId: '77000000-0000-4000-8000-000000000012',
        capabilityGeneration: 1,
      },
      providerDeploymentProfileVersion:
        AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion,
      operationProfileVersion,
      capabilityRuntimeProfileVersion:
        AI_REPLY_OPERATION_PROFILE.capabilityRuntimeProfileVersion,
    },
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    sourceDigest: SOURCE_DIGEST,
    preparedDigest: 'c'.repeat(64),
    sourceByteCount: SOURCE_BYTES,
    preparedByteCount: 256,
    providerPayloadByteCount: PAYLOAD_BYTES,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 1_024,
      providerPayloadBytes: 2_048,
      preparedRequestBytes: 4_096,
      responseBytes: 8_192,
      outputTokens: 64,
      costMicros: 100_000,
    },
    callerDeadlineEpochMillis: NOW.getTime() + 70_000,
    observedContentExpiresAtEpochMillis: NOW.getTime() + 24 * 60 * 60_000,
    redactionCountry: 'US',
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: 'ai-output-leakage-v1',
    outputLeakageProfileDigest: 'a'.repeat(64),
    replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
    replyTemplateCatalogueDigest: 'a'.repeat(64),
  }
}

function settlement(
  input: { operationId: string; permitId: string; nonce: string },
  disposition: 'success' | 'no_dispatch',
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): AiSettlementRequestV1 {
  return {
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: 1,
    nonce: input.nonce,
    disposition,
    reportedDisposition: disposition,
    providerRetryable: false,
    usageKnown: disposition === 'success',
    ...(disposition === 'success'
      ? usage
      : { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }),
    reasoningTokens: 0,
    retryAfterSeconds: null,
  }
}

const ANTHROPIC = {
  providerId: 'anthropic',
  providerModel: 'synthetic-model',
  providerRequestProfileVersion: 'synthetic-request-profile-v1',
  providerRequestProfileDigest: 'b'.repeat(64),
} as const
const OPENAI = {
  providerId: 'openai',
  providerModel: 'gpt-5.6-luna',
  providerRequestProfileVersion: 'openai-responses-request-profile-v1',
  providerRequestProfileDigest: 'c'.repeat(64),
} as const

describe.sequential('admission and settlement by provider (real PostgreSQL)', () => {
  const db = getDb()
  let fixture: AiOperationFixture
  const budget = createAiBudgetControl({ idGen: randomUUID, now: () => NOW })
  const authority = createPostgresAiAdmissionAuthority({
    pool: getPool(),
    signingKid: SIGNING_KID,
    budgetControl: budget,
    now: () => NOW,
  })

  const admission = (
    operationKey: string,
    operationProfileVersion?: string,
  ): AiBudgetAdmissionInput => ({
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    operationKey,
    routeKey: ROUTE_KEY,
    ...(operationProfileVersion === undefined ? {} : { operationProfileVersion }),
    providerPayloadBytes: PAYLOAD_BYTES,
  })
  const admit = (operationKey: string, operationProfileVersion?: string) =>
    db.transaction((tx) =>
      budget.admitAiOperation(tx, admission(operationKey, operationProfileVersion)),
    )
  const record = (operationId: string, lineage: typeof OPENAI | typeof ANTHROPIC) =>
    db.update(aiOperations).set(lineage).where(eq(aiOperations.id, operationId))
  const reserved = async () => {
    const [row] = await db
      .select({ reservedMicros: aiOrganizationCostWindows.reservedMicros })
      .from(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, ORGANIZATION_ID))
    return row?.reservedMicros ?? 0
  }

  beforeAll(async () => {
    fixture = await installAiOperationFixture({
      db,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: 'ai-admission-provider-test-user',
      now: NOW,
    })
    await db.insert(aiOrganizationCostWindows).values({
      id: randomUUID(),
      organizationId: ORGANIZATION_ID,
      windowStart: sql`date_trunc('month', ${NOW}::timestamptz)`,
      reservedMicros: 0,
      settledMicros: 0,
      capMicros: 1_000 * RESERVED,
      updatedAt: NOW,
    })
  })

  afterAll(async () => {
    await fixture.remove()
  })

  describe('the reservation', () => {
    it('is the profile maximum for an operation that records no provider, with or without the profile named', async () => {
      const unnamed = await fixture.seedOperation()
      const named = await fixture.seedOperation()

      await expect(admit(unnamed)).resolves.toEqual({
        ok: true,
        operationId: unnamed,
        reservedMicros: RESERVED,
      })
      await expect(
        admit(named, AI_REPLY_OPERATION_PROFILE.profileVersion),
      ).resolves.toEqual({
        ok: true,
        operationId: named,
        reservedMicros: RESERVED,
      })
    })

    it('is the same figure for an operation recorded under OpenAI: its pairing reserves what the profile always did', async () => {
      const operationId = await fixture.seedOperation()
      await record(operationId, OPENAI)

      await expect(admit(operationId)).resolves.toEqual({
        ok: true,
        operationId,
        reservedMicros: RESERVED,
      })
    })

    it('is refused for a provider with no price list and no pairing, and reserves nothing', async () => {
      const operationId = await fixture.seedOperation()
      await record(operationId, ANTHROPIC)
      const before = await reserved()

      await expect(admit(operationId)).resolves.toEqual({
        ok: false,
        code: 'capability_unavailable',
      })
      expect(await reserved()).toBe(before)
      const [row] = await db
        .select({
          reservedMicros: aiOperations.reservedMicros,
          costWindowId: aiOperations.costWindowId,
        })
        .from(aiOperations)
        .where(eq(aiOperations.id, operationId))
      expect(row).toEqual({ reservedMicros: 0, costWindowId: null })
    })

    it('is refused for a profile version the route does not hold', async () => {
      const operationId = await fixture.seedOperation()

      await expect(admit(operationId, 'reply-suggestion-v9')).resolves.toEqual({
        ok: false,
        code: 'capability_unavailable',
      })
    })
  })

  describe('the settlement', () => {
    const granted = async () => {
      const permitId = randomUUID()
      const operationId = await fixture.seedOperation({
        state: 'executing',
        executionAttempt: 1,
        executionPermitId: permitId,
        sourceDigest: SOURCE_DIGEST,
        sourceByteCount: SOURCE_BYTES,
      })
      const admitted = await authority.authorizeProperty(
        descriptor({ operationId, permitId }),
        BINDING,
      )
      if (admitted.status !== 'admitted')
        throw new Error(`not admitted: ${admitted.code}`)
      return { operationId, permitId, nonce: admitted.nonce }
    }
    const usage = { inputTokens: 1_000, cachedInputTokens: 200, outputTokens: 300 }

    it('prices an operation that records no provider, and one recorded under OpenAI, by OpenAI’s list', async () => {
      const none = await granted()
      const openAi = await granted()
      await record(openAi.operationId, OPENAI)

      await expect(
        authority.settle(settlement(none, 'success', usage), SIGNING_KID),
      ).resolves.toMatchObject({
        status: 'settled',
        costMicros: Number(settledCostMicros(usage)),
      })
      await expect(
        authority.settle(settlement(openAi, 'success', usage), SIGNING_KID),
      ).resolves.toMatchObject({
        status: 'settled',
        costMicros: Number(settledCostMicros(usage)),
      })
    })

    it('prices an operation recorded under Anthropic by Anthropic’s list, and always lets a withheld dispatch release', async () => {
      const anthropicList = priceCatalogueOfProvider('anthropic')
      if (anthropicList === null) throw new Error('Anthropic has no price list')
      const priced = await granted()
      const withheld = await granted()
      await record(priced.operationId, ANTHROPIC)
      await record(withheld.operationId, ANTHROPIC)

      await expect(
        authority.settle(settlement(priced, 'success', usage), SIGNING_KID),
      ).resolves.toMatchObject({
        status: 'settled',
        costMicros: Number(settledCostMicrosWith(anthropicList, usage)),
      })
      // The two real lists carry the same per-million figures since the switch-on
      // ($0.10 / $0.01 / $0.50 for gpt-6-luna and for claude-haiku-5-5), so the equality
      // of the two settlements proves nothing here. That the list follows the provider
      // is shown with a list that differs: `ai-provider-pricing.test.ts` and
      // `service-providers.test.ts`.
      expect(anthropicList.catalogueId).not.toBe(OPENAI_PRICE_CATALOGUE_V2.catalogueId)
      await expect(
        authority.settle(settlement(withheld, 'no_dispatch', usage), SIGNING_KID),
      ).resolves.toMatchObject({
        status: 'settled',
        costMicros: 0,
        settlementState: 'released',
      })
    })

    it('refuses to admit an operation whose profile the descriptor names wrongly, as before', async () => {
      const permitId = randomUUID()
      const operationId = await fixture.seedOperation({
        state: 'executing',
        executionAttempt: 1,
        executionPermitId: permitId,
        sourceDigest: SOURCE_DIGEST,
        sourceByteCount: SOURCE_BYTES,
      })

      await expect(
        authority.authorizeProperty(
          descriptor({ operationId, permitId }, 'reply-suggestion-v9'),
          BINDING,
        ),
      ).resolves.toEqual({ status: 'denied', code: 'authorization_changed' })
    })
  })
})
