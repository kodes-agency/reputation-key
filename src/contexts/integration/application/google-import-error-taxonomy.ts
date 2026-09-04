type CodedError = Readonly<{ code: unknown }>
type CausedError = Readonly<{ cause: unknown }>
type MessagedError = Readonly<{ message: unknown }>

const MAX_ERROR_CHAIN_DEPTH = 4

/**
 * Read a driver/domain error code through the bounded wrapper chain Drizzle uses.
 */
export function googleImportErrorCode(error: unknown): string | null {
  let current = error
  for (let depth = 0; depth < MAX_ERROR_CHAIN_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null
    if ('code' in current) {
      const code = (current as CodedError).code
      if (typeof code === 'string') return code
    }
    if (!('cause' in current)) return null
    current = (current as CausedError).cause
  }
  return null
}

/**
 * Infrastructure saturation, not a domain outcome. These failures may succeed
 * unchanged after recovery/retry and therefore must not become permanent.
 */
const TRANSIENT_INFRASTRUCTURE_CODES: Readonly<Record<string, true>> = {
  '08000': true, // connection_exception
  '08003': true, // connection_does_not_exist
  '08006': true, // connection_failure
  '25P03': true, // idle_in_transaction_session_timeout
  '40001': true, // serialization_failure
  '40P01': true, // deadlock_detected
  '53300': true, // too_many_connections
  '53400': true, // configuration_limit_exceeded
  '55P03': true, // lock_not_available (lock_timeout)
  '57014': true, // query_canceled (statement_timeout)
  '57P01': true, // admin_shutdown
}

const TRANSIENT_INFRASTRUCTURE_MESSAGE_RE =
  /timeout exceeded when trying to connect|connection terminated|too many clients|connection is closed/i
const PERMANENT_DATABASE_REJECTION_RE = /^(?:22|23)[0-9A-Z]{3}$/

export function isTransientGoogleImportInfrastructureError(error: unknown): boolean {
  const code = googleImportErrorCode(error)
  if (code !== null && TRANSIENT_INFRASTRUCTURE_CODES[code] === true) return true

  let current = error
  for (let depth = 0; depth < MAX_ERROR_CHAIN_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    if ('message' in current) {
      const message = (current as MessagedError).message
      if (
        typeof message === 'string' &&
        TRANSIENT_INFRASTRUCTURE_MESSAGE_RE.test(message)
      ) {
        return true
      }
    }
    if (!('cause' in current)) return false
    current = (current as CausedError).cause
  }
  return false
}

export type GoogleImportCommitFailureClass =
  'contract_rejected' | 'temporarily_unavailable' | 'unclassified'

/**
 * Classify only failure kinds the production commit store can prove. Unknown
 * errors remain retryable for safety, but their caller must log them loudly.
 */
export function classifyGoogleImportCommitFailure(
  error: unknown,
): GoogleImportCommitFailureClass {
  const code = googleImportErrorCode(error)
  if (
    code === 'contract_rejected' ||
    code === 'invalid_payload' ||
    code === 'unregistered' ||
    (code !== '23505' && PERMANENT_DATABASE_REJECTION_RE.test(code ?? ''))
  ) {
    return 'contract_rejected'
  }
  if (isTransientGoogleImportInfrastructureError(error)) {
    return 'temporarily_unavailable'
  }
  return 'unclassified'
}
