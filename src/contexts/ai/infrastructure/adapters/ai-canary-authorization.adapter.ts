import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  AiCanaryAuthorizationPort,
  AiCanaryClaimV1,
} from '../../application/ports/ai-canary-authorization.port'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RELEASE_SHA = /^[0-9a-f]{40}$/
const OPERATOR_ID = /^[A-Za-z0-9][-A-Za-z0-9._@:/+]{0,254}$/

function asSafeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : null
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return null
  }
  const parsed = BigInt(value)
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null
}

function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

function parseClaim(row: Record<string, unknown>): AiCanaryClaimV1 {
  const operationId = asUuid(row.operation_id)
  const permitId = asUuid(row.permit_id)
  const authorizationId = asUuid(row.canary_authorization_id)
  const globalControlId = asUuid(row.global_control_id)
  const providerControlId = asUuid(row.provider_control_id)
  const reviewAnalysisControlId = asUuid(row.review_analysis_control_id)
  const replyDraftingControlId = asUuid(row.reply_drafting_control_id)
  const propertyTrendsControlId = asUuid(row.property_trends_control_id)
  const attemptNumber = asSafeInteger(row.attempt_number)
  const deadlineEpochMillis = asSafeInteger(row.deadline_epoch_millis)
  const authorizationGeneration = asSafeInteger(row.canary_authorization_generation)
  const globalGeneration = asSafeInteger(row.global_generation)
  const providerGeneration = asSafeInteger(row.provider_generation)
  const reviewAnalysisGeneration = asSafeInteger(row.review_analysis_generation)
  const replyDraftingGeneration = asSafeInteger(row.reply_drafting_generation)
  const propertyTrendsGeneration = asSafeInteger(row.property_trends_generation)
  if (
    operationId === null ||
    permitId === null ||
    authorizationId === null ||
    globalControlId === null ||
    providerControlId === null ||
    reviewAnalysisControlId === null ||
    replyDraftingControlId === null ||
    propertyTrendsControlId === null ||
    attemptNumber !== 1 ||
    deadlineEpochMillis === null ||
    deadlineEpochMillis < 1 ||
    authorizationGeneration === null ||
    authorizationGeneration < 1 ||
    authorizationGeneration > 3 ||
    globalGeneration === null ||
    globalGeneration < 1 ||
    providerGeneration === null ||
    providerGeneration < 1 ||
    reviewAnalysisGeneration === null ||
    reviewAnalysisGeneration < 1 ||
    replyDraftingGeneration === null ||
    replyDraftingGeneration < 1 ||
    propertyTrendsGeneration === null ||
    propertyTrendsGeneration < 1 ||
    typeof row.release_sha !== 'string' ||
    !RELEASE_SHA.test(row.release_sha) ||
    row.canary_profile_version !== 'synthetic-canary-v1' ||
    row.safety_identifier_profile_version !== 'synthetic-canary-safety-v1' ||
    row.provider_deployment_profile_version !== 'private-beta-global-v1' ||
    row.operation_profile_version !== 'synthetic-canary-v1'
  ) {
    throw new Error('AI canary issuance function returned an invalid claim')
  }

  const stopFence = Object.freeze({
    globalControlId,
    globalGeneration,
    providerControlId,
    providerGeneration,
    allCapabilityStopFences: Object.freeze([
      Object.freeze({
        capability: 'review_analysis' as const,
        capabilityControlId: reviewAnalysisControlId,
        capabilityGeneration: reviewAnalysisGeneration,
      }),
      Object.freeze({
        capability: 'reply_drafting' as const,
        capabilityControlId: replyDraftingControlId,
        capabilityGeneration: replyDraftingGeneration,
      }),
      Object.freeze({
        capability: 'property_trends' as const,
        capabilityControlId: propertyTrendsControlId,
        capabilityGeneration: propertyTrendsGeneration,
      }),
    ] as const),
  })
  return Object.freeze({
    operationId,
    permitId,
    attemptNumber: 1 as const,
    releaseSha: row.release_sha,
    deadlineEpochMillis,
    binding: Object.freeze({
      canaryAuthorizationId: authorizationId,
      canaryAuthorizationGeneration: authorizationGeneration,
      releaseSha: row.release_sha,
      canaryProfileVersion: 'synthetic-canary-v1',
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'synthetic-canary-v1',
      stopFence,
    }),
  })
}

export function createAiCanaryAuthorizationAdapter(
  db: Database,
): AiCanaryAuthorizationPort {
  return Object.freeze({
    async issue(input) {
      if (!OPERATOR_ID.test(input.operatorUserId)) {
        throw new Error('Invalid AI canary authorization request')
      }
      const result = await db.execute(sql`
        SELECT *
        FROM issue_ai_canary_authorization_v1(
          ${input.releaseSha},
          ${input.canaryProfileVersion},
          ${input.expected.headGeneration},
          ${JSON.stringify(input.expected.stopFence)}::jsonb,
          ${input.nonce},
          ${input.operatorUserId}
        )
      `)
      if (result.rows.length === 0) return Object.freeze({ status: 'denied' })
      if (result.rows.length !== 1) {
        throw new Error('AI canary issuance function returned multiple claims')
      }
      return Object.freeze({
        status: 'issued',
        claim: parseClaim(result.rows[0] as Record<string, unknown>),
      })
    },

    async revoke(input) {
      const result = await db.execute(sql`
        SELECT revoke_ai_canary_authorization_v1(
          ${input.authorizationId}::uuid,
          ${input.expectedHeadGeneration}
        ) AS revoked
      `)
      if (result.rows.length !== 1) {
        throw new Error('AI canary revoke function returned an invalid row count')
      }
      return Object.freeze({
        status: result.rows[0]?.revoked === true ? 'revoked' : 'denied',
      })
    },

    async reapExpired(input) {
      const result = await db.execute(sql`
        SELECT reap_expired_ai_canary_authorizations_v1(${input.limit}) AS reaped
      `)
      const reaped = asSafeInteger(result.rows[0]?.reaped)
      if (result.rows.length !== 1 || reaped === null || reaped < 0) {
        throw new Error('AI canary reaper function returned an invalid count')
      }
      return Object.freeze({ reaped })
    },
  })
}
