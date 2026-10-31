import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import {
  aiExecutionControlHeads,
  aiOperations,
  aiOrganizationCostWindows,
} from '#/shared/db/schema'
import {
  installAiOperationFixture,
  type AiOperationFixture,
} from '#/shared/db/testing/ai-operation-fixture'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { replyV2Request } from '#/shared/ai-provider-control/reply-drafting-v2.test-fixtures'
import { createPostgresAiAdmissionAuthority } from '#/shared/db/ai/postgres-admission-authority'
import type {
  AiAdmissionDescriptorV1,
  AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'
import { aiRequestFingerprint } from '../../application/ai-workflow-support'
import type { AiOperationStorePort } from '../../application/ports/ai-operation-store.port'
import type { AiExecutionBinding } from '../../domain/types'

const ORG = organizationId('reply-v2-accounting-integration')
const PROPERTY = propertyId('7b500000-0000-4000-8000-000000000001')
const ACTOR = userId('reply-v2-accounting-actor')
const REVIEW = reviewId('7b500000-0000-4000-8000-000000000002')
const NOW = new Date(Date.now() - 1_000)
const db = getDb()
const operations = createAiOperationStoreAdapter(db, randomUUID)
const authority = createPostgresAiAdmissionAuthority({
  pool: getPool(),
  signingKid: 'grant-v1',
  now: () => NOW,
})
let fixture: AiOperationFixture
let root: Parameters<AiOperationStorePort['claim']>[0]

beforeAll(async () => {
  fixture = await installAiOperationFixture({
    db,
    organizationId: ORG,
    propertyId: PROPERTY,
    actorUserId: ACTOR,
    now: NOW,
  })
  const heads = await db.select().from(aiExecutionControlHeads)
  const head = (key: string) => heads.find((h) => h.scopeKey === key)!
  const base = replyV2Request().binding
  const binding = {
    ...base,
    sourceEpoch: 1,
    sourceRevision: 1,
    reviewedAtEpochMillis: NOW.getTime(),
    propertyProfileVersion: 1,
    stopFence: {
      globalControlId: head('global').controlId,
      globalGeneration: head('global').generation,
      providerControlId: head('provider:private-beta-global-v2').controlId,
      providerGeneration: head('provider:private-beta-global-v2').generation,
      capabilityControlId: head('capability:reply_drafting').controlId,
      capabilityGeneration: head('capability:reply_drafting').generation,
    },
  } as AiExecutionBinding
  const identity = {
    subjectKind: 'property',
    command: 'reply',
    capability: 'reply_drafting',
    organizationId: ORG,
    propertyId: PROPERTY,
    actorId: ACTOR,
    systemPrincipal: null,
    reviewId: REVIEW,
    sourceEpoch: 1,
    sourceRevision: 1,
    reviewedAtEpochMillis: NOW.getTime(),
    baseReplyStateRevision: 0,
    tone: 'professional',
  } as const
  root = {
    identity,
    binding,
    idempotencyKey: 'root',
    requestFingerprint: aiRequestFingerprint({ identity, binding }),
    sourceProvenance: { digest: 'e'.repeat(64), byteCount: 20 },
    nowEpochMillis: NOW.getTime(),
    expiresAtEpochMillis: NOW.getTime() + 300_000,
  }
})
afterAll(async () => {
  await fixture?.remove()
})

function descriptor(
  operationId: string,
  permitId: string,
  binding: AiExecutionBinding,
): Extract<AiAdmissionDescriptorV1, { subjectKind: 'property' }> {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'reply-suggestion',
    operationId,
    permitId,
    attemptNumber: 1,
    organizationId: ORG,
    propertyId: PROPERTY,
    internalSubjectId: REVIEW,
    actorId: ACTOR,
    binding,
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    sourceDigest: 'e'.repeat(64),
    sourceByteCount: 20,
    preparedDigest: 'f'.repeat(64),
    preparedByteCount: 12000,
    providerPayloadByteCount: 256,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 16384,
      providerPayloadBytes: 57344,
      preparedRequestBytes: 131072,
      responseBytes: 131072,
      outputTokens: 2048,
      costMicros: 1000000,
    },
    callerDeadlineEpochMillis: NOW.getTime() + 70000,
    observedContentExpiresAtEpochMillis: NOW.getTime() + 300000,
    redactionCountry: 'US',
    redactionProfileVersion: binding.redactionProfileVersion,
    outputLeakageProfileVersion: binding.outputLeakageProfileVersion,
    outputLeakageProfileDigest: binding.outputLeakageProfileDigest,
    replyTemplateCatalogueVersion: binding.replyTemplateCatalogueVersion,
    replyTemplateCatalogueDigest: binding.replyTemplateCatalogueDigest,
  }
}
async function charge(operationId: string, binding: AiExecutionBinding) {
  const execution = await operations.claimExecution({
    operationId: operationId as never,
    organizationId: ORG,
    expectedAttempt: 1,
    nowEpochMillis: NOW.getTime(),
  })
  expect(execution).not.toBeNull()
  const admitted = await authority.authorizeProperty(
    descriptor(operationId, execution!.executionPermitId!, binding),
    { keyId: 'binding-v1', hmac: 'A'.repeat(43) },
  )
  if (admitted.status !== 'admitted')
    throw new Error(`Admission refused: ${admitted.code}`)
  const settlement: AiSettlementRequestV1 = {
    operationId,
    permitId: execution!.executionPermitId!,
    attemptNumber: 1,
    nonce: admitted.nonce,
    disposition: 'output_invalid',
    reportedDisposition: 'success',
    usageKnown: true,
    providerRetryable: false,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 20,
    reasoningTokens: 0,
    retryAfterSeconds: null,
  }
  const first = await authority.settle(settlement, 'grant-v1')
  const replay = await authority.settle(settlement, 'grant-v1')
  expect(replay).toEqual(first)
  await operations.recordFailure({
    operationId: operationId as never,
    organizationId: ORG,
    expectedAttempt: 1,
    failureCode: 'output_invalid',
    retryAtEpochMillis: null,
    failedAtEpochMillis: NOW.getTime() + 1,
  })
  return first
}

