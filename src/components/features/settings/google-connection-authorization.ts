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
