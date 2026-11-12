import type { ReplyDraftingV2Binding } from '#/shared/domain/reply-drafting-v2'
// A real-PostgreSQL fixture for tests that drive the AI reservation ledger and
// its admission: one organization, one property with an active processing
// profile and Merchant AI consent to reply drafting, the reply-drafting
// capability control opened for the run, and `ai_operations` rows on demand,
// each claimed under that consent for a review of its own.

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiOrganizationCostWindows,
  aiPropertyProcessingProfiles,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
  reviews,
  reviewSourceContents,
} from '#/shared/db/schema'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { deleteTestOrganizationsWithExecutor } from './test-organization-cleanup'

/** The reply-suggestion profile as the seed and the operation rows spell it. */
export const AI_REPLY_OPERATION_PROFILE = Object.freeze({
  command: 'reply',
  capability: 'reply_drafting',
  profileVersion: 'reply-suggestion-v1',
  providerDeploymentProfileVersion: 'private-beta-global-v2',
  capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
  routeKey: 'reply-suggestion',
})

/** What a reply-drafting v2 operation is served under. */
const AI_REPLY_V2_PROFILE = Object.freeze({
  profileVersion: 'reply-suggestion-v2',
  providerDeploymentProfileVersion: 'private-beta-global-v3',
  capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v2',
})

/** The consent every seeded operation is claimed under. */
export const AI_OPERATION_FIXTURE_CONSENT = Object.freeze({
  sourceEpoch: 1,
  replyDraftingEpoch: 1,
  propertyProfileVersion: 1,
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  redactionProfileVersion: 'gbp-review-global-v1',
})

export type AiOperationFixtureInput = Readonly<{
  db: Database
  organizationId: string
  propertyId: string
  actorUserId: string
  /** Stamped on every seeded row; keep it behind the database clock. */
  now: Date
}>

export type AiOperationSeed = Readonly<{
  replyDraftingV2?: ReplyDraftingV2Binding
  id?: string
  state?: 'pending' | 'executing'
  executionAttempt?: number
  executionPermitId?: string | null
  sourceDigest?: string
  sourceByteCount?: number
  /** Row lifetime; the adoption window a grant may issue is clamped by it. */
  expiresAt?: Date
  /** The review the operation reads; one is seeded for it when absent. */
  reviewId?: string
}>

export type AiConsentChange = 'revoke' | 'move_reply_drafting_epoch'
export type AiFixtureExecutor = Pick<Database, 'execute' | 'insert' | 'select' | 'update'>

export type AiReviewSeed = Readonly<{
  id?: string
  sourceDigest?: string
  sourceByteCount?: number
  contentExpiresAt?: Date
}>

export type AiControlPosture = Readonly<{
  executionState: 'enabled' | 'killed'
  admissionState: 'accepting' | 'draining'
}>

export type AiOperationFixture = Readonly<{
  /** The lineage of the Property's Merchant AI consent. */
  authorizationLineageId: string
  /** Insert a review and its source content; returns the review id. */
  seedReview(seed?: AiReviewSeed): Promise<string>
  /** Insert a reply operation row; returns its id. */
  seedOperation(seed?: AiOperationSeed): Promise<string>
  /**
   * The next Merchant AI transition, as the transition function writes it:
   * revoke consent, or move the reply-drafting epoch. Pass a transaction to
   * hold the head locked until it ends.
   */
  changeConsent(change: AiConsentChange, executor?: AiFixtureExecutor): Promise<void>
  /** Move the reply-drafting control to a posture; each move is a new generation. */
  setCapabilityControl(posture: AiControlPosture): Promise<void>
  /** Delete the fixture rows and put the capability control back. */
  remove(): Promise<void>
}>

const CAPABILITY_SCOPE_KEY = `capability:${AI_REPLY_OPERATION_PROFILE.capability}`

