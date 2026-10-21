import type { GoogleConnectionId } from '#/shared/domain/ids'
import type { ReviewPropertyGoogleReadBinding } from './ports/property-google-read-binding.port'

/** The Property facts a read from Google needs, as the Property context states them. */
export type PropertyGoogleReadScopeFacts = Readonly<{
  lifecycleState: string
  googleBindingState: string
  googleConnectionId: GoogleConnectionId | null
  sourceEpoch: number
}>

/**
 * Only an active Property with an active Google binding holds a connection to
 * read through. Anything else keeps its epoch (a caller can still see the
 * Property moved) but names no connection.
 */
export const readBindingFromPropertyScope = (
  scope: PropertyGoogleReadScopeFacts | null,
): ReviewPropertyGoogleReadBinding | null => {
  if (scope === null) return null
  const readable =
    scope.lifecycleState === 'active' && scope.googleBindingState === 'active'
  return {
    connectionId: readable ? scope.googleConnectionId : null,
    sourceEpoch: scope.sourceEpoch,
  }
}
