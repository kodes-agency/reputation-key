import type { AiErrorCode } from './errors'

/**
 * Failure codes an analysis operation can end with although nobody judged the
 * review: the admission authority, the provider, the budget or the worker was
 * unavailable, or the outcome of an attempt was lost. A review settled without
 * an analysis after one of these is reopened (ADR 0058, "Reopening an abandoned
 * analysis"): it gets a fresh analysis sequence and is queued again.
 *
 * Deliberately absent are the answers ABOUT the review, which every retry would
 * give again: the redactor refusing its text (`redaction_blocked`), an
 * unsupported language, a source that is too large or gone, and the provider
 * refusing it or returning output that does not validate. Those stay settled as
 * not analysable.
 */
export const AI_REVIEW_ANALYSIS_REOPEN_CODES = Object.freeze([
  'operation_ambiguous',
  'operation_abandoned',
  'completed_without_delivery',
  'provider_unavailable',
  'provider_rate_limited',
  'quota_exhausted',
  'policy_unavailable',
  'execution_suspended',
] as const satisfies readonly AiErrorCode[])

/**
 * How many times one review revision is reopened. Each reopen is a new
 * operation with its own provider-attempt budget, so a review whose analysis
 * keeps failing for reasons that look transient stops costing provider calls
 * after this many rounds and stays settled as not analysable.
 */
export const AI_REVIEW_ANALYSIS_MAX_REOPENS = 3
