import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Pool } from 'pg'
import { createDatabase, type Database } from '#/shared/db'
import { aiExecutionControlHeads, aiOperations } from '#/shared/db/schema'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { AI_REPLY_ADOPTION_WINDOW_MILLIS } from '#/shared/ai-reply-provenance'
import { settledCostMicrosWith } from '#/shared/ai-provider-pricing'
import { priceCatalogueOfProvider } from '#/shared/ai-provider-pricing-registry'
import {
  aiSettlementRequestSchema,
  type AiAdmissionDescriptorV1,
  type AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import {
  mintAiExecutionAdmission,
  type AiAdmissionDenialCode,
  type AiExecutionAdmissionAuthority,
  type AiSettlementDenialCode,
} from '#/shared/ai-provider-control/execution-admission'
import { createAiBudgetControl, type AiBudgetControl } from '#/shared/db/ai/ai-budget'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import {
  authorizedEffectOperationColumns,
  isCurrentAuthorizedEffect,
} from './ai-authorized-effect'
import { readCurrentReviewSource, sourceHoldsOperation } from './ai-review-source-fence'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type PropertyDescriptor = Extract<AiAdmissionDescriptorV1, { subjectKind: 'property' }>

type PropertyDenial = Exclude<
  AiAdmissionDenialCode,
  'malformed_request' | 'canary_not_eligible'
>

type Dependencies = Readonly<{
  pool: Pool
  budgetControl?: AiBudgetControl
  now?: () => Date
}>

/** The profile a descriptor names: its route and its operation profile version. */
function profileFor(route: string, operationProfileVersion: string) {
  return AI_OPERATION_PROFILES.find(
    (profile) =>
      profile.sourceRoute === route &&
      profile.profileVersion === operationProfileVersion &&
      profile.capability !== null,
  )
}

function budgetDenial(
  code:
    'kill_switch' | 'budget_exhausted' | 'capability_unavailable' | 'already_reserved',
): PropertyDenial {
  switch (code) {
    case 'kill_switch':
      return 'control_disabled'
    case 'budget_exhausted':
      return 'quota_exhausted'
    case 'capability_unavailable':
      return 'authorization_changed'
    case 'already_reserved':
      return 'already_consumed'
  }
}

function settlementState(
  disposition: AiSettlementRequestV1['disposition'],
): 'settled' | 'released' | 'ambiguous' {
  if (disposition === 'no_dispatch') return 'released'
  if (disposition === 'transport_ambiguous') return 'ambiguous'
  return 'settled'
}

/**
 * What a settlement charges. A withheld dispatch costs nothing. A dispatch whose
 * usage is unknown (a timeout, a lost connection) may have been billed in full,
 * so it costs the reservation. Known usage, a refusal by status included, is
 * priced from the provider's list.
 */
function settledCost(
  request: AiSettlementRequestV1,
  reservedMicros: number,
  pricing: ReturnType<typeof priceCatalogueOfProvider>,
): number {
  if (request.disposition === 'no_dispatch' || pricing === null) return 0
  if (!request.usageKnown) return reservedMicros
  return Number(settledCostMicrosWith(pricing, request))
}

/**
 * Where the operation's one reservation stands. The ledger decides: a process that admitted and then died leaves an open
 * reservation, and another process must not admit beside it. Only a reservation
 * settled at zero (dispatch withheld, or known zero usage) lets the next attempt
 * reserve afresh; a charged or open one would put a second provider call
 * against a single reservation.
 */
function reservationState(
  operation: Readonly<{
    costWindowId: string | null
    budgetSettledAt: Date | null
    actualMicros: number | null
  }>,
): 'none' | 'open' | 'charged' | 'released' {
  if (operation.costWindowId === null) return 'none'
  if (operation.budgetSettledAt === null) return 'open'
  return operation.actualMicros === 0 ? 'released' : 'charged'
}

/** Clears a released reservation so the next attempt reserves afresh. */
const RELEASED_RESERVATION_CLEARED = Object.freeze({
  costWindowId: null,
  reservedMicros: 0,
  budgetReservedAt: null,
  budgetSettledAt: null,
  actualMicros: null,
})

const admissionOperationColumns = {
  ...authorizedEffectOperationColumns,
  id: aiOperations.id,
  executionPermitId: aiOperations.executionPermitId,
  replyDraftingV2: aiOperations.replyDraftingV2,
  reviewId: aiOperations.reviewId,
  sourceRevision: aiOperations.sourceRevision,
  sourceDigest: aiOperations.sourceDigest,
  sourceByteCount: aiOperations.sourceByteCount,
  analysisSequence: aiOperations.analysisSequence,
  baseReplyStateRevision: aiOperations.baseReplyStateRevision,
  costWindowId: aiOperations.costWindowId,
  budgetSettledAt: aiOperations.budgetSettledAt,
  actualMicros: aiOperations.actualMicros,
  expiresAt: aiOperations.expiresAt,
} as const

async function lockAdmissionOperation(tx: Transaction, descriptor: PropertyDescriptor) {
  const [operation] = await tx
    .select(admissionOperationColumns)
    .from(aiOperations)
    .where(
      and(
        eq(aiOperations.id, descriptor.operationId),
        eq(aiOperations.organizationId, descriptor.organizationId),
        eq(aiOperations.propertyId, descriptor.propertyId),
      ),
    )
    .limit(1)
    .for('update')
  return operation
}

type AdmissionOperation = NonNullable<Awaited<ReturnType<typeof lockAdmissionOperation>>>

function isExecutingAttempt(
  operation: AdmissionOperation | undefined,
  descriptor: PropertyDescriptor,
): operation is AdmissionOperation {
  return (
    operation !== undefined &&
    operation.state === 'executing' &&
    operation.executionAttempt === descriptor.attemptNumber &&
    operation.executionPermitId === descriptor.permitId &&
    operation.sourceDigest === descriptor.sourceDigest &&
    operation.sourceByteCount === descriptor.sourceByteCount &&
    canonicalizeRfc8785(operation.replyDraftingV2) ===
      canonicalizeRfc8785(descriptor.binding.replyDraftingV2 ?? null)
  )
}

function capabilityFence(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

/**
 * Whether the three controls the operation was claimed under still accept work.
 * Read only to tell a stopped control from moved consent after the authorized
 * effect fence refused; that fence already holds them share-locked.
 */
async function controlsAccepting(
  tx: Transaction,
  operation: AdmissionOperation,
  capability: MerchantAiCapability,
): Promise<boolean> {
  const scopeKeys = [
    'global',
    `provider:${operation.providerDeploymentProfileVersion}`,
    `capability:${capability}`,
  ]
  const controls = await tx
    .select({
      executionState: aiExecutionControlHeads.executionState,
      admissionState: aiExecutionControlHeads.admissionState,
    })
    .from(aiExecutionControlHeads)
    .where(inArray(aiExecutionControlHeads.scopeKey, scopeKeys))
  return (
    controls.length === scopeKeys.length &&
    controls.every(
      (control) =>
        control.executionState === 'enabled' && control.admissionState === 'accepting',
    )
  )
}

/**
 * The final authority before a provider call: the consent, epochs, processing
 * profile and control generations the operation was claimed under, re-read in
 * the transaction that holds the operation row. Lock order matches the output
 * write: operation, enablement, profile, controls, then the review.
 */
async function authorizedEffectDenial(
  tx: Transaction,
  operation: AdmissionOperation,
  capability: MerchantAiCapability,
): Promise<PropertyDenial | null> {
  const fence = capabilityFence(operation.capabilityFences)
  if (
    fence?.capability === capability &&
    (await isCurrentAuthorizedEffect(tx, {
      capability,
      operation,
      capabilityFence: fence,
    }))
  ) {
    return null
  }
  return (await controlsAccepting(tx, operation, capability))
    ? 'authorization_changed'
    : 'control_disabled'
}

/**
 * The review source the operation read, re-read under a share lock: the same
 * epoch, revision, digest and size, content unexpired now, and the contract's
 * own fence, the analysis sequence or the reply state.
 */
async function reviewSourceHolds(
  tx: Transaction,
  operation: AdmissionOperation,
  capability: MerchantAiCapability,
  at: Date,
): Promise<boolean> {
  if (
    operation.reviewId === null ||
    operation.sourceEpoch === null ||
    operation.sourceRevision === null
  ) {
    return false
  }
  const source = await readCurrentReviewSource(tx, {
    organizationId: operation.organizationId,
    propertyId: operation.propertyId,
    reviewId: operation.reviewId,
  })
  if (
    source === undefined ||
    !sourceHoldsOperation(
      source,
      operation,
      { sourceEpoch: operation.sourceEpoch, sourceRevision: operation.sourceRevision },
      at,
    )
  ) {
    return false
  }
  if (capability === 'review_analysis') {
    return (
      operation.analysisSequence !== null &&
      source.analysisSequence === operation.analysisSequence
    )
  }
  if (capability === 'reply_drafting') {
    return (
      operation.baseReplyStateRevision !== null &&
      source.replyStateRevision === operation.baseReplyStateRevision
    )
  }
  return false
}

export function createAiExecutionAdmissionAdapter(
  input: Dependencies,
): AiExecutionAdmissionAuthority {
  const db = createDatabase(input.pool)
  const now = input.now ?? (() => new Date())
  const budget = input.budgetControl ?? createAiBudgetControl({ idGen: randomUUID, now })

  const authorizeProperty = (descriptor: PropertyDescriptor) =>
    db.transaction(async (tx) => {
      const profile = profileFor(
        descriptor.route,
        descriptor.binding.operationProfileVersion,
      )
      if (
        !profile?.capability ||
        descriptor.binding.providerDeploymentProfileVersion !==
          profile.providerDeploymentProfileVersion ||
        descriptor.binding.capabilityRuntimeProfileVersion !==
          profile.capabilityRuntimeProfileVersion
      ) {
        return { status: 'denied' as const, code: 'authorization_changed' as const }
      }
      const operation = await lockAdmissionOperation(tx, descriptor)
      if (!isExecutingAttempt(operation, descriptor)) {
        return { status: 'denied' as const, code: 'subject_mismatch' as const }
      }
      const issuedAt = now()
      const issuedAtEpochMillis = issuedAt.getTime()
      if (descriptor.callerDeadlineEpochMillis <= issuedAtEpochMillis) {
        return { status: 'denied' as const, code: 'permit_expired' as const }
      }
      const reservation = reservationState(operation)
      if (reservation === 'open' || reservation === 'charged') {
        return { status: 'denied' as const, code: 'already_consumed' as const }
      }
      const authorizationDenial = await authorizedEffectDenial(
        tx,
        operation,
        profile.capability,
      )
      if (authorizationDenial !== null) {
        return { status: 'denied' as const, code: authorizationDenial }
      }
      if (!(await reviewSourceHolds(tx, operation, profile.capability, issuedAt))) {
        return { status: 'denied' as const, code: 'source_mismatch' as const }
      }
      if (reservation === 'released') {
        await tx
          .update(aiOperations)
          .set(RELEASED_RESERVATION_CLEARED)
          .where(
            and(
              eq(aiOperations.id, descriptor.operationId),
              eq(aiOperations.organizationId, descriptor.organizationId),
            ),
          )
      }

      const admitted = await budget.admitAiOperation(tx, {
        organizationId: descriptor.organizationId,
        propertyId: descriptor.propertyId,
        operationKey: descriptor.operationId,
        routeKey: descriptor.route,
        operationProfileVersion: descriptor.binding.operationProfileVersion,
        providerPayloadBytes: descriptor.providerPayloadByteCount,
      })
      if (!admitted.ok) {
        return { status: 'denied' as const, code: budgetDenial(admitted.code) }
      }
      // The adoption window outlives the provider request deadline on
      // purpose: it is the operator's reading time, not the call's. It can
      // never outlive the operation row, whose `expires_at` the accepting
      // transaction also checks.
      const adoptionWindowEnd =
        descriptor.route === 'reply-suggestion'
          ? Math.min(
              issuedAtEpochMillis + AI_REPLY_ADOPTION_WINDOW_MILLIS,
              operation.expiresAt.getTime(),
            )
          : null
      await tx
        .update(aiOperations)
        .set({ updatedAt: issuedAt })
        .where(
          and(
            eq(aiOperations.id, descriptor.operationId),
            eq(aiOperations.organizationId, descriptor.organizationId),
          ),
        )
      return {
        status: 'admitted' as const,
        admission: mintAiExecutionAdmission(descriptor, {
          issuedAtEpochMillis,
          replyTokenExpiresAtEpochMillis: adoptionWindowEnd,
          replyDraftExpiresAtEpochMillis: adoptionWindowEnd,
        }),
      }
    })

  return Object.freeze({
    authorize: async (descriptor) =>
      // The synthetic canary has no operation row to admit against.
      descriptor.subjectKind === 'property'
        ? authorizeProperty(descriptor)
        : { status: 'denied' as const, code: 'canary_not_eligible' as const },

    settle: async (permit, outcome) => {
      if (
        !aiSettlementRequestSchema.shape.operationId.safeParse(permit.operationId).success
      ) {
        return { status: 'denied', code: 'settlement_conflict' }
      }
      return db.transaction(async (tx) => {
        const [operation] = await tx
          .select({
            id: aiOperations.id,
            state: aiOperations.state,
            executionAttempt: aiOperations.executionAttempt,
            executionPermitId: aiOperations.executionPermitId,
            providerId: aiOperations.providerId,
            costWindowId: aiOperations.costWindowId,
            reservedMicros: aiOperations.reservedMicros,
            actualMicros: aiOperations.actualMicros,
            budgetSettledAt: aiOperations.budgetSettledAt,
          })
          .from(aiOperations)
          .where(eq(aiOperations.id, permit.operationId))
          .limit(1)
          .for('update')
        if (!operation) {
          return {
            status: 'denied' as const,
            code: 'permit_unknown' as AiSettlementDenialCode,
          }
        }
        if (
          operation.executionPermitId !== permit.permitId ||
          operation.executionAttempt !== permit.attemptNumber
        ) {
          return { status: 'denied' as const, code: 'permit_mismatch' as const }
        }
        // One admission holds one open reservation, and settling closes it. A
        // reservation never opened has nothing to settle; one already closed
        // (settled here, or charged by the reaper) is not settled twice.
        const reservation = reservationState(operation)
        if (reservation === 'none') {
          return { status: 'denied' as const, code: 'permit_not_consumed' as const }
        }
        if (reservation !== 'open') {
          return { status: 'denied' as const, code: 'settlement_conflict' as const }
        }
        const parsed = aiSettlementRequestSchema.safeParse({
          ...outcome,
          operationId: permit.operationId,
          permitId: permit.permitId,
          attemptNumber: permit.attemptNumber,
        })
        if (!parsed.success) {
          return { status: 'denied' as const, code: 'settlement_conflict' as const }
        }
        const request = parsed.data
        // Price from the stored provider, never a caller-supplied catalogue.
        // A provider with no price list settles nothing.
        const pricing = priceCatalogueOfProvider(operation.providerId)
        if (pricing === null && request.disposition !== 'no_dispatch') {
          return { status: 'denied' as const, code: 'settlement_conflict' as const }
        }
        const cost = settledCost(request, operation.reservedMicros, pricing)
        if (!Number.isSafeInteger(cost) || cost > operation.reservedMicros) {
          return { status: 'denied' as const, code: 'settlement_conflict' as const }
        }
        await budget.settleAiOperation(tx, request.operationId, cost)
        const settledAtEpochMillis = now().getTime()
        return {
          status: 'settled' as const,
          receipt: {
            version: 'ai-settlement-receipt-v1' as const,
            operationId: request.operationId,
            permitId: request.permitId,
            attemptNumber: request.attemptNumber,
            disposition: request.disposition,
            reportedDisposition: request.reportedDisposition,
            usageKnown: request.usageKnown,
            providerRetryable: request.providerRetryable,
            inputTokens: request.inputTokens,
            cachedInputTokens: request.cachedInputTokens,
            outputTokens: request.outputTokens,
            reasoningTokens: request.reasoningTokens,
            costMicros: cost,
            settledAtEpochMillis,
            settlementState: settlementState(request.disposition),
          },
        }
      })
    },

    readiness: async () => {
      const result = await input.pool.query<{ ready: boolean }>(
        'SELECT NOT pg_is_in_recovery() AS ready',
      )
      return result.rows[0]?.ready === true
    },
  })
}
