import { gbpImportRequestItems } from '#/shared/db/schema/google-import-v2.schema'

/**
 * The ten columns that carry an item's frozen authorization and its source
 * expectations. Three reads select exactly these, so they are stated once.
 */
export const AUTHORIZATION_SNAPSHOT_COLUMNS = {
  expectedConnectionLifecycleVersion:
    gbpImportRequestItems.expectedConnectionLifecycleVersion,
  expectedConnectionAccessVersion: gbpImportRequestItems.expectedConnectionAccessVersion,
  expectedCredentialGeneration: gbpImportRequestItems.expectedCredentialGeneration,
  expectedExecutionPolicyVersion: gbpImportRequestItems.expectedExecutionPolicyVersion,
  expectedActorRole: gbpImportRequestItems.expectedActorRole,
  expectedPermissionDigest: gbpImportRequestItems.expectedPermissionDigest,
  expectedPrincipalKind: gbpImportRequestItems.expectedPrincipalKind,
  expectedPermissionVersion: gbpImportRequestItems.expectedPermissionVersion,
  expectedSourceEpoch: gbpImportRequestItems.expectedSourceEpoch,
  expectedProfileVersion: gbpImportRequestItems.expectedProfileVersion,
} as const

export function authorizationFromRow(row: {
  organizationId: string
  initiatedBy: string
  connectionId: string | null
  expectedConnectionLifecycleVersion: number | null
  expectedConnectionAccessVersion: number | null
  expectedCredentialGeneration: number | null
  expectedExecutionPolicyVersion: string | null
  expectedActorRole: string | null
  expectedPermissionDigest: string | null
  expectedPrincipalKind: string | null
  expectedPermissionVersion: number | null
}) {
  if (
    row.connectionId === null ||
    row.expectedConnectionLifecycleVersion === null ||
    row.expectedConnectionAccessVersion === null ||
    row.expectedCredentialGeneration === null ||
    row.expectedExecutionPolicyVersion === null ||
    row.expectedActorRole === null ||
    row.expectedPermissionDigest === null ||
    row.expectedPrincipalKind === null ||
    row.expectedPermissionVersion === null
  ) {
    return null
  }
  return {
    organizationId: row.organizationId,
    userId: row.initiatedBy,
    connectionId: row.connectionId,
    connectionLifecycleVersion: row.expectedConnectionLifecycleVersion,
    connectionAccessVersion: row.expectedConnectionAccessVersion,
    credentialGeneration: row.expectedCredentialGeneration,
    authorizationVector: {
      executionPolicyVersion: row.expectedExecutionPolicyVersion,
      role: row.expectedActorRole,
      permissionDigest: row.expectedPermissionDigest,
      principalKind: row.expectedPrincipalKind,
      permissionVersion: row.expectedPermissionVersion,
      connectionLifecycleVersion: row.expectedConnectionLifecycleVersion,
      connectionAccessVersion: row.expectedConnectionAccessVersion,
      credentialGeneration: row.expectedCredentialGeneration,
    },
  } as const
}
