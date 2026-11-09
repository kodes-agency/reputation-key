import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import type { AiMerchantAuthorizationSnapshot } from '#/contexts/ai/application/ports/ai-authorization.port'
import type { AiControlHead } from '#/contexts/ai/application/ports/ai-control.port'
import { createAiAuthorizationAdapter } from '#/contexts/ai/infrastructure/adapters/ai-authorization.adapter'
import { createAiControlAdapter } from '#/contexts/ai/infrastructure/adapters/ai-control.adapter'
import { createAiOperationStoreAdapter } from '#/contexts/ai/infrastructure/adapters/ai-operation-store.adapter'
import { getDb, type Database } from '#/shared/db'
import { createAiBudgetControl } from '#/shared/db/ai/ai-budget'
import {
  aiOperations,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, vi } from 'vitest'

/** Each example uses real SQL and constraints; rollback also restores global controls. */
export function useAiHandlerDatabase() {
  let db: Database
  let finish: () => void
  let transaction: Promise<unknown>
  const rollback = new Error('rollback handler fixture')
  beforeEach(async () => {
    let ready!: () => void
    const started = new Promise<void>((resolve) => {
      ready = resolve
    })
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    transaction = getDb()
      .transaction(async (tx) => {
        // A single connection queues transactions, just as a one-connection pool does.
        // Serialize savepoints so concurrent handler joins cannot release each other's.
        const nested = tx.transaction.bind(tx)
        let queue = Promise.resolve<unknown>(undefined)
        tx.transaction = <T>(
          work: (
            connection: Parameters<Parameters<typeof tx.transaction>[0]>[0],
          ) => Promise<T>,
        ): Promise<T> => {
          const next = queue.then(() => nested(work))
          queue = next.catch(() => undefined)
          return next
        }
        db = tx as unknown as Database
        ready()
        await finished
        throw rollback
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error
      })
    await Promise.race([started, transaction])
  })
  afterEach(async () => {
    try {
      finish?.()
    } finally {
      await transaction
    }
  })
  return () => db
}

type Seed = Readonly<{
  organizationId: string
  propertyId: string
  operationId: string
  permitId: string
  lineageId: string
  now: number
  capability: 'review_analysis' | 'reply_drafting'
  authorization?: 'absent'
  consentNotice?: Readonly<{ noticeVersion: string; noticeDigest: string }>
  runtimeProfile?: string
  providerDeployment?: string
}>

function authorizationEpochs(
  change: Partial<AiMerchantAuthorizationSnapshot>,
  previous: typeof merchantAiEnablement.$inferSelect | undefined,
) {
  return {
    reviewAnalysisEpoch:
      change.capabilityEpochs?.review_analysis.epoch ??
      previous?.reviewAnalysisEpoch ??
      1,
    replyDraftingEpoch:
      change.capabilityEpochs?.reply_drafting.epoch ?? previous?.replyDraftingEpoch ?? 1,
    propertyTrendsEpoch:
      change.capabilityEpochs?.property_trends.epoch ??
      previous?.propertyTrendsEpoch ??
      1,
    authorizedSourceEpoch:
      change.authorizedSourceEpoch ?? previous?.authorizedSourceEpoch ?? 2,
  }
}

