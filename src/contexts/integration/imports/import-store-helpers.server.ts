import { and, eq, sql } from 'drizzle-orm'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { organizationId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { PROPERTY_IMPORT_RETENTION_RELEASED_EVENT } from '../application/google-import-v2-contract'
import type {
  GoogleImportV2Intent,
  GoogleImportV2TerminalAuthority,
} from '../application/ports/google-import-v2-store.port'
import type {
  IntegrationPropertyImportRequested,
  IntegrationPropertyImportRetentionReleased,
} from '../domain/events'

function pgErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error) return error.code
  if (!('cause' in error)) return undefined
  const cause = error.cause
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) {
    return undefined
  }
  return cause.code
}

export function isPgUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505'
}
export function importCommitContractError(message: string): Error & {
  readonly code: 'contract_rejected'
} {
  return Object.assign(new Error(message), { code: 'contract_rejected' as const })
}

export function assertLifecycleSweepLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('google import lifecycle sweep limit must be between 1 and 100')
  }
}

export function unclaimedTerminalAuthority(
  row: Readonly<{ dispatchEpoch: number; claimFence: string | null }>,
  expiredClaim: boolean,
): GoogleImportV2TerminalAuthority {
  return expiredClaim
    ? {
        kind: 'expired_claim',
        dispatchEpoch: row.dispatchEpoch,
        claimFence: row.claimFence!,
      }
    : { kind: 'pending', dispatchEpoch: row.dispatchEpoch }
}

export function requestedEvent(
  input: Readonly<{
    eventId: string
    organizationId: string
    importJobId: string
    now: Date
  }>,
): IntegrationPropertyImportRequested {
  return {
    _tag: 'integration.property_import.requested',
    eventId: input.eventId,
    organizationId: organizationId(input.organizationId),
    importJobId: input.importJobId,
    occurredAt: input.now,
    correlationId: null,
  }
}

export function retentionReleasedEvent(
  input: Readonly<{
    eventId: string
    organizationId: string
    importJobId: string
    itemIds: readonly string[]
    now: Date
  }>,
): IntegrationPropertyImportRetentionReleased {
  return {
    _tag: PROPERTY_IMPORT_RETENTION_RELEASED_EVENT,
    eventId: input.eventId,
    organizationId: organizationId(input.organizationId),
    importJobId: input.importJobId,
    idempotencyKeys: input.itemIds,
    occurredAt: input.now,
    correlationId: null,
  }
}

/** Every frozen authorization dimension is required before committing work. */
function frozenText(vector: FrozenVector, key: string): string {
  const value = vector[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw importCommitContractError(`Import authorization vector is missing ${key}`)
  }
  return value
}

function frozenCount(vector: FrozenVector, key: string): number {
  const value = vector[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw importCommitContractError(`Import authorization vector is missing ${key}`)
  }
  return value
}

type FrozenVector = Readonly<Record<string, string | number | boolean | null>>

export function authorizationColumns(item: GoogleImportV2Intent['items'][number]) {
  const vector: FrozenVector = item.authorization.authorizationVector
  return {
    expectedExecutionPolicyVersion: frozenText(vector, 'executionPolicyVersion'),
    expectedActorRole: frozenText(vector, 'role'),
    expectedPermissionDigest: frozenText(vector, 'permissionDigest'),
    expectedPrincipalKind: frozenText(vector, 'principalKind'),
    expectedPermissionVersion: frozenCount(vector, 'permissionVersion'),
  }
}

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

export const itemScope = (organizationId: string, itemId: string) =>
  and(
    eq(googleImportItems.organizationId, organizationId),
    eq(googleImportItems.id, itemId),
  )
export const parentScope = (organizationId: string, importId: string) =>
  and(eq(googleImports.organizationId, organizationId), eq(googleImports.id, importId))

/** All transitions take the root lock before the item lock, including deletion.
 * This also serializes the last two completions when fixing the retention clock. */
export async function lockItemParent(tx: Tx, organizationId: string, itemId: string) {
  const [item] = await tx
    .select({ importId: googleImportItems.importId })
    .from(googleImportItems)
    .where(itemScope(organizationId, itemId))
    .limit(1)
  if (!item) return null
  const [parent] = await tx
    .select()
    .from(googleImports)
    .where(parentScope(organizationId, item.importId))
    .for('update')
    .limit(1)
  return parent ?? null
}

export async function touchParent(
  tx: Tx,
  organizationId: string,
  importId: string,
  now: Date,
) {
  await tx
    .update(googleImports)
    .set({ updatedAt: now })
    .where(parentScope(organizationId, importId))
}

export async function markTerminalParent(
  tx: Tx,
  organizationId: string,
  importId: string,
  now: Date,
) {
  await tx
    .update(googleImports)
    .set({
      firstTerminalAt: sql`coalesce(${googleImports.firstTerminalAt}, ${now})`,
      purgeAt: sql`coalesce(${googleImports.purgeAt}, ${now.toISOString()}::timestamptz + interval '30 days')`,
      updatedAt: now,
    })
    .where(
      and(
        parentScope(organizationId, importId),
        sql`NOT EXISTS (
    SELECT 1 FROM ${googleImportItems} WHERE ${googleImportItems.organizationId} = ${organizationId}
      AND ${googleImportItems.importId} = ${importId} AND ${googleImportItems.status} IN ('pending', 'processing')
  )`,
      ),
    )
  await touchParent(tx, organizationId, importId, now)
}
