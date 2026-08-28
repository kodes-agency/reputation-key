import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleImportDiscoveryInvalidations,
  googleImportDiscoveryRecords,
} from '#/shared/db/schema/google-import-discovery.schema'
import type { ImportDiscoveryAuthorization } from '../application/ports/google-import-reference-store.port'
import type {
  DurableImportInvalidationScope,
  DurableImportReferenceAudience,
  DurableImportReferenceKeys,
} from './durable-import-reference-keys'

export type DurableImportRecord = Readonly<{
  referenceKey: string
  keyVersion: string
  audience: DurableImportReferenceAudience
  authorization: ImportDiscoveryAuthorization
  payload: Readonly<Record<string, unknown>>
  affectedPropertyId: string | null
  remainingRedemptions: number | null
  claimRequestId: string | null
  claimedAt: Date | null
  issuedAt: Date
  expiresAt: Date
}>

export class DurableImportReferenceCollision extends Error {}
export class DurableImportReferenceInvalidated extends Error {}

export const durableImportRowToRecord = (
  row: typeof googleImportDiscoveryRecords.$inferSelect,
): DurableImportRecord => ({
  referenceKey: row.referenceKey,
  keyVersion: row.keyVersion,
  audience: row.audience as DurableImportReferenceAudience,
  authorization: {
    organizationId: row.organizationId,
    userId: row.userId,
    connectionId: row.connectionId,
    connectionLifecycleVersion: row.connectionLifecycleVersion,
    connectionAccessVersion: row.connectionAccessVersion,
    credentialGeneration: row.credentialGeneration,
    approvalBindingId: row.approvalBindingId,
    authorizationVector: row.authorizationVector,
  },
  payload: row.payload,
  affectedPropertyId: row.affectedPropertyId,
  remainingRedemptions: row.remainingRedemptions,
  claimRequestId: row.claimRequestId,
  claimedAt: row.claimedAt,
  issuedAt: row.issuedAt,
  expiresAt: row.expiresAt,
})

const insertValue = (record: DurableImportRecord) => ({
  referenceKey: record.referenceKey,
  keyVersion: record.keyVersion,
  audience: record.audience,
  organizationId: record.authorization.organizationId,
  userId: record.authorization.userId,
  connectionId: record.authorization.connectionId,
  connectionLifecycleVersion: record.authorization.connectionLifecycleVersion,
  connectionAccessVersion: record.authorization.connectionAccessVersion,
  credentialGeneration: record.authorization.credentialGeneration,
  approvalBindingId: record.authorization.approvalBindingId,
  authorizationVector: record.authorization.authorizationVector,
  payload: record.payload,
  affectedPropertyId: record.affectedPropertyId,
  remainingRedemptions: record.remainingRedemptions,
  claimRequestId: record.claimRequestId,
  claimedAt: record.claimedAt,
  issuedAt: record.issuedAt,
  expiresAt: record.expiresAt,
  createdAt: record.issuedAt,
  updatedAt: record.issuedAt,
})

const lockScopes = async (
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  scopes: readonly DurableImportInvalidationScope[],
): Promise<void> => {
  // Scope values use NUL separators for unambiguous HMAC derivation. PostgreSQL
  // text parameters cannot carry NUL bytes, so serialize the lock namespace.
  const lockNames = [
    ...new Set(scopes.map((item) => JSON.stringify([item.kind, item.value]))),
  ].sort()
  for (const lockName of lockNames) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`)
  }
}

export const insertDurableImportRecords = async (
  db: Database,
  keys: DurableImportReferenceKeys,
  records: readonly DurableImportRecord[],
  scopes: readonly DurableImportInvalidationScope[],
  now: Date,
): Promise<void> => {
  await db.transaction(async (tx) => {
    await lockScopes(tx, scopes)
    const invalidationKeys = scopes.flatMap((item) => keys.invalidationKeys(item))
    if (invalidationKeys.length > 0) {
      const digests = invalidationKeys.map((item) => item.key)
      await tx
        .delete(googleImportDiscoveryInvalidations)
        .where(
          and(
            inArray(googleImportDiscoveryInvalidations.invalidationKey, digests),
            lte(googleImportDiscoveryInvalidations.expiresAt, now),
          ),
        )
      const active = await tx
        .select({ key: googleImportDiscoveryInvalidations.invalidationKey })
        .from(googleImportDiscoveryInvalidations)
        .where(
          and(
            inArray(googleImportDiscoveryInvalidations.invalidationKey, digests),
            gt(googleImportDiscoveryInvalidations.expiresAt, now),
          ),
        )
        .limit(1)
      if (active.length > 0) throw new DurableImportReferenceInvalidated()
    }
    // A terminal provider page can legitimately contain no selectable rows
    // and no continuation cursor. It still passes through the invalidation
    // fence above, but there is no opaque reference to persist.
    if (records.length === 0) return
    const inserted = await tx
      .insert(googleImportDiscoveryRecords)
      .values(records.map(insertValue))
      .onConflictDoNothing()
      .returning({ key: googleImportDiscoveryRecords.referenceKey })
    if (inserted.length !== records.length) throw new DurableImportReferenceCollision()
  })
}

export const loadDurableImportRecord = async (
  db: Database,
  referenceKey: string,
  audience: DurableImportReferenceAudience,
  now: Date,
): Promise<
  | Readonly<{ status: 'found'; record: DurableImportRecord }>
  | Readonly<{ status: 'missing' | 'expired' }>
> => {
  const [row] = await db
    .select()
    .from(googleImportDiscoveryRecords)
    .where(
      and(
        eq(googleImportDiscoveryRecords.referenceKey, referenceKey),
        eq(googleImportDiscoveryRecords.audience, audience),
      ),
    )
    .limit(1)
  if (!row) return { status: 'missing' }
  if (row.expiresAt <= now) {
    await db
      .delete(googleImportDiscoveryRecords)
      .where(eq(googleImportDiscoveryRecords.referenceKey, referenceKey))
    return { status: 'expired' }
  }
  return { status: 'found', record: durableImportRowToRecord(row) }
}

export const durableImportReferenceExists = async (
  db: Database,
  referenceKeys: readonly string[],
): Promise<boolean> => {
  if (referenceKeys.length === 0) return false
  const [row] = await db
    .select({ key: googleImportDiscoveryRecords.referenceKey })
    .from(googleImportDiscoveryRecords)
    .where(inArray(googleImportDiscoveryRecords.referenceKey, referenceKeys))
    .limit(1)
  return Boolean(row)
}

export const acquireDurableImportScopeLocks = lockScopes
