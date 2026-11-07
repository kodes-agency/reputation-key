import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { createDatabase } from '#/shared/db'
import { aiOperations } from '#/shared/db/schema'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { AI_REPLY_ADOPTION_WINDOW_MILLIS } from '#/shared/ai-reply-provenance'
import { settledCostMicrosWith } from '#/shared/ai-provider-pricing'
import { priceCatalogueOfProvider } from '#/shared/ai-provider-pricing-registry'
import {
  aiSettlementRequestSchema,
  type AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import type {
  AiAdmissionDatabaseAuthority,
  AiAdmissionDenialCode,
  AiSettlementDenialCode,
} from '#/shared/ai-provider-control/admission-service'
import { createAiBudgetControl, type AiBudgetControl } from './ai-budget'

const KEY_ID = /^[a-z][a-z0-9_-]{0,31}$/

type PropertyDenial = Exclude<
  AiAdmissionDenialCode,
  'malformed_request' | 'request_binding_invalid' | 'canary_not_eligible'
>

type Dependencies = Readonly<{
  pool: Pool
  signingKid: string
  budgetControl?: AiBudgetControl
  now?: () => Date
  nonce?: () => string
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

function admissionDenial(
  code: 'kill_switch' | 'budget_exhausted' | 'capability_unavailable',
): PropertyDenial {
  switch (code) {
    case 'kill_switch':
      return 'control_disabled'
    case 'budget_exhausted':
      return 'quota_exhausted'
    case 'capability_unavailable':
      return 'authorization_changed'
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
 * An admission whose reservation was settled at zero cost: the gateway withheld
 * dispatch and released it, or the provider reported known zero usage. It must
 * not block the operation's next attempt. A charged or still-open admission
 * keeps blocking: the ledger holds one reservation per operation, and a second
 * provider call against it would be unaccounted.
 */
function releasedWithoutCharge(
  operation: Readonly<{ budgetSettledAt: Date | null; actualMicros: number | null }>,
): boolean {
  return operation.budgetSettledAt !== null && operation.actualMicros === 0
}

/** Clears a released admission so the next attempt is admitted afresh. */
const RELEASED_ADMISSION_CLEARED = Object.freeze({
  admissionNonce: null,
  requestBindingKeyId: null,
  requestBindingHmac: null,
  grantKid: null,
  costWindowId: null,
  reservedMicros: 0,
  budgetReservedAt: null,
  budgetSettledAt: null,
  actualMicros: null,
})

export function createPostgresAiAdmissionAuthority(
  input: Dependencies,
): AiAdmissionDatabaseAuthority {
  if (!KEY_ID.test(input.signingKid)) {
    throw new Error('AI admission database signing key ID is invalid')
  }
  const db = createDatabase(input.pool)
  const now = input.now ?? (() => new Date())
  const budget = input.budgetControl ?? createAiBudgetControl({ idGen: randomUUID, now })
  const nonce = input.nonce ?? (() => randomBytes(18).toString('base64url'))

  return Object.freeze({
    authorizeProperty: async (descriptor, requestBinding) =>
      db.transaction(async (tx) => {
        const profile = profileFor(
          descriptor.route,
          descriptor.binding.operationProfileVersion,
        )
        if (
          !profile ||
          descriptor.binding.operationProfileVersion !== profile.profileVersion ||
          descriptor.binding.providerDeploymentProfileVersion !==
            profile.providerDeploymentProfileVersion ||
          descriptor.binding.capabilityRuntimeProfileVersion !==
            profile.capabilityRuntimeProfileVersion
        ) {
          return { status: 'denied' as const, code: 'authorization_changed' as const }
        }
        const [operation] = await tx
          .select({
            id: aiOperations.id,
            state: aiOperations.state,
            executionAttempt: aiOperations.executionAttempt,
            executionPermitId: aiOperations.executionPermitId,
            replyDraftingV2: aiOperations.replyDraftingV2,
            sourceDigest: aiOperations.sourceDigest,
            sourceByteCount: aiOperations.sourceByteCount,
            requestBindingKeyId: aiOperations.requestBindingKeyId,
            requestBindingHmac: aiOperations.requestBindingHmac,
            admissionNonce: aiOperations.admissionNonce,
            budgetSettledAt: aiOperations.budgetSettledAt,
            actualMicros: aiOperations.actualMicros,
            expiresAt: aiOperations.expiresAt,
          })
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
        if (
          !operation ||
          operation.state !== 'executing' ||
          operation.executionAttempt !== descriptor.attemptNumber ||
          operation.executionPermitId !== descriptor.permitId ||
          operation.sourceDigest !== descriptor.sourceDigest ||
          operation.sourceByteCount !== descriptor.sourceByteCount ||
          canonicalizeRfc8785(operation.replyDraftingV2) !==
            canonicalizeRfc8785(descriptor.binding.replyDraftingV2 ?? null)
        ) {
          return { status: 'denied' as const, code: 'subject_mismatch' as const }
        }
        const issuedAtEpochMillis = now().getTime()
        if (descriptor.callerDeadlineEpochMillis <= issuedAtEpochMillis) {
          return { status: 'denied' as const, code: 'permit_expired' as const }
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
        if (operation.admissionNonce !== null) {
          if (
            operation.requestBindingKeyId === requestBinding.keyId &&
            operation.requestBindingHmac === requestBinding.hmac
          ) {
            return {
              status: 'admitted' as const,
              nonce: operation.admissionNonce,
              issuedAtEpochMillis,
              expiresAtEpochMillis: descriptor.callerDeadlineEpochMillis,
              replyTokenExpiresAtEpochMillis: adoptionWindowEnd,
              replyDraftExpiresAtEpochMillis: adoptionWindowEnd,
            }
          }
          if (!releasedWithoutCharge(operation)) {
            return { status: 'denied' as const, code: 'already_consumed' as const }
          }
          await tx
            .update(aiOperations)
            .set(RELEASED_ADMISSION_CLEARED)
            .where(eq(aiOperations.id, descriptor.operationId))
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
          return { status: 'denied' as const, code: admissionDenial(admitted.code) }
        }
        const admissionNonce = nonce()
        await tx
          .update(aiOperations)
          .set({
            admissionNonce,
            requestBindingKeyId: requestBinding.keyId,
            requestBindingHmac: requestBinding.hmac,
            grantKid: input.signingKid,
            updatedAt: new Date(issuedAtEpochMillis),
          })
          .where(eq(aiOperations.id, descriptor.operationId))
        return {
          status: 'admitted' as const,
          nonce: admissionNonce,
          issuedAtEpochMillis,
          expiresAtEpochMillis: descriptor.callerDeadlineEpochMillis,
          replyTokenExpiresAtEpochMillis: adoptionWindowEnd,
          replyDraftExpiresAtEpochMillis: adoptionWindowEnd,
        }
      }),

    authorizeCanary: async () => ({
      status: 'denied' as const,
      code: 'canary_not_eligible' as const,
    }),

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
            admissionNonce: aiOperations.admissionNonce,
            requestBindingHmac: aiOperations.requestBindingHmac,
            grantKid: aiOperations.grantKid,
            providerId: aiOperations.providerId,
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
          operation.executionAttempt !== permit.attemptNumber ||
          operation.admissionNonce !== permit.nonce ||
          operation.grantKid !== permit.grantKid ||
          permit.grantKid !== input.signingKid ||
          operation.requestBindingHmac === null
        ) {
          return { status: 'denied' as const, code: 'permit_mismatch' as const }
        }
        const parsed = aiSettlementRequestSchema.safeParse({
          ...outcome,
          operationId: permit.operationId,
          permitId: permit.permitId,
          attemptNumber: permit.attemptNumber,
          nonce: permit.nonce,
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
        if (operation.budgetSettledAt === null) {
          await budget.settleAiOperation(tx, request.operationId, cost)
        } else if (operation.actualMicros !== cost) {
          return { status: 'denied' as const, code: 'settlement_conflict' as const }
        }
        const settledAtEpochMillis = now().getTime()
        return {
          status: 'settled' as const,
          version: 'ai-settlement-receipt-v1' as const,
          grantKid: operation.grantKid,
          operationId: request.operationId,
          permitId: request.permitId,
          attemptNumber: request.attemptNumber,
          nonce: request.nonce,
          requestBindingHmac: operation.requestBindingHmac,
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
