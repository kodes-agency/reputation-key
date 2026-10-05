// What starting a Google authorization asks for, and what is said when it cannot start.
import type { GoogleAuthUrlInput } from '#/contexts/integration/application/public-api'

/** A new Organization-owned connection: the request every "Connect Google" makes. */
export const NEW_GOOGLE_CONNECTION_AUTHORIZATION = {
  visibility: 'organization',
  connectionMode: 'new',
  targetConnectionId: null,
} as const satisfies GoogleAuthUrlInput

/** The sentence for `actionFailureMessage`: whole, "Couldn't …." */
export function connectFailureMessage(request: GoogleAuthUrlInput): string {
  return request.connectionMode === 'reauth'
    ? "Couldn't reauthorize your Google account."
    : "Couldn't connect your Google account."
}
