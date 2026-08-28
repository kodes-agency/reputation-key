import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleImportDiscoveryInvalidations,
  googleImportDiscoveryRecords,
} from '#/shared/db/schema/google-import-discovery.schema'
import type { GoogleImportReferenceStore } from '../application/ports/google-import-reference-store.port'
import {
  invalidationScopeFor,
  type DurableImportInvalidationScope,
  type DurableImportReferenceKeys,
} from './durable-import-reference-keys'
import { acquireDurableImportScopeLocks } from './durable-import-reference-persistence'

const INVALIDATION_FENCE_MS = 30_000

type InvalidationMethod =
  | 'invalidateOrganization'
  | 'invalidateUser'
  | 'invalidateConnection'
  | 'invalidateProperty'

type InvalidationInput =
  | Readonly<{ kind: 'organization'; organizationId: string }>
  | Readonly<{ kind: 'user'; organizationId: string; userId: string }>
  | Readonly<{ kind: 'connection'; organizationId: string; connectionId: string }>
  | Readonly<{ kind: 'property'; organizationId: string; propertyId: string }>

const scopeFor = (input: InvalidationInput): DurableImportInvalidationScope => {
  if (input.kind === 'organization') {
    return invalidationScopeFor('organization', [input.organizationId])
  }
  if (input.kind === 'user') {
    return invalidationScopeFor('user', [input.organizationId, input.userId])
  }
  if (input.kind === 'connection') {
    return invalidationScopeFor('connection', [input.organizationId, input.connectionId])
  }
  return invalidationScopeFor('property', [input.organizationId, input.propertyId])
}

const deleteScope = async (
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: InvalidationInput,
): Promise<void> => {
  const organization = eq(
    googleImportDiscoveryRecords.organizationId,
    input.organizationId,
  )
  if (input.kind === 'organization') {
    await tx.delete(googleImportDiscoveryRecords).where(organization)
  } else if (input.kind === 'user') {
    await tx
      .delete(googleImportDiscoveryRecords)
      .where(and(organization, eq(googleImportDiscoveryRecords.userId, input.userId)))
  } else if (input.kind === 'connection') {
    await tx
      .delete(googleImportDiscoveryRecords)
      .where(
        and(
          organization,
          eq(googleImportDiscoveryRecords.connectionId, input.connectionId),
        ),
      )
  } else {
    await tx
      .delete(googleImportDiscoveryRecords)
      .where(
        and(
          organization,
          eq(googleImportDiscoveryRecords.affectedPropertyId, input.propertyId),
        ),
      )
  }
}

export const createDurableImportReferenceInvalidation = (
  deps: Readonly<{
    db: Database
    keys: DurableImportReferenceKeys
    clock: () => Date
  }>,
): Pick<GoogleImportReferenceStore, InvalidationMethod> => {
  const invalidate = async (input: InvalidationInput): Promise<boolean> => {
    const target = scopeFor(input)
    const now = deps.clock()
    const expiresAt = new Date(now.getTime() + INVALIDATION_FENCE_MS)
    try {
      await deps.db.transaction(async (tx) => {
        await acquireDurableImportScopeLocks(tx, [target])
        const fences = deps.keys.invalidationKeys(target)
        if (fences.length === 0) throw new Error('invalidation key unavailable')
        await tx
          .insert(googleImportDiscoveryInvalidations)
          .values(
            fences.map((fence) => ({
              invalidationKey: fence.key,
              keyVersion: fence.keyVersion,
              scopeKind: fence.scopeKind,
              invalidatedAt: now,
              expiresAt,
            })),
          )
          .onConflictDoUpdate({
            target: googleImportDiscoveryInvalidations.invalidationKey,
            set: { invalidatedAt: now, expiresAt },
          })
        await deleteScope(tx, input)
      })
      return true
    } catch {
      return false
    }
  }

  return Object.freeze({
    invalidateOrganization: (input) =>
      invalidate({ kind: 'organization', organizationId: input.organizationId }),
    invalidateUser: (input) =>
      invalidate({
        kind: 'user',
        organizationId: input.organizationId,
        userId: input.userId,
      }),
    invalidateConnection: (input) =>
      invalidate({
        kind: 'connection',
        organizationId: input.organizationId,
        connectionId: input.connectionId,
      }),
    invalidateProperty: (input) =>
      invalidate({
        kind: 'property',
        organizationId: input.organizationId,
        propertyId: input.propertyId,
      }),
  })
}