export async function createAiHandlerHarness(db: Database, seed: Seed) {
  const now = new Date(seed.now)
  // Multiple independent fixtures may be used in an example; replacing a Property
  // cascades its consent evidence through the same guards as organization cleanup.
  await db
    .delete(aiOperations)
    .where(eq(aiOperations.organizationId, seed.organizationId))
  await db
    .delete(properties)
    .where(
      and(
        eq(properties.id, seed.propertyId),
        eq(properties.organizationId, seed.organizationId),
      ),
    )
  await db.execute(sql`INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${seed.organizationId}, 'Synthetic handler organization', ${seed.organizationId}, ${now})
    ON CONFLICT (id) DO NOTHING`)
  await db.insert(properties).values({
    id: seed.propertyId,
    organizationId: seed.organizationId,
    name: 'Synthetic handler property',
    slug: seed.propertyId,
    countryCode: 'US',
    timezone: 'America/New_York',
    sourceEpoch: 2,
    profileVersion: 3,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    sourceEpoch: 2,
    headSequence: 7,
    createdAt: now,
    updatedAt: now,
  })
  const authorizationAdapter = createAiAuthorizationAdapter(db)
  const controlAdapter = createAiControlAdapter(db, replyScopeEffects)
  let ids = 0
  const operationAdapter = createAiOperationStoreAdapter(db, () => {
    ids += 1
    return ids === 1 ? seed.operationId : ids === 2 ? seed.permitId : randomUUID()
  })
  const authorization = {
    readMerchantAuthorization: vi.fn(authorizationAdapter.readMerchantAuthorization),
  }
  const control = {
    readHeads: vi.fn(controlAdapter.readHeads),
    transition: vi.fn(controlAdapter.transition),
  }
  const operations = {
    ...operationAdapter,
    claim: vi.fn(operationAdapter.claim),
    claimExecution: vi.fn(operationAdapter.claimExecution),
    recordFailure: vi.fn(operationAdapter.recordFailure),
    markDelivered: vi.fn(operationAdapter.markDelivered),
  }
  const scope = {
    organizationId: organizationId(seed.organizationId),
    propertyId: propertyId(seed.propertyId),
  }
  async function grant(change: Partial<AiMerchantAuthorizationSnapshot> = {}) {
    const [previous] = await db
      .select()
      .from(merchantAiEnablement)
      .where(
        and(
          eq(merchantAiEnablement.propertyId, seed.propertyId),
          eq(merchantAiEnablement.organizationId, seed.organizationId),
        ),
      )
    const state = change.state ?? previous?.state ?? 'enabled'
    const capabilities =
      state === 'enabled' ? (change.capabilities ?? [seed.capability]) : []
    const contract = {
      ...scope,
      authorizationLineageId: seed.lineageId,
      stateVersion: (previous?.stateVersion ?? 0) + 1,
      state,
      capabilities: [...capabilities],
      capabilityRuntimeProfileVersions: Object.fromEntries(
        capabilities.map((capability) => [
          capability,
          change.capabilityRuntimeProfileVersions?.[capability] ??
            previous?.capabilityRuntimeProfileVersions[capability] ??
            (capability === 'reply_drafting'
              ? 'reply-drafting-runtime-v1'
              : (seed.runtimeProfile ?? 'review-analysis-runtime-v1')),
        ]),
      ),
      ...authorizationEpochs(change, previous),
      analysisStartSequence: 1,
      noticeVersion:
        change.noticeVersion ??
        seed.consentNotice?.noticeVersion ??
        MERCHANT_AI_NOTICE_VERSION,
      noticeDigest:
        change.noticeDigest ??
        seed.consentNotice?.noticeDigest ??
        MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      processingRegion: 'global',
      providerDeploymentProfileVersion:
        change.providerDeploymentProfileVersion ??
        seed.providerDeployment ??
        'private-beta-global-v2',
      redactionProfileFamily: 'gbp-review-global-v1',
    }
    await db
      .insert(reviewAiAnalysisHeads)
      .values({
        ...scope,
        sourceEpoch: contract.authorizedSourceEpoch,
        headSequence: 7,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        ...contract,
        transitionKind: previous ? 'change' : 'enable',
        actorUserId: 'synthetic-manager',
        reasonCode: 'merchant_enabled',
        idempotencyKey: randomUUID(),
        requestHash: 'c'.repeat(64),
        occurredAt: now,
      })
      await tx
        .insert(merchantAiEnablement)
        .values({ ...contract, updatedBy: 'synthetic-manager', updatedAt: now })
        .onConflictDoUpdate({
          target: merchantAiEnablement.propertyId,
          set: { ...contract, updatedBy: 'synthetic-manager', updatedAt: now },
        })
    })
  }
  if (seed.authorization !== 'absent') await grant()

  async function transition(
    executionState: 'enabled' | 'killed',
    admissionState: 'accepting' | 'draining' = 'accepting',
    kind: AiControlHead['scope']['kind'] = 'capability',
  ) {
    const heads = await controlAdapter.readHeads({
      capability: seed.capability,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
    })
    const head = heads.find((item) => item.scope.kind === kind)
    if (!head) throw new Error('fixture control missing')
    const next = await controlAdapter.transition({
      scope: head.scope,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      expectedControlId: head.controlId,
      expectedGeneration: head.generation,
      executionState,
      admissionState,
      reasonCode: 'operator_action',
      actorUserId: null,
      ticketReference: 'synthetic-control-test',
      candidateReleaseSha:
        kind === 'capability' &&
        executionState === 'enabled' &&
        admissionState === 'accepting'
          ? 'a'.repeat(40)
          : null,
    })
    if (!next) throw new Error('fixture control transition refused')
    return next
  }
  async function patchOperation(
    change: Partial<typeof aiOperations.$inferInsert>,
    id = seed.operationId,
  ) {
    if (Object.keys(change).length === 0) return
    await db
      .update(aiOperations)
      .set(change)
      .where(
        and(
          eq(aiOperations.id, id),
          eq(aiOperations.organizationId, seed.organizationId),
        ),
      )
  }
  for (const kind of ['global', 'provider_deployment_profile', 'capability'] as const) {
    const heads = await controlAdapter.readHeads({
      capability: seed.capability,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
    })
    const head = heads.find((item) => item.scope.kind === kind)
    if (head?.executionState !== 'enabled' || head.admissionState !== 'accepting')
      await transition('enabled', 'accepting', kind)
  }
  const openHeads = await controlAdapter.readHeads({
    capability: seed.capability,
    providerDeploymentProfileVersion: 'private-beta-global-v2',
  })
  function seedClaim(change: Partial<typeof aiOperations.$inferInsert>) {
    operations.claim.mockImplementationOnce(async (request) => {
      const first = await operationAdapter.claim(request)
      await patchOperation(change, first.operation.id)
      return operationAdapter.claim(request)
    })
  }
  const budget = createAiBudgetControl({ idGen: randomUUID, now: () => now })
  async function settleProviderOperation(operationId: string, costMicros = 42) {
    const [operation] = await db
      .select()
      .from(aiOperations)
      .where(
        and(
          eq(aiOperations.id, operationId),
          eq(aiOperations.organizationId, seed.organizationId),
        ),
      )
    if (!operation) throw new Error('provider operation missing')
    return db.transaction(async (tx) => {
      const admission = await budget.admitAiOperation(tx, {
        ...scope,
        operationKey: operationId,
        routeKey: operation.routeKey!,
        operationProfileVersion: operation.operationProfileVersion,
        providerPayloadBytes: 1024,
      })
      if (!admission.ok) return admission
      await budget.settleAiOperation(tx, operationId, costMicros)
      return admission
    })
  }
  return {
    settleProviderOperation,
    budget,
    controlAdapter,
    seedClaim,
    openHeads,
    db,
    authorization,
    control,
    operations,
    grant,
    transition,
    patchOperation,
    async storedOperations() {
      return db
        .select()
        .from(aiOperations)
        .where(eq(aiOperations.organizationId, seed.organizationId))
    },
    async readAuthorization() {
      return authorizationAdapter.readMerchantAuthorization(scope)
    },
  }
}
