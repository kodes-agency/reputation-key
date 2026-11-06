import type { AuthContext } from '#/shared/domain/auth-context'
import {
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  googleAuthorizationPermissionDigest,
} from '#/shared/domain/google-content-authorization-vector'
import type { GoogleConnection } from '../domain/types'
import { sameRecordEntries } from '#/shared/domain/record-entries'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import type { ImportDiscoveryAuthorization } from './ports/google-import-reference-store.port'

export function sameAuthorizationVectorExceptCredentialGeneration(
  left: Readonly<Record<string, string | number | boolean | null>>,
  right: Readonly<Record<string, string | number | boolean | null>>,
): boolean {
  return sameRecordEntries(
    left,
    right,
    (key) => key === 'credentialGeneration' || left[key] === right[key],
  )
}

export const googleImportProviderAuthorization = (
  authorization: ImportDiscoveryAuthorization,
) =>
  Object.freeze({
    capability: 'property.import_gbp_v2' as const,
    organizationId: organizationId(authorization.organizationId),
    propertyId: null,
    connectionId: googleConnectionId(authorization.connectionId),
    initiatorUserId: authorization.userId,
    expectedCredentialGeneration: authorization.credentialGeneration,
    authorizationVector: authorization.authorizationVector,
  })

export function googleUserAuthorizationVector(
  actor: AuthContext,
  permissionVersion: number,
  executionPolicyVersion: string = GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
) {
  return {
    executionPolicyVersion,
    principalKind: 'user',
    role: actor.role,
    permissionVersion,
    permissionDigest: googleAuthorizationPermissionDigest(actor),
  } as const
}

export function googleSystemAuthorizationVector(
  systemPrincipal: string,
  permissionDigest: string,
) {
  return {
    executionPolicyVersion: GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
    principalKind: 'system',
    systemPrincipal,
    role: 'System',
    permissionVersion: null,
    permissionDigest,
  } as const
}

export function googleConnectionAuthorizationVector(
  connection: Pick<
    GoogleConnection,
    'lifecycleVersion' | 'accessVersion' | 'credentialGeneration'
  >,
) {
  return {
    connectionLifecycleVersion: connection.lifecycleVersion,
    connectionAccessVersion: connection.accessVersion,
    credentialGeneration: connection.credentialGeneration,
  }
}

export function googlePropertyAuthorizationVector(
  binding: Readonly<{
    sourceEpoch: number
    profileVersion: number
    state: string
    lifecycleState: string
    profileSource: string
    profileConfirmedAt: Date | string | null
  }>,
) {
  return {
    propertySourceEpoch: binding.sourceEpoch,
    propertyProfileVersion: binding.profileVersion,
    propertyBindingState: binding.state,
    propertyLifecycleState: binding.lifecycleState,
    propertyProfileSource: binding.profileSource,
    propertyTimezoneConfirmed: binding.profileConfirmedAt !== null,
  }
}
