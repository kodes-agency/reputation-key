// What a failed operation failed of, in words that name no tenant (BQC-7.3).
//
// The Goal sweeps count their failures by cause and fail the run with those
// counts. A cause is never a message or an identifier, because a message can
// carry a tenant's values: it is the SQLSTATE of a database refusal, else the
// class of the error. A caller names its own domain errors by their code first
// and leaves everything else to `unclassifiedFailureCause`.

const SQLSTATE = /^[0-9A-Z]{5}$/u

/** The SQLSTATE of a database refusal, through the query error that wraps it. */
export function sqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const { code, cause } = error as { code?: unknown; cause?: unknown }
  if (typeof code === 'string' && SQLSTATE.test(code)) return code
  return sqlStateOf(cause)
}

/** `sqlstate_<code>` for a database refusal, else the error's class, else `unknown`. */
export function unclassifiedFailureCause(error: unknown): string {
  const sqlState = sqlStateOf(error)
  if (sqlState !== null) return `sqlstate_${sqlState}`
  return error instanceof Error ? error.name : 'unknown'
}
