import { createErrorFactory } from '#/shared/domain/errors'

export type AiErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'source_too_large'
  | 'invalid_request'
  | 'text_unavailable'
  | 'language_not_supported'
  | 'idempotency_conflict'
  | 'operation_in_progress'
  | 'operation_ambiguous'
  | 'completed_without_delivery'
  | 'merchant_opt_in_required'
  | 'capability_not_opted_in'
  | 'execution_suspended'
  | 'source_expired'
  | 'source_epoch_changed'
  | 'source_revision_changed'
  | 'analysis_sequence_changed'
  | 'reply_state_changed'
  | 'draft_invalidated'
  | 'property_profile_changed'
  | 'routing_policy_changed'
  | 'provider_profile_changed'
  | 'capability_epoch_changed'
  | 'redaction_blocked'
  | 'quota_exhausted'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_refused'
  | 'output_invalid'
  | 'output_truncated'
  | 'policy_unavailable'

export type AiError = Readonly<{
  _tag: 'AiError'
  code: AiErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const aiError = createErrorFactory<AiError['_tag'], AiError['code']>('AiError')

export const isAiError = (value: unknown): value is AiError =>
  typeof value === 'object' &&
  value !== null &&
  (value as Readonly<{ _tag?: unknown }>)._tag === 'AiError'
