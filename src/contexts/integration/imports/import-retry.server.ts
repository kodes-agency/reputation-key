import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'
import {
  authorizationFromRow,
  itemScope as googleImportItemScope,
  lockItemParent,
  requestedEvent,
  touchParent,
} from './import-store-helpers.server'
import { AUTHORIZATION_SNAPSHOT_COLUMNS } from './import-claims.server'

export const createImportRetry =
  (db: Database): GoogleImportV2Store['retryItem'] =>
  async (input) =>
    db.transaction(async (tx) => {
      const parent = await lockItemParent(tx, input.organizationId, input.itemId)
      if (!parent) return { kind: 'rejected', reason: 'missing' } as const
      const [row] = await tx
        .select({
          organizationId: googleImportItems.organizationId,
          importJobId: googleImportItems.importId,
          itemId: googleImportItems.id,
          initiatedBy: googleImports.initiatedBy,
          parentPurgeAt: googleImports.purgeAt,
          parentFirstTerminalAt: googleImports.firstTerminalAt,
          connectionId: googleImportItems.connectionId,
          existingPropertyId: googleImportItems.existingPropertyId,
          ...AUTHORIZATION_SNAPSHOT_COLUMNS,
          providerAccountSuffix: googleImportItems.providerAccountSuffix,
          providerLocationSuffix: googleImportItems.providerLocationSuffix,
          googleReviewUri: googleImportItems.googleReviewUri,
          status: googleImportItems.status,
          outcomeCode: googleImportItems.outcomeCode,
          retryRevision: googleImportItems.retryRevision,
          dispatchEpoch: googleImportItems.dispatchEpoch,
          effectDeadlineAt: googleImportItems.effectDeadlineAt,
        })
        .from(googleImportItems)
        .innerJoin(
          googleImports,
          and(
            eq(googleImports.organizationId, googleImportItems.organizationId),
            eq(googleImports.id, googleImportItems.importId),
          ),
        )
        .where(googleImportItemScope(input.organizationId, input.itemId))
        .for('update')
        .limit(1)
      if (!row) return { kind: 'rejected', reason: 'missing' } as const
      const progressId = row.importJobId
      if (row.initiatedBy !== input.initiatingUserId) {
        return { kind: 'rejected', reason: 'not_initiator' } as const
      }
      if (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt) {
        return { kind: 'rejected', reason: 'effect_expired' } as const
      }

      const retryReceiptKey = JSON.stringify([
        input.organizationId,
        input.initiatingUserId,
        input.itemId,
        input.retryRequestId,
      ])
      const [receipt] = await tx
        .select({
          requestDigestKeyVersion: sql<string>`${idempotencyReceipts.payload}->>'requestDigestKeyVersion'`,
          requestDigest: sql<string>`${idempotencyReceipts.payload}->>'requestDigest'`,
          acceptedRetryRevision: sql<number>`(${idempotencyReceipts.payload}->>'acceptedRetryRevision')::integer`,
        })
        .from(idempotencyReceipts)
        .where(
          and(
            eq(idempotencyReceipts.scope, 'gbp_import_item_retry'),
            eq(idempotencyReceipts.key, retryReceiptKey),
          ),
        )
        .limit(1)
      if (receipt) {
        if (
          !input.matchesRequestDigest({
            keyVersion: receipt.requestDigestKeyVersion,
            digest: receipt.requestDigest,
          })
        ) {
          return { kind: 'rejected', reason: 'request_conflict' } as const
        }
        return {
          kind: 'replayed',
          importJobId: progressId,
          retryRevision: receipt.acceptedRetryRevision,
        } as const
      }

      if (row.retryRevision !== input.expectedRetryRevision) {
        return { kind: 'rejected', reason: 'stale_revision' } as const
      }
      if (
        row.status !== 'failed' ||
        row.outcomeCode !== 'temporarily_unavailable' ||
        row.connectionId === null ||
        row.providerAccountSuffix === null ||
        row.providerLocationSuffix === null
      ) {
        return { kind: 'rejected', reason: 'not_retryable' } as const
      }
      if (input.now >= row.effectDeadlineAt) {
        return { kind: 'rejected', reason: 'effect_expired' } as const
      }
      const authorization = authorizationFromRow(row)
      if (!authorization) {
        return { kind: 'rejected', reason: 'not_retryable' } as const
      }
      const authorizationDecision = await input.authorize({
        importJobId: progressId,
        itemId: row.itemId,
        connectionId: row.connectionId,
        existingPropertyId: row.existingPropertyId,
        expectedSourceEpoch: row.expectedSourceEpoch,
        expectedProfileVersion: row.expectedProfileVersion,
        authorization,
      })
      if (authorizationDecision !== 'authorized') {
        return {
          kind: 'rejected',
          reason:
            authorizationDecision === 'unavailable'
              ? 'authorization_unavailable'
              : 'authorization_denied',
        } as const
      }

      const retryRevision = row.retryRevision + 1
      await tx.insert(idempotencyReceipts).values({
        scope: 'gbp_import_item_retry',
        key: retryReceiptKey,
        payload: {
          organizationId: input.organizationId,
          initiatingUserId: input.initiatingUserId,
          itemId: input.itemId,
          retryRequestId: input.retryRequestId,
          requestDigestKeyVersion: input.requestDigest.keyVersion,
          requestDigest: input.requestDigest.digest,
          acceptedRetryRevision: retryRevision,
        },
        recordedAt: input.now,
      })
      const [updated] = await tx
        .update(googleImportItems)
        .set({
          status: 'pending',
          outcomeCode: null,
          retryRevision,
          dispatchEpoch: sql`${googleImportItems.dispatchEpoch} + 1`,
          nextDispatchAt: input.now,
          highestAttemptForRevision: 0,
          claimFence: null,
          claimLeaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(googleImportItems.organizationId, input.organizationId),
            eq(googleImportItems.id, input.itemId),
            eq(googleImportItems.retryRevision, input.expectedRetryRevision),
            eq(googleImportItems.status, 'failed'),
            eq(googleImportItems.outcomeCode, 'temporarily_unavailable'),
          ),
        )
        .returning({ id: googleImportItems.id })
      if (!updated) {
        throw new Error('google import retry CAS failed while item lock was held')
      }

      await touchParent(tx, input.organizationId, row.importJobId, input.now)
      await insertOutboxRow(
        tx,
        requestedEvent({
          eventId: input.outboxEventId,
          organizationId: input.organizationId,
          importJobId: row.importJobId,
          now: input.now,
        }),
        { recordedAt: input.now },
      )
      return {
        kind: 'accepted',
        importJobId: progressId,
        retryRevision,
      } as const
    })
