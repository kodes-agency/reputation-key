import { and, asc, eq, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type {
  GoogleImportIntent,
  GoogleImportStore,
} from '../application/ports/google-import-store.port'
import {
  completeImportItem,
  type GoogleImportCompletionDeps,
} from './import-completion.server'
import {
  createImportClaims,
  AUTHORIZATION_SNAPSHOT_COLUMNS,
} from './import-claims.server'
import { createImportRetry } from './import-retry.server'
import { createImportLifecycleStore } from './import-lifecycle-store.server'
import { createImportRetention } from './import-retention.server'
import { createImportDueReservation } from './import-dispatch-store.server'
import { getImportProgress } from './import-progress-store.server'
import {
  assertLifecycleSweepLimit,
  authorizationColumns,
  authorizationFromRow,
  importCommitContractError,
  isPgUniqueViolation,
  requestedEvent,
} from './import-store-helpers.server'

/** The root, every checkpoint and the dispatch fact either all commit or none do. */
async function insertImport(
  db: Database,
  intent: GoogleImportIntent,
): Promise<'committed' | 'conflict'> {
  if (
    intent.items.length === 0 ||
    new Set(intent.items.map((item) => item.id)).size !== intent.items.length
  ) {
    throw importCommitContractError('invalid Google import selection')
  }
  try {
    await db.transaction(async (tx) => {
      await tx.insert(googleImports).values({
        id: intent.id,
        organizationId: intent.organizationId,
        requestId: intent.requestId,
        initiatedBy: intent.initiatedBy,
        totalCount: intent.items.length,
        wireReplayKeyVersion: intent.wireReplay.keyVersion,
        wireReplayDigest: intent.wireReplay.digest,
        semanticReplayKeyVersion: intent.semanticReplay.keyVersion,
        semanticReplayDigest: intent.semanticReplay.digest,
        createdAt: intent.now,
        updatedAt: intent.now,
      })
      // Bound each SQL statement without introducing child aggregates or a selection cap.
      for (let offset = 0; offset < intent.items.length; offset += 100) {
        await tx.insert(googleImportItems).values(
          intent.items.slice(offset, offset + 100).map((item) => {
            const { authorization: _authorization, ...persisted } = item
            return {
              ...persisted,
              ...authorizationColumns(item),
              organizationId: intent.organizationId,
              importId: intent.id,
              nextDispatchAt: intent.now,
              createdAt: intent.now,
              updatedAt: intent.now,
            }
          }),
        )
      }
      await insertOutboxRow(
        tx,
        requestedEvent({
          eventId: intent.outboxEventId,
          organizationId: intent.organizationId,
          importJobId: intent.id,
          now: intent.now,
        }),
        { recordedAt: intent.now },
      )
    })
    return 'committed'
  } catch (error) {
    if (isPgUniqueViolation(error)) return 'conflict'
    throw error
  }
}

export function createImportStore(
  db: Database,
  clock: Clock,
  completion: GoogleImportCompletionDeps,
): GoogleImportStore {
  return Object.freeze<GoogleImportStore>({
    ...createImportClaims(db),
    ...createImportLifecycleStore(db),
    ...createImportRetention(db),
    retryItem: createImportRetry(db),
    findPropertyImportInitiator: async (organizationId, propertyId) => {
      // Ordered by the item's own creation, not the request's: a Property is
      // announced for the history its FIRST import took over.
      const [item] = await db
        .select({ initiatedBy: googleImports.initiatedBy })
        .from(googleImportItems)
        .innerJoin(
          googleImports,
          and(
            eq(googleImports.organizationId, googleImportItems.organizationId),
            eq(googleImports.id, googleImportItems.importId),
          ),
        )
        .where(
          and(
            eq(googleImportItems.organizationId, organizationId),
            eq(googleImportItems.destinationPropertyId, propertyId),
          ),
        )
        .orderBy(asc(googleImportItems.createdAt), asc(googleImportItems.id))
        .limit(1)
      return item?.initiatedBy ?? null
    },
    findReplay: async (organizationId, requestId) => {
      const [row] = await db
        .select()
        .from(googleImports)
        .where(
          and(
            eq(googleImports.organizationId, organizationId),
            eq(googleImports.requestId, requestId),
          ),
        )
        .limit(1)
      if (!row) return null
      return {
        importJobId: row.id,
        initiatedBy: row.initiatedBy,
        wireReplay: {
          keyVersion: row.wireReplayKeyVersion,
          digest: row.wireReplayDigest,
        },
        semanticReplay: {
          keyVersion: row.semanticReplayKeyVersion,
          digest: row.semanticReplayDigest,
        },
      }
    },
    commitImport: (intent) => insertImport(db, intent),
    reconcileFromReceipt: (input) =>
      db.transaction((tx) =>
        completeImportItem(tx, completion, { ...input, authority: { kind: 'receipt' } }),
      ),
    completeClaim: (input) =>
      db.transaction((tx) =>
        completeImportItem(tx, completion, {
          ...input,
          authority: {
            kind: 'claim',
            dispatchEpoch: input.dispatchEpoch,
            claimFence: input.claimFence,
          },
        }),
      ),
    terminalizeItem: (input) =>
      db.transaction((tx) => completeImportItem(tx, completion, input)),
    listPendingDispatchItems: async (organizationId, importJobId) => {
      const [parent] = await db
        .select({
          id: googleImports.id,
        })

        .from(googleImports)
        .where(
          and(
            eq(googleImports.organizationId, organizationId),
            eq(googleImports.id, importJobId),
          ),
        )
        .limit(1)
      if (!parent) return null

      const rows = await db
        .select({
          itemId: googleImportItems.id,
          expectedConnectionLifecycleVersion:
            googleImportItems.expectedConnectionLifecycleVersion,
          expectedSourceEpoch: googleImportItems.expectedSourceEpoch,
          retryRevision: googleImportItems.retryRevision,
          dispatchEpoch: googleImportItems.dispatchEpoch,
        })
        .from(googleImportItems)
        .where(
          and(
            eq(googleImportItems.organizationId, organizationId),
            eq(googleImportItems.importId, importJobId),
            eq(googleImportItems.status, 'pending'),
          ),
        )
        .orderBy(asc(googleImportItems.createdAt), asc(googleImportItems.id))
      return rows.flatMap((row) =>
        row.expectedConnectionLifecycleVersion === null
          ? []
          : [
              {
                ...row,
                expectedConnectionLifecycleVersion:
                  row.expectedConnectionLifecycleVersion,
              },
            ],
      )
    },

    listRetryCandidates: async (organizationId, userId, importJobId, now) => {
      const rows = await db
        .select({
          organizationId: googleImportItems.organizationId,
          importJobId: googleImportItems.importId,
          itemId: googleImportItems.id,
          initiatedBy: googleImports.initiatedBy,
          connectionId: googleImportItems.connectionId,
          existingPropertyId: googleImportItems.existingPropertyId,
          ...AUTHORIZATION_SNAPSHOT_COLUMNS,
          providerAccountSuffix: googleImportItems.providerAccountSuffix,
          providerLocationSuffix: googleImportItems.providerLocationSuffix,
        })
        .from(googleImportItems)
        .innerJoin(
          googleImports,
          and(
            eq(googleImports.organizationId, googleImportItems.organizationId),
            eq(googleImports.id, googleImportItems.importId),
          ),
        )
        .where(
          and(
            eq(googleImportItems.organizationId, organizationId),
            eq(googleImportItems.importId, importJobId),
            eq(googleImports.initiatedBy, userId),
            eq(googleImportItems.status, 'failed'),
            eq(googleImportItems.outcomeCode, 'temporarily_unavailable'),
            sql`${googleImportItems.connectionId} IS NOT NULL`,
            sql`${googleImportItems.providerAccountSuffix} IS NOT NULL`,
            sql`${googleImportItems.providerLocationSuffix} IS NOT NULL`,
            sql`(${googleImports.purgeAt} IS NULL OR ${googleImports.purgeAt} > ${now})`,
          ),
        )
        .orderBy(asc(googleImportItems.createdAt), asc(googleImportItems.id))
      return rows.flatMap((row) => {
        const authorization = authorizationFromRow(row)
        return authorization && row.connectionId
          ? [
              {
                importJobId: row.importJobId,
                itemId: row.itemId,
                connectionId: row.connectionId,
                existingPropertyId: row.existingPropertyId,
                expectedSourceEpoch: row.expectedSourceEpoch,
                expectedProfileVersion: row.expectedProfileVersion,
                authorization,
              },
            ]
          : []
      })
    },

    listExpiredItems: async (now, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .select({
          organizationId: googleImportItems.organizationId,
          itemId: googleImportItems.id,
          retryRevision: googleImportItems.retryRevision,
        })
        .from(googleImportItems)
        .where(
          and(
            sql`${googleImportItems.status} IN ('pending', 'processing')`,
            lte(googleImportItems.effectDeadlineAt, now),
          ),
        )
        .orderBy(asc(googleImportItems.effectDeadlineAt), asc(googleImportItems.id))
        .limit(limit)
    },

    reserveDueItems: createImportDueReservation(db),

    getOperatorProgress: (organizationId, importId) =>
      getImportProgress(db, organizationId, importId, clock),
    getProgress: (organizationId, userId, importId) =>
      getImportProgress(db, organizationId, importId, clock, userId),
  })
}