async function transitionCapabilityControl(
  db: Database,
  actorUserId: string,
  posture: AiControlPosture,
): Promise<void> {
  const [head] = await db
    .select()
    .from(aiExecutionControlHeads)
    .where(eq(aiExecutionControlHeads.scopeKey, CAPABILITY_SCOPE_KEY))
    .limit(1)
  if (!head) throw new Error(`AI execution control ${CAPABILITY_SCOPE_KEY} is not seeded`)
  if (
    head.executionState === posture.executionState &&
    head.admissionState === posture.admissionState
  ) {
    return
  }
  const generation = head.generation + 1
  // The head guard refuses an update stamped before the previous one; use the
  // wall clock so consecutive runs (and other suites) stay monotonic.
  const occurredAt = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(aiExecutionControlTransitions).values({
      controlId: head.controlId,
      generation,
      predecessorGeneration: head.generation,
      scopeKey: head.scopeKey,
      scopeKind: head.scopeKind,
      scopeValue: head.scopeValue,
      executionState: posture.executionState,
      admissionState: posture.admissionState,
      reasonCode: 'integration_test_transition',
      actorUserId,
      ticketReference: `ai-operation-fixture-${generation}`,
      candidateReleaseSha: null,
      occurredAt,
    })
    await tx
      .update(aiExecutionControlHeads)
      .set({
        generation,
        executionState: posture.executionState,
        admissionState: posture.admissionState,
        updatedAt: occurredAt,
      })
      .where(
        sql`${aiExecutionControlHeads.scopeKey} = ${CAPABILITY_SCOPE_KEY}
          AND ${aiExecutionControlHeads.generation} = ${head.generation}`,
      )
  })
}

/**
 * The Property's processing profile and its consent to reply drafting, written
 * as `apply_merchant_ai_transition_v1` writes an enable: the evidence row, then
 * the head that points at it.
 */
async function seedReplyDraftingConsent(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyId: string
    actorUserId: string
    authorizationLineageId: string
    now: Date
  }>,
): Promise<void> {
  const consent = AI_OPERATION_FIXTURE_CONSENT
  await db.insert(aiPropertyProcessingProfiles).values({
    propertyId: input.propertyId,
    organizationId: input.organizationId,
    countryCode: 'US',
    timezone: 'America/New_York',
    processingRegion: 'global',
    routingPolicyVersion: 1,
    providerDeploymentProfileVersion:
      AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion,
    sourceEpoch: consent.sourceEpoch,
    profileVersion: consent.propertyProfileVersion,
    lifecycleState: 'active',
    updatedAt: input.now,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: consent.sourceEpoch,
    createdAt: input.now,
    updatedAt: input.now,
  })
  const authorization = {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    authorizationLineageId: input.authorizationLineageId,
    stateVersion: 1,
    state: 'enabled',
    capabilities: ['reply_drafting'],
    capabilityRuntimeProfileVersions: {
      reply_drafting: AI_REPLY_OPERATION_PROFILE.capabilityRuntimeProfileVersion,
    },
    reviewAnalysisEpoch: 1,
    replyDraftingEpoch: consent.replyDraftingEpoch,
    propertyTrendsEpoch: 1,
    authorizedSourceEpoch: consent.sourceEpoch,
    analysisStartSequence: 0,
    noticeVersion: consent.noticeVersion,
    noticeDigest: consent.noticeDigest,
    sourcePolicyId: consent.sourcePolicyId,
    routingPolicyVersion: 1,
    processingRegion: 'global',
    providerDeploymentProfileVersion:
      AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion,
    redactionProfileFamily: consent.redactionProfileVersion,
  } as const
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...authorization,
      capabilities: [...authorization.capabilities],
      transitionKind: 'enable',
      actorUserId: input.actorUserId,
      reasonCode: 'merchant_enabled',
      idempotencyKey: `ai-operation-fixture-enable-${input.authorizationLineageId}`,
      requestHash: 'c'.repeat(64),
      occurredAt: input.now,
    })
    await tx.insert(merchantAiEnablement).values({
      ...authorization,
      capabilities: [...authorization.capabilities],
      updatedBy: input.actorUserId,
      updatedAt: input.now,
    })
  })
}

