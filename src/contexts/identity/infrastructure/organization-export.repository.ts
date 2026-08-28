import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { auditLogs } from '#/shared/db/schema/audit'
import {
  organizationExportRetrievalIssuances,
  organizationExports,
} from '#/shared/db/schema/organization-lifecycle.schema'
import type { Tx } from '#/shared/outbox/commit'
import type {
  OrganizationExportRepository,
  OrganizationExportStatus,
} from '../application/ports/organization-export.port'

type ExportRow = typeof organizationExports.$inferSelect

async function requireCurrentAccountAdmin(
  tx: Tx,
  input: Readonly<{ organizationId: string; actorUserId: string }>,
): Promise<void> {
  // The authorization check and export control-plane mutation share one
  // transaction and lock the concrete membership/binding authorities. A
  // service-layer check remains useful for early denial, but cannot by itself
  // close the revocation race.
  const rows = await tx.execute(sql`
    SELECT m.role
    FROM member AS m
    INNER JOIN user_organization_bindings AS binding
      ON binding.user_id = m."userId"
     AND binding.organization_id = m."organizationId"
     AND binding.state = 'active'
    WHERE m."organizationId" = ${input.organizationId}
      AND m."userId" = ${input.actorUserId}
    FOR UPDATE OF m, binding
  `)
  const row = rows.rows[0] as { role: string } | undefined
  if (!row || row.role !== 'owner') {
    throw new Error('A current AccountAdmin is required for Organization Export')
  }
}