describe.sequential('v2 rewrite identity and accounting (PostgreSQL)', () => {
  it('uniquely claims one child, charges both once and refuses a grandchild', async () => {
    const parent = await operations.claim(root)
    const parentSettlement = await charge(parent.operation.id, root.binding)
    const childBinding = {
      ...root.binding,
      replyDraftingV2: {
        ...root.binding.replyDraftingV2!,
        parentOperationId: parent.operation.id,
        rewriteOrdinal: 1 as const,
        rewriteIssues: ['invitation' as const],
      },
    }
    const child = {
      ...root,
      binding: childBinding,
      idempotencyKey: aiRequestFingerprint({
        parentOperationId: parent.operation.id,
        rewriteOrdinal: 1,
      }),
      requestFingerprint: aiRequestFingerprint(childBinding),
    }
    const concurrent = await Promise.all([
      operations.claim(child),
      operations.claim(child),
    ])
    expect(new Set(concurrent.map((c) => c.operation.id)).size).toBe(1)
    expect(concurrent.map((c) => c.status).sort()).toEqual(['created', 'replayed'])
    const childId = concurrent[0]!.operation.id
    await charge(childId, childBinding)
    expect(parentSettlement.status).toBe('settled')
    const [window] = await db
      .select()
      .from(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, ORG))
    const rows = await db
      .select()
      .from(aiOperations)
      .where(
        and(eq(aiOperations.organizationId, ORG), eq(aiOperations.propertyId, PROPERTY)),
      )
    expect(rows).toHaveLength(2)
    const metadata = root.binding.replyDraftingV2!
    const invalidRoots = [
      { ...metadata, voiceDigest: null },
      { ...metadata, generationSeed: null },
      { ...metadata, options: { ...metadata.options, variation: null } },
      { ...metadata, options: { ...metadata.options, variation: '1' } },
      { ...metadata, options: { ...metadata.options, variation: 1.5 } },
      { ...metadata, options: { ...metadata.options, opening: '2' } },
      { ...metadata, options: { ...metadata.options, length: null } },
      { ...metadata, rewriteOrdinal: null },
      { ...metadata, rewriteIssues: ['invitation'] },
    ]
    for (const invalid of invalidRoots) {
      await expect(
        db
          .update(aiOperations)
          .set({ replyDraftingV2: invalid as never })
          .where(eq(aiOperations.id, parent.operation.id)),
      ).rejects.toMatchObject({ cause: { code: '23514' } })
    }
    await expect(
      db
        .update(aiOperations)
        .set({ replyDraftingV2: { ...childBinding.replyDraftingV2, rewriteIssues: [] } })
        .where(eq(aiOperations.id, childId)),
    ).rejects.toMatchObject({ cause: { code: '23514' } })

    await expect(
      db
        .update(aiOperations)
        .set({
          replyDraftingV2: {
            ...root.binding.replyDraftingV2!,
            avoidTerms: ['private'],
          } as never,
        })
        .where(eq(aiOperations.id, parent.operation.id)),
    ).rejects.toMatchObject({ cause: { code: '23514' } })
    expect(rows.every((r) => r.budgetSettledAt !== null && r.actualMicros !== null)).toBe(
      true,
    )
    expect(window!.reservedMicros).toBe(0)
    expect(window!.settledMicros).toBe(rows.reduce((sum, r) => sum + r.actualMicros!, 0))
    const thirdBinding = {
      ...childBinding,
      replyDraftingV2: { ...childBinding.replyDraftingV2, parentOperationId: childId },
    }
    const third = await operations.claim({
      ...child,
      binding: thirdBinding,
      idempotencyKey: aiRequestFingerprint({
        parentOperationId: childId,
        rewriteOrdinal: 1,
      }),
      requestFingerprint: aiRequestFingerprint(thirdBinding),
    })
    expect(third.status).toBe('conflict')
  })
})