/** Write the next consent transition: evidence first, then the head it names. */
async function changeReplyDraftingConsent(
  executor: AiFixtureExecutor,
  input: Readonly<{
    organizationId: string
    propertyId: string
    actorUserId: string
    change: AiConsentChange
    now: Date
  }>,
): Promise<void> {
  const [head] = await executor
    .select()
    .from(merchantAiEnablement)
    .where(
      sql`${merchantAiEnablement.organizationId} = ${input.organizationId}
        AND ${merchantAiEnablement.propertyId} = ${input.propertyId}`,
    )
    .limit(1)
  if (!head) throw new Error('The fixture Property has no Merchant AI consent')
  const { updatedBy: _updatedBy, updatedAt: _updatedAt, ...current } = head
  const revoked = input.change === 'revoke'
  const next = {
    ...current,
    stateVersion: head.stateVersion + 1,
    ...(revoked
      ? { state: 'revoked', capabilities: [], capabilityRuntimeProfileVersions: {} }
      : { replyDraftingEpoch: head.replyDraftingEpoch + 1 }),
  }
  await executor.execute(
    sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`,
  )
  await executor.insert(merchantAiConsentEvidence).values({
    ...next,
    transitionKind: revoked ? 'revoke' : 'change',
    actorUserId: input.actorUserId,
    reasonCode: revoked ? 'merchant_revoked' : 'merchant_changed',
    idempotencyKey: `ai-operation-fixture-${input.change}-${next.stateVersion}`,
    requestHash: 'c'.repeat(64),
    occurredAt: input.now,
  })
  await executor
    .update(merchantAiEnablement)
    .set({ ...next, updatedBy: input.actorUserId, updatedAt: input.now })
    .where(
      sql`${merchantAiEnablement.organizationId} = ${input.organizationId}
        AND ${merchantAiEnablement.propertyId} = ${input.propertyId}`,
    )
}

/**
 * Install the organization, the property and an open reply-drafting control.
 * The seed leaves every capability killed and draining (fail closed); the
 * ledger reads the heads inside the admission transaction, so the fixture
 * opens this one for the run and `remove()` restores what it found.
 */
export async function installAiOperationFixture(
  input: AiOperationFixtureInput,
): Promise<AiOperationFixture> {
  const { db, organizationId, propertyId, actorUserId, now } = input

  const clear = async () => {
    await db.delete(aiOperations).where(eq(aiOperations.organizationId, organizationId))
    await db
      .delete(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, organizationId))
    await db.delete(properties).where(eq(properties.id, propertyId))
    await deleteTestOrganizationsWithExecutor(db, [organizationId])
  }

  await clear()
  const [head] = await db
    .select({
      executionState: aiExecutionControlHeads.executionState,
      admissionState: aiExecutionControlHeads.admissionState,
    })
    .from(aiExecutionControlHeads)
    .where(eq(aiExecutionControlHeads.scopeKey, CAPABILITY_SCOPE_KEY))
    .limit(1)
  if (
    !head ||
    (head.executionState !== 'enabled' && head.executionState !== 'killed') ||
    (head.admissionState !== 'accepting' && head.admissionState !== 'draining')
  ) {
    throw new Error(`AI execution control ${CAPABILITY_SCOPE_KEY} has an invalid state`)
  }
  const initialPosture: AiControlPosture = {
    executionState: head.executionState,
    admissionState: head.admissionState,
  }
  await transitionCapabilityControl(db, actorUserId, {
    executionState: 'enabled',
    admissionState: 'accepting',
  })

  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organizationId}, 'AI operation fixture', ${organizationId}, ${now})
  `)
  await db.insert(properties).values({
    id: propertyId,
    organizationId,
    name: 'AI operation fixture property',
    slug: `ai-operation-fixture-${propertyId.slice(0, 8)}`,
    timezone: 'America/New_York',
    countryCode: 'US',
    profileVersion: 1,
    sourceEpoch: 1,
  })
  const authorizationLineageId = randomUUID()
  await seedReplyDraftingConsent(db, {
    organizationId,
    propertyId,
    actorUserId,
    authorizationLineageId,
    now,
  })

  /** The control heads as they stand: a seeded operation is claimed under them. */
  const claimedControls = async (v2: boolean) => {
    const heads = await db
      .select({
        scopeKey: aiExecutionControlHeads.scopeKey,
        controlId: aiExecutionControlHeads.controlId,
        generation: aiExecutionControlHeads.generation,
      })
      .from(aiExecutionControlHeads)
    const control = (scopeKey: string) => {
      const found = heads.find((candidate) => candidate.scopeKey === scopeKey)
      if (!found) throw new Error(`AI execution control ${scopeKey} is not seeded`)
      return found
    }
    const providerDeployment = v2
      ? AI_REPLY_V2_PROFILE.providerDeploymentProfileVersion
      : AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion
    return {
      global: control('global'),
      provider: control(`provider:${providerDeployment}`),
      capability: control(CAPABILITY_SCOPE_KEY),
    }
  }

  const seedReview = async (seed: AiReviewSeed = {}) => {
    const id = seed.id ?? randomUUID()
    await db.insert(reviews).values({
      id,
      organizationId,
      propertyId,
      platform: 'google',
      firstFetchedAt: now,
      sourceEpoch: AI_OPERATION_FIXTURE_CONSENT.sourceEpoch,
      sourceRevision: 1,
      analysisSequence: 0,
    })
    await db.insert(reviewSourceContents).values({
      reviewId: id,
      organizationId,
      propertyId,
      platform: 'google',
      externalId: `ai-operation-fixture-${id}`,
      externalLocationId: 'locations/ai-operation-fixture',
      rating: 4,
      reviewedAt: now,
      firstFetchedAt: now,
      lastFetchedAt: now,
      contentExpiresAt:
        seed.contentExpiresAt ?? new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      sourceEpoch: AI_OPERATION_FIXTURE_CONSENT.sourceEpoch,
      sourceRevision: 1,
      aiSourceByteLength: seed.sourceByteCount ?? 20,
      aiSourceDigest: seed.sourceDigest ?? 'e'.repeat(64),
    })
    return id
  }

  return Object.freeze({
    authorizationLineageId,
    seedReview,
    async seedOperation(seed: AiOperationSeed = {}) {
      const id = seed.id ?? randomUUID()
      const sourceDigest = seed.sourceDigest ?? 'e'.repeat(64)
      const sourceByteCount = seed.sourceByteCount ?? 20
      const reviewId =
        seed.reviewId ?? (await seedReview({ sourceDigest, sourceByteCount }))
      const v2 = seed.replyDraftingV2 !== undefined
      const { global, provider, capability } = await claimedControls(v2)
      const [consent] = await db
        .select({ replyDraftingEpoch: merchantAiEnablement.replyDraftingEpoch })
        .from(merchantAiEnablement)
        .where(eq(merchantAiEnablement.propertyId, propertyId))
        .limit(1)
      await db.insert(aiOperations).values({
        id,
        idempotencyScope: `reply:${id}`,
        idempotencyKey: id,
        requestFingerprint: 'f'.repeat(64),
        sourceDigest,
        sourceByteCount,
        command: AI_REPLY_OPERATION_PROFILE.command,
        capability: AI_REPLY_OPERATION_PROFILE.capability,
        organizationId,
        propertyId,
        actorUserId,
        systemPrincipal: null,
        reviewId,
        sourceEpoch: AI_OPERATION_FIXTURE_CONSENT.sourceEpoch,
        sourceRevision: 1,
        reviewedAtEpochMillis: now.getTime(),
        tone: 'professional',
        baseReplyStateRevision: 0,
        propertyProfileVersion: AI_OPERATION_FIXTURE_CONSENT.propertyProfileVersion,
        authorizationLineageId,
        noticeVersion: AI_OPERATION_FIXTURE_CONSENT.noticeVersion,
        noticeDigest: AI_OPERATION_FIXTURE_CONSENT.noticeDigest,
        sourcePolicyId: AI_OPERATION_FIXTURE_CONSENT.sourcePolicyId,
        redactionProfileVersion: AI_OPERATION_FIXTURE_CONSENT.redactionProfileVersion,
        providerDeploymentProfileVersion: v2
          ? AI_REPLY_V2_PROFILE.providerDeploymentProfileVersion
          : AI_REPLY_OPERATION_PROFILE.providerDeploymentProfileVersion,
        operationProfileVersion: v2
          ? AI_REPLY_V2_PROFILE.profileVersion
          : AI_REPLY_OPERATION_PROFILE.profileVersion,
        replyDraftingV2: seed.replyDraftingV2 ?? null,
        rewriteParentOperationId: seed.replyDraftingV2?.parentOperationId ?? null,
        capabilityRuntimeProfileVersion: v2
          ? AI_REPLY_V2_PROFILE.capabilityRuntimeProfileVersion
          : AI_REPLY_OPERATION_PROFILE.capabilityRuntimeProfileVersion,
        globalControlId: global.controlId,
        globalControlGeneration: global.generation,
        providerControlId: provider.controlId,
        providerControlGeneration: provider.generation,
        capabilityControlId: capability.controlId,
        capabilityControlGeneration: capability.generation,
        capabilityFences: {
          capability: AI_REPLY_OPERATION_PROFILE.capability,
          replyDraftingEpoch:
            consent?.replyDraftingEpoch ??
            AI_OPERATION_FIXTURE_CONSENT.replyDraftingEpoch,
          baseReplyStateRevision: 0,
        },
        state: seed.state ?? 'pending',
        executionAttempt: seed.executionAttempt ?? 0,
        executionPermitId: seed.executionPermitId ?? null,
        createdAt: now,
        updatedAt: now,
        expiresAt: seed.expiresAt ?? new Date(now.getTime() + 60 * 60_000),
      })
      return id
    },
    async changeConsent(change: AiConsentChange, executor?: AiFixtureExecutor) {
      const write = (tx: AiFixtureExecutor) =>
        changeReplyDraftingConsent(tx, {
          organizationId,
          propertyId,
          actorUserId,
          change,
          now,
        })
      // The transition flag is transaction-local, so the write needs one.
      await (executor ? write(executor) : db.transaction(write))
    },
    async setCapabilityControl(posture: AiControlPosture) {
      await transitionCapabilityControl(db, actorUserId, posture)
    },
    async remove() {
      await clear()
      await transitionCapabilityControl(db, actorUserId, initialPosture)
    },
  })
}