function status(row: ExportRow): OrganizationExportStatus {
  return {
    id: row.id,
    organizationId: row.organizationId,
    requestedBy: row.requestedBy,
    state: row.state as OrganizationExportStatus['state'],
    revision: row.revision,
    asOf: row.asOf,
    objectExpiresAt: row.objectExpiresAt,
    generationLeaseExpiresAt: row.generationLeaseExpiresAt,
    coverageSha256: row.coverageSha256,
    manifestSha256: row.manifestSha256,
    archiveSha256: row.archiveSha256,
    objectKey: row.objectKey,
    encryptionEvidenceRef: row.encryptionEvidenceRef,
    retrievalOperationId: row.retrievalOperationId,
    retrievalTokenDigest: row.retrievalTokenDigest,
    retrievalExpiresAt: row.retrievalExpiresAt,
    retrievedAt: row.retrievedAt,
    deletedAt: row.deletedAt,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function readForUpdate(tx: Tx, id: string): Promise<ExportRow> {
  const rows = await tx
    .select()
    .from(organizationExports)
    .where(eq(organizationExports.id, id))
    .limit(1)
    .for('update')
  if (!rows[0]) throw new Error('Organization Export request was not found')
  return rows[0]
}

function requireScope(row: ExportRow, organizationId: string): void {
  if (row.organizationId !== organizationId) {
    throw new Error('Organization Export request was not found')
  }
}

function requireRevision(
  row: ExportRow,
  expectedRevision: number,
  expectedState: OrganizationExportStatus['state'],
): void {
  if (row.revision !== expectedRevision || row.state !== expectedState) {
    throw new Error('Organization Export authority changed')
  }
}

/** Canonical Identity infrastructure factory. */
export const createOrganizationExportRepository = (
  db: Database,
): OrganizationExportRepository => ({
  async request(input: {
    id: string
    organizationId: string
    requestedBy: string
    asOf: Date
    objectExpiresAt: Date
  }): Promise<OrganizationExportStatus> {
    return db.transaction(async (tx) => {
      await requireCurrentAccountAdmin(tx, {
        organizationId: input.organizationId,
        actorUserId: input.requestedBy,
      })
      const inserted = await tx
        .insert(organizationExports)
        .values({
          id: input.id,
          organizationId: input.organizationId,
          requestedBy: input.requestedBy,
          state: 'requested',
          revision: 1,
          formatVersion: 'organization-export/v1',
          asOf: input.asOf,
          objectExpiresAt: input.objectExpiresAt,
          createdAt: input.asOf,
          updatedAt: input.asOf,
        })
        .onConflictDoNothing()
        .returning({ id: organizationExports.id })
      const row = await readForUpdate(tx, input.id)
      if (
        row.organizationId !== input.organizationId ||
        row.requestedBy !== input.requestedBy
      ) {
        throw new Error('Organization Export request id is already bound')
      }
      if (inserted.length > 0) {
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          userId: input.requestedBy,
          action: 'privacy_request.received',
          resourceType: 'privacy_request',
          resourceId: input.id,
          details: { kind: 'organization_export', formatVersion: row.formatVersion },
          createdAt: input.asOf,
          updatedAt: input.asOf,
        })
      }
      return status(row)
    })
  },

  async claimNextGeneration(input: {
    now: Date
    leaseExpiresAt: Date
  }): Promise<OrganizationExportStatus | null> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(organizationExports)
        .where(
          or(
            eq(organizationExports.state, 'requested'),
            and(
              eq(organizationExports.state, 'generating'),
              lte(organizationExports.generationLeaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(asc(organizationExports.createdAt), asc(organizationExports.id))
        .limit(1)
        .for('update', { skipLocked: true })
      const row = rows[0]
      if (!row) return null
      const updated = await tx
        .update(organizationExports)
        .set({
          state: 'generating',
          revision: row.revision + 1,
          generationLeaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.now,
        })
        .where(eq(organizationExports.id, row.id))
        .returning()
      return status(updated[0]!)
    })
  },

  async completeGeneration(input: {
    id: string
    expectedRevision: number
    coverageSha256: string
    manifestSha256: string
    archiveSha256: string
    objectKey: string
    encryptionEvidenceRef: string
    now: Date
  }): Promise<OrganizationExportStatus> {
    return db.transaction(async (tx) => {
      const row = await readForUpdate(tx, input.id)
      requireRevision(row, input.expectedRevision, 'generating')
      const updated = await tx
        .update(organizationExports)
        .set({
          state: 'ready',
          revision: row.revision + 1,
          generationLeaseExpiresAt: null,
          coverageSha256: input.coverageSha256,
          manifestSha256: input.manifestSha256,
          archiveSha256: input.archiveSha256,
          objectKey: input.objectKey,
          encryptionEvidenceRef: input.encryptionEvidenceRef,
          updatedAt: input.now,
        })
        .where(eq(organizationExports.id, input.id))
        .returning()
      await tx.insert(auditLogs).values({
        organizationId: row.organizationId,
        userId: row.requestedBy,
        action: 'sensitive_data.exported',
        resourceType: 'data_export',
        resourceId: row.id,
        details: { formatVersion: row.formatVersion },
        createdAt: input.now,
        updatedAt: input.now,
      })
      return status(updated[0]!)
    })
  },

  async failGeneration(input: {
    id: string
    expectedRevision: number
    errorCode: string
    now: Date
  }): Promise<void> {
    await db.transaction(async (tx) => {
      const row = await readForUpdate(tx, input.id)
      requireRevision(row, input.expectedRevision, 'generating')
      await tx
        .update(organizationExports)
        .set({
          state: 'failed',
          revision: row.revision + 1,
          generationLeaseExpiresAt: null,
          lastErrorCode: input.errorCode,
          updatedAt: input.now,
        })
        .where(eq(organizationExports.id, input.id))
    })
  },

  async issueRetrieval(input: {
    id: string
    organizationId: string
    actorUserId: string
    operationId: string
    tokenDigest: string
    expiresAt: Date
    now: Date
  }): Promise<OrganizationExportStatus> {
    return db.transaction(async (tx) => {
      await requireCurrentAccountAdmin(tx, input)
      const row = await readForUpdate(tx, input.id)
      requireScope(row, input.organizationId)
      if (
        row.state === 'retrieval_issued' &&
        row.retrievalOperationId === input.operationId &&
        row.retrievalTokenDigest === input.tokenDigest &&
        row.retrievalExpiresAt !== null &&
        input.now.getTime() < row.retrievalExpiresAt.getTime() &&
        input.now.getTime() < row.objectExpiresAt.getTime()
      ) {
        return status(row)
      }
      const replacesExpiredRetrieval =
        row.state === 'retrieval_issued' &&
        row.retrievalExpiresAt !== null &&
        input.now.getTime() >= row.retrievalExpiresAt.getTime()
      if (row.state !== 'ready' && !replacesExpiredRetrieval) {
        throw new Error('Organization Export retrieval authority changed')
      }
      if (
        replacesExpiredRetrieval &&
        (row.retrievalOperationId === input.operationId ||
          row.retrievalTokenDigest === input.tokenDigest)
      ) {
        throw new Error('Expired Organization Export retrieval must rotate authority')
      }
      const maxLinkExpiry = input.now.getTime() + 24 * 60 * 60 * 1000
      if (
        input.now.getTime() >= row.objectExpiresAt.getTime() ||
        input.expiresAt.getTime() <= input.now.getTime() ||
        input.expiresAt.getTime() > maxLinkExpiry ||
        input.expiresAt.getTime() > row.objectExpiresAt.getTime()
      ) {
        throw new Error('Organization Export retrieval expiry is invalid')
      }
      const usedAuthorities = await tx
        .select({ operationId: organizationExportRetrievalIssuances.operationId })
        .from(organizationExportRetrievalIssuances)
        .where(
          and(
            eq(organizationExportRetrievalIssuances.exportId, row.id),
            or(
              eq(organizationExportRetrievalIssuances.operationId, input.operationId),
              eq(organizationExportRetrievalIssuances.tokenDigest, input.tokenDigest),
            ),
          ),
        )
        .limit(1)
      if (usedAuthorities.length > 0) {
        throw new Error('Organization Export retrieval authority was already issued')
      }
      await tx.insert(organizationExportRetrievalIssuances).values({
        exportId: row.id,
        organizationId: row.organizationId,
        exportRevision: row.revision + 1,
        operationId: input.operationId,
        tokenDigest: input.tokenDigest,
        issuedAt: input.now,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      })
      const updated = await tx
        .update(organizationExports)
        .set({
          state: 'retrieval_issued',
          revision: row.revision + 1,
          retrievalOperationId: input.operationId,
          retrievalTokenDigest: input.tokenDigest,
          retrievalIssuedAt: input.now,
          retrievalExpiresAt: input.expiresAt,
          updatedAt: input.now,
        })
        .where(eq(organizationExports.id, input.id))
        .returning()
      return status(updated[0]!)
    })
  },

  async consumeRetrieval(input: {
    id: string
    organizationId: string
    actorUserId: string
    tokenDigest: string
    now: Date
  }): Promise<OrganizationExportStatus> {
    return db.transaction(async (tx) => {
      await requireCurrentAccountAdmin(tx, input)
      const row = await readForUpdate(tx, input.id)
      requireScope(row, input.organizationId)
      if (
        row.state !== 'retrieval_issued' ||
        row.retrievalTokenDigest !== input.tokenDigest ||
        !row.retrievalIssuedAt ||
        !row.retrievalExpiresAt ||
        input.now.getTime() < row.retrievalIssuedAt.getTime() ||
        input.now.getTime() >= row.retrievalExpiresAt.getTime() ||
        input.now.getTime() >= row.objectExpiresAt.getTime()
      ) {
        throw new Error('Organization Export retrieval is unavailable')
      }
      const updated = await tx
        .update(organizationExports)
        .set({
          state: 'retrieved',
          revision: row.revision + 1,
          retrievalTokenDigest: null,
          retrievalExpiresAt: null,
          retrievedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(organizationExports.id, input.id))
        .returning()
      await tx.insert(auditLogs).values({
        organizationId: row.organizationId,
        userId: input.actorUserId,
        action: 'sensitive_data.accessed',
        resourceType: 'data_export',
        resourceId: row.id,
        details: { formatVersion: row.formatVersion },
        createdAt: input.now,
        updatedAt: input.now,
      })
      return status(updated[0]!)
    })
  },

  async claimNextExpiredDeletion(input: {
    now: Date
  }): Promise<OrganizationExportStatus | null> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(organizationExports)
        .where(
          and(
            inArray(organizationExports.state, [
              'ready',
              'retrieval_issued',
              'retrieved',
            ]),
            lte(organizationExports.objectExpiresAt, input.now),
          ),
        )
        .orderBy(asc(organizationExports.objectExpiresAt), asc(organizationExports.id))
        .limit(1)
        .for('update', { skipLocked: true })
      const row = rows[0]
      if (!row) return null
      const updated = await tx
        .update(organizationExports)
        .set({
          state: 'delete_pending',
          revision: row.revision + 1,
          retrievalOperationId: null,
          retrievalTokenDigest: null,
          retrievalIssuedAt: null,
          retrievalExpiresAt: null,
          retrievedAt: null,
          updatedAt: input.now,
        })
        .where(eq(organizationExports.id, row.id))
        .returning()
      return status(updated[0]!)
    })
  },

  async completeDeletion(input: {
    id: string
    expectedRevision: number
    deletionEvidenceRef: string
    now: Date
  }): Promise<void> {
    await db.transaction(async (tx) => {
      const row = await readForUpdate(tx, input.id)
      if (
        row.state === 'deleted' &&
        row.revision === input.expectedRevision + 1 &&
        row.deletionEvidenceRef === input.deletionEvidenceRef
      ) {
        return
      }
      requireRevision(row, input.expectedRevision, 'delete_pending')
      await tx
        .update(organizationExports)
        .set({
          state: 'deleted',
          revision: row.revision + 1,
          deletionEvidenceRef: input.deletionEvidenceRef,
          deletedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(organizationExports.id, input.id))
    })
  },
})
