import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect } from 'vitest'
import type { getDb } from '#/shared/db'
import { aiOperations, aiOrganizationCostWindows } from '#/shared/db/schema'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation/ai-operation-profiles'
import { replyDynamicDeveloperBytes } from '#/shared/reply/request'
import { maximumCostMicros } from '#/shared/ai-provider-profile/ai-openai-provider-profile'
import type {
  AiAdmissionDescriptorV1,
  AiSettlementRequestV1,
} from '#/shared/ai-gateway/ai-internal-transport-contract'
import {
  AI_REPLY_OPERATION_PROFILE,
  AI_REPLY_V2_DEFAULT_BINDING,
  installAiOperationFixture,
  type AiOperationFixture,
} from '#/shared/db/testing/ai-operation-fixture'

type Db = ReturnType<typeof getDb>
export type PropertyDescriptor = Extract<
  AiAdmissionDescriptorV1,
  { subjectKind: 'property' }
>
export type AdmissionScope = Readonly<{ organizationId: string; propertyId: string }>
export type AdmissionSubject = { operationId: string; permitId: string }

export const SOURCE_DIGEST = 'd'.repeat(64)
export const SOURCE_BYTES = 40
export const PAYLOAD_BYTES = 512

const replyProfile = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === AI_REPLY_OPERATION_PROFILE.profileVersion,
)
if (!replyProfile) throw new Error('reply-suggestion profile is not registered')
// A reply v2 request carries a per-request part of its prompt that the profile's
// static figure does not include; admission prices it in.
export const RESERVED = maximumCostMicros(
  {
    ...replyProfile,
    staticTokenBearingBytes:
      replyProfile.staticTokenBearingBytes +
      replyDynamicDeveloperBytes(replyProfile.profileVersion),
  },
  PAYLOAD_BYTES,
)

export type AdmissionDescriptorContext = Readonly<{
  now: Date
  /** Two leading digits of the fixed ids in the descriptor's binding. */
  idPrefix: string
  actorId: string
}>

export function buildAdmissionDescriptor(
  context: AdmissionDescriptorContext,
  input: AdmissionSubject & { attemptNumber?: number },
  scope: AdmissionScope,
  operationProfileVersion: string = AI_REPLY_OPERATION_PROFILE.profileVersion,
): PropertyDescriptor {
  const { now, idPrefix, actorId } = context
  const id = (suffix: string) => `${idPrefix}000000-0000-4000-8000-${suffix}`
  // The adapter reads route, ids, attempt, permit, digest, byte count, profile
  // versions and deadline; every fence it re-reads comes from the locked row.
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'reply-suggestion',
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: input.attemptNumber ?? 1,
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    internalSubjectId: 'subject-1',
    actorId,
    binding: {
      authorizationLineageId: id('000000000003'),
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
      reviewedAtEpochMillis: now.getTime(),
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
        globalControlId: id('000000000010'),
        globalGeneration: 1,
        providerControlId: id('000000000011'),
        providerGeneration: 1,
        capabilityControlId: id('000000000012'),
        capabilityGeneration: 1,
      },
      providerDeploymentProfileVersion:
        AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion,
      replyDraftingV2: AI_REPLY_V2_DEFAULT_BINDING,
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
    callerDeadlineEpochMillis: now.getTime() + 70_000,
    observedContentExpiresAtEpochMillis: now.getTime() + 24 * 60 * 60_000,
    redactionCountry: 'US',
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: 'ai-output-leakage-v1',
    outputLeakageProfileDigest: 'a'.repeat(64),
    replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
    replyTemplateCatalogueDigest: 'a'.repeat(64),
  }
}

export function settlement(
  input: AdmissionSubject & { attemptNumber?: number },
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): AiSettlementRequestV1 {
  return {
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: input.attemptNumber ?? 1,
    disposition: 'success',
    reportedDisposition: 'success',
    providerRetryable: false,
    usageKnown: true,
    ...usage,
    reasoningTokens: 0,
    retryAfterSeconds: null,
  }
}

/** What the gateway settles when it withheld dispatch (e.g. too little time was left). */
export function noDispatch(input: AdmissionSubject): AiSettlementRequestV1 {
  return {
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: 1,
    disposition: 'no_dispatch',
    reportedDisposition: 'no_dispatch',
    providerRetryable: false,
    usageKnown: false,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    retryAfterSeconds: null,
  }
}

export function deferred() {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release, released }
}

/** An operation in the executing state, with the permit its descriptor names. */
export async function seedExecutingOperation(
  fixture: AiOperationFixture,
): Promise<AdmissionSubject> {
  const permitId = randomUUID()
  const operationId = await fixture.seedOperation({
    state: 'executing',
    executionAttempt: 1,
    executionPermitId: permitId,
    sourceDigest: SOURCE_DIGEST,
    sourceByteCount: SOURCE_BYTES,
  })
  return { operationId, permitId }
}

/** Installs a fixture before the suite's tests and removes it after them. */
export function useAiOperationFixture(
  db: Db,
  now: Date,
  install: { organizationId: string; propertyId: string; actorUserId: string },
): () => AiOperationFixture {
  let fixture: AiOperationFixture
  beforeAll(async () => {
    fixture = await installAiOperationFixture({ db, ...install, now })
  })
  afterAll(async () => {
    await fixture.remove()
  })
  return () => fixture
}

/** Reads of the budget ledger and the operation row, and a lock-wait probe. */
export function createAdmissionDbHelpers(db: Db, defaultOrganizationId: string) {
  async function costWindow(organization: string = defaultOrganizationId) {
    const [row] = await db
      .select({
        reservedMicros: aiOrganizationCostWindows.reservedMicros,
        settledMicros: aiOrganizationCostWindows.settledMicros,
      })
      .from(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, organization))
    return row ?? { reservedMicros: 0, settledMicros: 0 }
  }

  async function operationRow(operationId: string) {
    const [row] = await db
      .select({
        reviewId: aiOperations.reviewId,
        costWindowId: aiOperations.costWindowId,
        reservedMicros: aiOperations.reservedMicros,
        budgetSettledAt: aiOperations.budgetSettledAt,
        actualMicros: aiOperations.actualMicros,
      })
      .from(aiOperations)
      .where(eq(aiOperations.id, operationId))
    if (!row) throw new Error('operation missing')
    return row
  }

  /** Wait until some session is blocked on a row lock, without a timer. */
  async function untilALockWaits(): Promise<void> {
    for (let polls = 0; polls < 500; polls += 1) {
      const waiting = await db.execute<{ waiting: number }>(
        sql`SELECT count(*)::int AS "waiting" FROM pg_locks WHERE NOT granted`,
      )
      if ((waiting.rows[0]?.waiting ?? 0) > 0) return
      await new Promise((resolve) => setImmediate(resolve))
    }
    throw new Error('no session ever waited on a lock')
  }

  /** A refused admission sent nothing: no reservation on the row or the window. */
  async function expectNothingReserved(operationId: string, windowBefore: object) {
    await expect(operationRow(operationId)).resolves.toMatchObject({
      costWindowId: null,
      reservedMicros: 0,
    })
    await expect(costWindow()).resolves.toEqual(windowBefore)
  }

  return { costWindow, operationRow, untilALockWaits, expectNothingReserved }
}
