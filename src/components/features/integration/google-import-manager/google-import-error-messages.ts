function errorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  if ('code' in error && typeof error.code === 'string') return error.code
  return error.message.match(/(?:code|reason)["':\s]+([a-z_]+)/iu)?.[1] ?? null
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
    default:
      return 'The import request could not be confirmed. Recover it before trying again.'
  }
}
