// Sweep failures expose counts and allowlisted causes, never messages or tenant
// identifiers. Prefer a domain error code, then SQLSTATE, then error class.

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
