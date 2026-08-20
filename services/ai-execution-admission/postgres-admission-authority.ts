import type { Pool } from 'pg'
import {
  AI_PROVIDER_DEPLOYMENT_PROFILE_V1,
  settledCostMicros,
} from '../../src/shared/ai-openai-provider-profile'
import { AI_RUNTIME_CAPABILITIES_V1_DIGEST } from '../../src/shared/ai-runtime-capability-contract'
import {
  AI_PROVIDER_DISPOSITIONS,
  type AiSettlementRequestV1,
} from '../../src/shared/ai-internal-transport-contract'
import type {
  AiAdmissionDatabaseAuthority,
  AiAdmissionDenialCode,
  AiSettlementDenialCode,
} from './service'

type DatabaseAdmissionDenialCode = Exclude<
  AiAdmissionDenialCode,
  'malformed_request' | 'request_binding_invalid'
>
const ADMISSION_DENIAL_CODES = new Set<DatabaseAdmissionDenialCode>([
  'subject_mismatch',
  'source_mismatch',
  'authorization_changed',
  'control_disabled',
  'circuit_open',
  'rate_limited',
  'concurrency_exhausted',
  'quota_exhausted',
  'permit_unknown',
  'permit_expired',
  'already_consumed',
  'canary_not_eligible',
])
const SETTLEMENT_DENIAL_CODES = new Set<AiSettlementDenialCode>([
  'permit_unknown',
  'permit_mismatch',
  'permit_not_consumed',
  'settlement_conflict',
])
const KEY_ID = /^[a-z][a-z0-9_-]{0,31}$/
const HMAC = /^[A-Za-z0-9_-]{43}$/
const PROVIDER_DISPOSITIONS = new Set<string>(AI_PROVIDER_DISPOSITIONS)

type AdmissionRow = Readonly<{
  status: string
  code: string | null
  nonce: string | null
  issued_at_epoch_millis: string | number | null
  expires_at_epoch_millis: string | number | null
  reply_token_expires_at_epoch_millis: string | number | null
  reply_draft_expires_at_epoch_millis: string | number | null
}>

type SettlementRow = Readonly<{
  status: string
  code: string | null
  grant_kid: string | null
  request_binding_hmac: string | null
  disposition: string | null
  usage_known: boolean | null
  provider_retryable: boolean | null
  input_tokens: number | null
  cached_input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  cost_micros: string | number | null
  settled_at_epoch_millis: string | number | null
  settlement_state: string | null
}>

