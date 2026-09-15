import type {
  GoogleAuthUrlInput,
  GoogleConnectionStatus,
} from '#/contexts/integration/application/public-api'

type ConnectionAuthorizationState = Readonly<{
  id: string
  status: GoogleConnectionStatus
}>

type ReauthorizationRequest = Extract<GoogleAuthUrlInput, { connectionMode: 'reauth' }>

export const NEW_GOOGLE_CONNECTION_AUTHORIZATION = {
  visibility: 'organization',
  connectionMode: 'new',
  targetConnectionId: null,
} as const satisfies GoogleAuthUrlInput

/**
 * An active connection made before RepKey asked for the account's email can be
 * authorized once more, with the same Google account, so it shows which
 * account it is. Only an explicit merchant action starts that ceremony.
 */
export function accountEmailConsentForConnection(
  connection: ConnectionAuthorizationState & Readonly<{ accountEmail: string | null }>,
): ReauthorizationRequest | null {
  if (connection.status !== 'active' || connection.accountEmail !== null) return null
  return {
    visibility: 'organization',
    connectionMode: 'reauth',
    targetConnectionId: connection.id,
  }
}

/** Only the lifecycle state that explicitly requires fresh consent is actionable. */
export function reauthorizationForConnection(
  connection: ConnectionAuthorizationState,
): ReauthorizationRequest | null {
  if (connection.status !== 'reauth_required') return null

  return {
    visibility: 'organization',
    connectionMode: 'reauth',
    targetConnectionId: connection.id,
  }
}
