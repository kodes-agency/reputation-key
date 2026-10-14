import { sameFrozenGoogleContentAuthorizationVector } from '#/shared/domain/google-content-authorization-vector'
import type { ImportDiscoveryAuthorization } from './ports/google-import-reference-store.port'

/**
 * Whether the authorization a discovery step finds now still covers the one its
 * earlier step recorded: the stored reference, or the pre-provider-call read.
 *
 * `credentialGeneration` is the secret-material counter, and a routine access
 * token refresh moves only it, about once an hour and from whichever job touches
 * the connection first. Requiring equality made an administrator restart
 * discovery for a refresh that took nothing from them. It may therefore only
 * advance (a rollback still denies) and is left out of the vector comparison.
 * Reconnect, disconnect and revocation move the lifecycle and access versions
 * and the vector's policy and role facts, which stay exact. This is the rule the
 * import authorizer (`sameExpectedConnection`) and the authorization leases
 * already apply.
 */
export function sameDiscoveryAuthorization(
  earlier: ImportDiscoveryAuthorization,
  current: ImportDiscoveryAuthorization,
): boolean {
  return (
    earlier.organizationId === current.organizationId &&
    earlier.userId === current.userId &&
    earlier.connectionId === current.connectionId &&
    earlier.connectionLifecycleVersion === current.connectionLifecycleVersion &&
    earlier.connectionAccessVersion === current.connectionAccessVersion &&
    current.credentialGeneration >= earlier.credentialGeneration &&
    sameFrozenGoogleContentAuthorizationVector(
      earlier.authorizationVector,
      current.authorizationVector,
    )
  )
}