function safeInteger(value: string | number | null): number | null {
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseAdmissionRow(row: AdmissionRow | undefined) {
  if (!row) throw new Error('AI admission function returned no result')
  if (row.status === 'denied') {
    if (
      !row.code ||
      !ADMISSION_DENIAL_CODES.has(row.code as DatabaseAdmissionDenialCode)
    ) {
      throw new Error('AI admission function returned an invalid denial')
    }
    return {
      status: 'denied' as const,
      code: row.code as DatabaseAdmissionDenialCode,
    }
  }
  const issuedAtEpochMillis = safeInteger(row.issued_at_epoch_millis)
  const expiresAtEpochMillis = safeInteger(row.expires_at_epoch_millis)
  const replyTokenExpiresAtEpochMillis = safeInteger(
    row.reply_token_expires_at_epoch_millis,
  )
  const replyDraftExpiresAtEpochMillis = safeInteger(
    row.reply_draft_expires_at_epoch_millis,
  )
  if (
    row.status !== 'admitted' ||
    !row.nonce ||
    issuedAtEpochMillis === null ||
    expiresAtEpochMillis === null ||
    expiresAtEpochMillis <= issuedAtEpochMillis
  ) {
    throw new Error('AI admission function returned an invalid grant')
  }
  return {
    status: 'admitted' as const,
    nonce: row.nonce,
    issuedAtEpochMillis,
    expiresAtEpochMillis,
    replyTokenExpiresAtEpochMillis,
    replyDraftExpiresAtEpochMillis,
  }
}

function parseSettlementRow(
  row: SettlementRow | undefined,
  request: AiSettlementRequestV1,
) {
  if (!row) throw new Error('AI settlement function returned no result')
  const nullableFields = [
    row.grant_kid,
    row.request_binding_hmac,
    row.disposition,
    row.usage_known,
    row.provider_retryable,
    row.input_tokens,
    row.cached_input_tokens,
    row.output_tokens,
    row.reasoning_tokens,
    row.cost_micros,
    row.settled_at_epoch_millis,
    row.settlement_state,
  ]
  if (row.status === 'denied') {
    if (
      !row.code ||
      !SETTLEMENT_DENIAL_CODES.has(row.code as AiSettlementDenialCode) ||
      nullableFields.some((value) => value !== null)
    ) {
      throw new Error('AI settlement function returned an invalid denial')
    }
    return { status: 'denied' as const, code: row.code as AiSettlementDenialCode }
  }
  const inputTokens = safeInteger(row.input_tokens)
  const cachedInputTokens = safeInteger(row.cached_input_tokens)
  const outputTokens = safeInteger(row.output_tokens)
  const reasoningTokens = safeInteger(row.reasoning_tokens)
  const costMicros = safeInteger(row.cost_micros)
  const settledAtEpochMillis = safeInteger(row.settled_at_epoch_millis)
  const disposition = row.disposition
  const finalDispositionAccepted =
    disposition === request.disposition ||
    disposition === 'source_stale' ||
    disposition === 'policy_denied'
  const expectedState: 'settled' | 'released' | 'ambiguous' =
    disposition === 'no_dispatch'
      ? 'released'
      : disposition === 'transport_ambiguous'
        ? 'ambiguous'
        : 'settled'
  const expectedCost =
    request.disposition === 'no_dispatch'
      ? 0n
      : request.usageKnown
        ? settledCostMicros(request)
        : null
  if (
    row.status !== 'settled' ||
    row.code !== null ||
    typeof row.grant_kid !== 'string' ||
    !KEY_ID.test(row.grant_kid) ||
    typeof row.request_binding_hmac !== 'string' ||
    !HMAC.test(row.request_binding_hmac) ||
    typeof disposition !== 'string' ||
    !PROVIDER_DISPOSITIONS.has(disposition) ||
    !finalDispositionAccepted ||
    typeof row.usage_known !== 'boolean' ||
    typeof row.provider_retryable !== 'boolean' ||
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null ||
    reasoningTokens === null ||
    cachedInputTokens > inputTokens ||
    reasoningTokens > outputTokens ||
    row.usage_known !== request.usageKnown ||
    row.provider_retryable !==
      (disposition === request.disposition ? request.providerRetryable : false) ||
    inputTokens !== request.inputTokens ||
    cachedInputTokens !== request.cachedInputTokens ||
    outputTokens !== request.outputTokens ||
    reasoningTokens !== request.reasoningTokens ||
    costMicros === null ||
    (expectedCost !== null &&
      (expectedCost > BigInt(Number.MAX_SAFE_INTEGER) ||
        costMicros !== Number(expectedCost))) ||
    settledAtEpochMillis === null ||
    settledAtEpochMillis <= 0 ||
    row.settlement_state !== expectedState
  ) {
    throw new Error('AI settlement function returned an invalid receipt')
  }
  return {
    status: 'settled' as const,
    grantKid: row.grant_kid,
    requestBindingHmac: row.request_binding_hmac,
    disposition: disposition as AiSettlementRequestV1['disposition'],
    providerRetryable: row.provider_retryable,
    usageKnown: row.usage_known,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    costMicros,
    settledAtEpochMillis,
    settlementState: row.settlement_state,
  }
}

export function createPostgresAiAdmissionAuthority(
  input: Readonly<{
    pool: Pool
    signingKid: string
  }>,
): AiAdmissionDatabaseAuthority {
  if (!KEY_ID.test(input.signingKid)) {
    throw new Error('AI admission database signing key ID is invalid')
  }
  return Object.freeze({
    authorizeProperty: async (descriptor, requestBinding) => {
      const result = await input.pool.query<AdmissionRow>(
        'SELECT * FROM admit_ai_property_v1($1::jsonb, $2, $3, $4)',
        [
          JSON.stringify(descriptor),
          requestBinding.keyId,
          requestBinding.hmac,
          input.signingKid,
        ],
      )
      return parseAdmissionRow(result.rows[0])
    },
    authorizeCanary: async (descriptor, requestBinding) => {
      const result = await input.pool.query<AdmissionRow>(
        'SELECT * FROM admit_ai_canary_v1($1::jsonb, $2, $3, $4)',
        [
          JSON.stringify(descriptor),
          requestBinding.keyId,
          requestBinding.hmac,
          input.signingKid,
        ],
      )
      return parseAdmissionRow(result.rows[0])
    },
    settle: async (request, receiptKid) => {
      if (receiptKid !== input.signingKid) {
        throw new Error('AI settlement receipt key ID does not match authority')
      }
      const result = await input.pool.query<SettlementRow>(
        'SELECT * FROM settle_ai_execution_v1($1::jsonb, $2)',
        [JSON.stringify(request), receiptKid],
      )
      return parseSettlementRow(result.rows[0], request)
    },
    reapExpired: async (limit) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error('AI admission reap limit is invalid')
      }
      const result = await input.pool.query<{ reaped: number }>(
        'SELECT reap_expired_ai_execution_permits_v1($1)::integer AS reaped',
        [limit],
      )
      const reaped = result.rows[0]?.reaped
      if (
        !Number.isSafeInteger(reaped) ||
        (reaped ?? -1) < 0 ||
        (reaped ?? 1_001) > limit
      ) {
        throw new Error('AI admission reaper returned an invalid count')
      }
      return reaped as number
    },
    readiness: async () => {
      const result = await input.pool.query<{ ready: boolean }>(
        `
          SELECT
            NOT pg_is_in_recovery()
            AND COALESCE((
              SELECT connection.ssl
              FROM pg_catalog.pg_stat_ssl AS connection
              WHERE connection.pid = pg_catalog.pg_backend_pid()
            ), false)
            AND current_setting('lock_timeout') = '1s'
            AND current_setting('statement_timeout') = '3s'
            AND current_setting('idle_in_transaction_session_timeout') = '5s'
            AND (
              current_setting('max_connections')::integer
                - current_setting('superuser_reserved_connections')::integer
            ) >= 8
            AND count(DISTINCT procedure.proname) = 5
            AND bool_and(
              procedure.prosecdef
              AND has_function_privilege(current_user, procedure.oid, 'EXECUTE')
            )
            AND assert_ai_runtime_catalogue_ready_v1($1, $2, $3)
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class AS direct_table
              INNER JOIN pg_namespace AS direct_schema
                ON direct_schema.oid = direct_table.relnamespace
              WHERE direct_schema.nspname = 'public'
                AND direct_table.relkind IN ('r', 'p')
                AND (
                  has_table_privilege(current_user, direct_table.oid, 'SELECT')
                  OR has_table_privilege(current_user, direct_table.oid, 'INSERT')
                  OR has_table_privilege(current_user, direct_table.oid, 'UPDATE')
                  OR has_table_privilege(current_user, direct_table.oid, 'DELETE')
                  OR has_table_privilege(current_user, direct_table.oid, 'TRUNCATE')
                  OR has_table_privilege(current_user, direct_table.oid, 'REFERENCES')
                  OR has_table_privilege(current_user, direct_table.oid, 'TRIGGER')
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM pg_proc AS other_procedure
              WHERE other_procedure.pronamespace = 'public'::regnamespace
                AND other_procedure.proname NOT IN (
                  'admit_ai_property_v1',
                  'admit_ai_canary_v1',
                  'assert_ai_runtime_catalogue_ready_v1',
                  'settle_ai_execution_v1',
                  'reap_expired_ai_execution_permits_v1'
                )
                AND has_function_privilege(
                  current_user,
                  other_procedure.oid,
                  'EXECUTE'
                )
            ) AS ready
          FROM pg_proc AS procedure
          WHERE procedure.pronamespace = 'public'::regnamespace
            AND procedure.proname IN (
              'admit_ai_property_v1',
              'admit_ai_canary_v1',
              'assert_ai_runtime_catalogue_ready_v1',
              'settle_ai_execution_v1',
              'reap_expired_ai_execution_permits_v1'
            )
        `,
        [
          AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileVersion,
          AI_PROVIDER_DEPLOYMENT_PROFILE_V1.profileDigest,
          AI_RUNTIME_CAPABILITIES_V1_DIGEST,
        ],
      )
      return result.rows[0]?.ready === true
    },
  })
}
