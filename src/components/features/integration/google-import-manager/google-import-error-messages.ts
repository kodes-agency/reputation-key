/**
 * Read the server function's classified code.
 *
 * `instanceof Error` used to guard this, which silently dropped the code on
 * every client-side navigation: an SSR loader sees the `ServerFunctionError`
 * instance, but a client navigation sees the seroval-deserialized *plain
 * object* (the pattern documented in `#/shared/auth/capability-denial.ts`).
 * So every classified discovery failure fell through to the generic
 * "could not load this content" sentence - the operator was told the least
 * informative thing available, with no action, while the server had already
 * decided exactly what went wrong.
 *
 * The message fallback also has to match what the server actually sends:
 * `GoogleImportDiscoveryError` renders as `Google import discovery failed:
 * <code>`, which the old `code|reason` regex could never match.
 */
function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && code.length > 0) return code
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return null
  return (
    message.match(/(?:code|reason)["':\s]+([a-z_]+)/iu)?.[1] ??
    message.match(/failed:\s*([a-z_]+)/iu)?.[1] ??
    null
  )
}

/**
 * Codes a fresh discovery clears. The operator cannot fix an expired handle by
 * waiting or by retrying the same page, so the surface has to offer the restart
 * instead of describing the failure and stopping.
 */
export function discoveryErrorIsRecoverable(error: unknown): boolean {
  const code = errorCode(error)
  return (
    code === 'reference_invalid' ||
    code === 'temporarily_unavailable' ||
    code === 'provider_unavailable'
  )
}

export function connectionCallbackErrorMessage(
  error: 'connection_failed' | 'denied' | 'account_already_connected' | undefined,
): string | null {
  if (error === 'account_already_connected') {
    return 'That Google account is already connected. Select it above instead of authorizing again.'
  }
  if (error === 'denied') return 'Google authorization was cancelled.'
  return error ? 'Google Account connection failed. Try connecting again.' : null
}

export function discoveryErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case 'reference_invalid':
      return 'This discovery page expired. Start again to fetch current locations.'
    case 'unauthorized':
      return 'Your access changed. Refresh the page or ask an administrator for access.'
    case 'reauthentication_required':
      return 'Google no longer accepts this connection. Reconnect Google to continue.'
    case 'provider_rejected':
      return 'Google rejected the request for this account. Check that it still has access to these locations.'
    case 'provider_unavailable':
    case 'temporarily_unavailable':
      return 'Google Business Profile is temporarily unavailable. Try again shortly.'
    default:
      return 'The Google import service could not load this content.'
  }
}

export function startErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case 'request_conflict':
      return 'This request ID was already used for different properties. Start again.'
    case 'invalid_reference':
      return 'One or more selected locations expired. Return to locations and rediscover them.'
    case 'unauthorized':
      return 'Your import permission changed before the request could be committed.'
    case 'contract_rejected':
      return 'The import could not start because of an internal validation error. Contact support; this request cannot be retried.'
    default:
      return 'The import request could not be confirmed. Recover it before trying again.'
  }
}
