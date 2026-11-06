import {
  googleProviderFailure,
  type GoogleProviderFailure,
} from '#/shared/domain/google-provider-failure'

const GOOGLE_CALL_ERROR_CODES = [
  'auth_failed',
  'rate_limited',
  'permission_denied',
  'upstream_error',
  'parse_error',
  'unclassified',
] as const

export type GoogleCallErrorCode = (typeof GOOGLE_CALL_ERROR_CODES)[number]

/** Provider facts only; product retry and presentation decisions belong to callers. */
export type GoogleCallError = GoogleProviderFailure &
  Readonly<{
    code: GoogleCallErrorCode
    executionCode: string | null
    retryAfterMs: number | null
  }>

export function googleCallErrorCodeForStatus(
  status: number,
): Exclude<GoogleCallErrorCode, 'unclassified'> {
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'permission_denied'
  if (status === 429) return 'rate_limited'
  return 'upstream_error'
}

export function googleCallErrorCodeForExecution(
  failure: Readonly<{ code: string; admissionCode?: string }>,
): Exclude<GoogleCallErrorCode, 'unclassified'> {
  if (failure.code === 'admission_denied') {
    switch (failure.admissionCode) {
      case 'quota_exhausted':
      case 'in_flight_exhausted':
        return 'rate_limited'
      case 'authorization_changed':
      case 'authorization_denied':
        return 'permission_denied'
      default:
        return 'upstream_error'
    }
  }
  if (failure.code === 'response_too_large' || failure.code === 'malformed_request') {
    return 'parse_error'
  }
  return 'upstream_error'
}

function field(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined
}

function callCode(value: unknown): GoogleCallErrorCode | null {
  return GOOGLE_CALL_ERROR_CODES.find((code) => code === value) ?? null
}

function executionCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : null
}

/**
 * Normalize both the provider record and the reachable GBP error interface.
 * Missing evidence stays unknown; neither an error message nor provider bytes
 * may become diagnostics or proof that a write was never sent.
 */
export function googleCallError(error: unknown): GoogleCallError {
  const retryAfterMs = field(error, 'retryAfterMs')
  return Object.freeze({
    ...googleProviderFailure(error),
    code:
      callCode(field(error, 'code')) ?? callCode(field(error, 'kind')) ?? 'unclassified',
    executionCode:
      executionCode(field(error, 'executionAdmissionCode')) ??
      executionCode(field(error, 'executionCode')),
    retryAfterMs:
      typeof retryAfterMs === 'number' &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs >= 0
        ? retryAfterMs
        : null,
  })
}
