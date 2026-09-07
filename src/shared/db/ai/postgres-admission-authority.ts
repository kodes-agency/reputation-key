import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import { aiOperations } from '#/shared/db/schema'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import { settledCostMicros } from '#/shared/ai-openai-provider-profile'
import type { AiSettlementRequestV1 } from '#/shared/ai-internal-transport-contract'
import type {
  AiAdmissionDatabaseAuthority,
  AiAdmissionDenialCode,
  AiSettlementDenialCode,
} from '#/shared/ai-provider-control/admission-service'
import {
  createAiBudgetControl,
  reapStaleAiReservations,
  type AiAdmissionRateLimiter,
  type AiBudgetControl,
} from './ai-budget'

const KEY_ID = /^[a-z][a-z0-9_-]{0,31}$/

type PropertyDenial = Exclude<
  AiAdmissionDenialCode,
  'malformed_request' | 'request_binding_invalid' | 'canary_not_eligible'
>

type Dependencies = Readonly<{
  pool: Pool
  signingKid: string
  /** Ignored when `budgetControl` is supplied. */
  rateLimiter: AiAdmissionRateLimiter
  budgetControl?: AiBudgetControl
  now?: () => Date
  nonce?: () => string
}>

function profileForRoute(route: string) {
  return AI_OPERATION_PROFILES.find(
    (profile) => profile.sourceRoute === route && profile.capability !== null,
  )
}

function admissionDenial(
  code: 'kill_switch' | 'rate_limited' | 'budget_exhausted' | 'capability_unavailable',
): PropertyDenial {
  switch (code) {
    case 'kill_switch':
      return 'control_disabled'
    case 'rate_limited':
      return 'rate_limited'
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

export function createPostgresAiAdmissionAuthority(
  input: Dependencies,
): AiAdmissionDatabaseAuthority {
  if (!KEY_ID.test(input.signingKid)) {
    throw new Error('AI admission database signing key ID is invalid')
  }
  const db = drizzle(input.pool) as Database
  const now = input.now ?? (() => new Date())
  const budget =
    input.budgetControl ??
    createAiBudgetControl({ rateLimiter: input.rateLimiter, idGen: randomUUID, now })
  const nonce = input.nonce ?? (() => randomBytes(18).toString('base64url'))

  return Object.freeze({
    authorizeProperty: async (descriptor, requestBinding) =>
      db.transaction(async (tx) => {
        const profile = profileForRoute(descriptor.route)
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
            sourceDigest: aiOperations.sourceDigest,
            sourceByteCount: aiOperations.sourceByteCount,
            requestBindingKeyId: aiOperations.requestBindingKeyId,
            requestBindingHmac: aiOperations.requestBindingHmac,
            admissionNonce: aiOperations.admissionNonce,
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
          operation.sourceByteCount !== descriptor.sourceByteCount
        ) {
          return { status: 'denied' as const, code: 'subject_mismatch' as const }
        }
        const issuedAtEpochMillis = now().getTime()
        if (descriptor.callerDeadlineEpochMillis <= issuedAtEpochMillis) {
          return { status: 'denied' as const, code: 'permit_expired' as const }
        }
        if (operation.admissionNonce !== null) {
          if (
            operation.requestBindingKeyId !== requestBinding.keyId ||
            operation.requestBindingHmac !== requestBinding.hmac
          ) {
            return { status: 'denied' as const, code: 'already_consumed' as const }
          }
          return {
            status: 'admitted' as const,
            nonce: operation.admissionNonce,
            issuedAtEpochMillis,
            expiresAtEpochMillis: descriptor.callerDeadlineEpochMillis,
            replyTokenExpiresAtEpochMillis:
              descriptor.route === 'reply-suggestion'
                ? descriptor.callerDeadlineEpochMillis
                : null,
            replyDraftExpiresAtEpochMillis:
              descriptor.route === 'reply-suggestion'
                ? descriptor.callerDeadlineEpochMillis
                : null,
          }
        }

        const admitted = await budget.admitAiOperation(tx, {
          organizationId: descriptor.organizationId,
          propertyId: descriptor.propertyId,
          operationKey: descriptor.operationId,
          routeKey: descriptor.route,
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
          replyTokenExpiresAtEpochMillis:
            descriptor.route === 'reply-suggestion'
              ? descriptor.callerDeadlineEpochMillis
              : null,
          replyDraftExpiresAtEpochMillis:
            descriptor.route === 'reply-suggestion'
              ? descriptor.callerDeadlineEpochMillis
              : null,
        }
      }),

    authorizeCanary: async () => ({
      status: 'denied' as const,
      code: 'canary_not_eligible' as const,
    }),

    settle: async (request, receiptKid) => {
      if (receiptKid !== input.signingKid) {
        throw new Error('AI settlement receipt key ID does not match authority')
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
            reservedMicros: aiOperations.reservedMicros,
            actualMicros: aiOperations.actualMicros,
            budgetSettledAt: aiOperations.budgetSettledAt,
          })
          .from(aiOperations)
          .where(eq(aiOperations.id, request.operationId))
          .limit(1)
          .for('update')
        if (!operation) {
          return {
            status: 'denied' as const,
            code: 'permit_unknown' as AiSettlementDenialCode,
          }
        }
        if (
          operation.executionPermitId !== request.permitId ||
          operation.executionAttempt !== request.attemptNumber ||
          operation.admissionNonce !== request.nonce ||
          operation.grantKid !== receiptKid ||
          operation.requestBindingHmac === null
        ) {
          return { status: 'denied' as const, code: 'permit_mismatch' as const }
        }
        const cost =
          request.disposition === 'no_dispatch' ? 0 : Number(settledCostMicros(request))
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
          grantKid: receiptKid,
          requestBindingHmac: operation.requestBindingHmac,
          disposition: request.disposition,
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

    reapExpired: async (limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('AI admission reap limit is invalid')
      }
      return db.transaction(reapStaleAiReservations)
    },

    readiness: async () => {
      const result = await input.pool.query<{ ready: boolean }>(
        'SELECT NOT pg_is_in_recovery() AS ready',
      )
      return result.rows[0]?.ready === true
    },
  })
}
