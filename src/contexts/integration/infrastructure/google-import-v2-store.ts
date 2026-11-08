import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import {
  gbpImportRequestItems,
  gbpImportRequests,
  gbpImportSagas,
} from '#/shared/db/schema/google-import-v2.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { organizationId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import {
  GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
  PROPERTY_IMPORT_RETENTION_RELEASED_EVENT,
  getImportOutcomePresentation,
  isImportProfileField,
  type GbpImportItemStatus,
  type ImportProgressDto,
  type ImportProgressItemDto,
} from '../application/google-import-v2-contract'
import type {
  GoogleImportV2ClaimedItem,
  GoogleImportV2Intent,
  GoogleImportV2LifecycleScope,
  GoogleImportV2Store,
  GoogleImportV2TerminalAuthority,
} from '../application/ports/google-import-v2-store.port'
import { createGoogleImportDueReservation } from './google-import-dispatch-store'
import {
  AUTHORIZATION_SNAPSHOT_COLUMNS,
  authorizationFromRow,
} from './google-import-authorization-snapshot'
import { importItemAdmitsAttempt } from '../application/google-import-item-attempt'
import {
  completeGoogleImportItem,
  googleImportItemScope,
  reduceParentFromItems,
  type GoogleImportCompletionDeps,
} from './google-import-completion'
import {
  GOOGLE_IMPORT_BATCH_SIZE,
  reduceGoogleImportSaga,
} from '../application/google-import-saga'
import type {
  IntegrationPropertyImportRequested,
  IntegrationPropertyImportRetentionReleased,
} from '../domain/events'

const ACTIVE_STATUSES: Readonly<Record<string, true>> = { queued: true, processing: true }

export { googleImportProgressPollAfterMs } from '../imports/import-progress-policy.server'
import { googleImportProgressPollAfterMs } from '../imports/import-progress-policy.server'

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

function isPgUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505'
}
function importCommitContractError(message: string): Error & {
  readonly code: 'contract_rejected'
} {
  return Object.assign(new Error(message), { code: 'contract_rejected' as const })
}

function assertLifecycleSweepLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('google import lifecycle sweep limit must be between 1 and 100')
  }
}

function unclaimedTerminalAuthority(
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

function requestedEvent(
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

function retentionReleasedEvent(
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

/** Every dimension of the frozen vector must be present and storable. A
 * missing one used to land as the string 'undefined' or NaN and only surface
 * later as an unexplained `authorization_changed` — the whole reason the
 * principal dimensions went unnoticed. */
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

function authorizationColumns(item: GoogleImportV2Intent['items'][number]) {
  const vector: FrozenVector = item.authorization.authorizationVector
  return {
    expectedExecutionPolicyVersion: frozenText(vector, 'executionPolicyVersion'),
    expectedActorRole: frozenText(vector, 'role'),
    expectedPermissionDigest: frozenText(vector, 'permissionDigest'),
    expectedPrincipalKind: frozenText(vector, 'principalKind'),
    expectedPermissionVersion: frozenCount(vector, 'permissionVersion'),
  }
}

function lifecycleScopePredicate(scope: GoogleImportV2LifecycleScope) {
  const tenant = eq(gbpImportRequestItems.organizationId, scope.organizationId)
  switch (scope.kind) {
    case 'organization':
      return tenant
    case 'user':
      return and(tenant, eq(gbpImportRequests.initiatedBy, scope.userId))
    case 'connection':
      return and(tenant, eq(gbpImportRequestItems.connectionId, scope.connectionId))
    case 'property':
      return and(
        tenant,
        or(
          eq(gbpImportRequestItems.existingPropertyId, scope.propertyId),
          eq(gbpImportRequestItems.destinationPropertyId, scope.propertyId),
        ),
      )
    case 'request':
      return and(
        tenant,
        or(
          eq(gbpImportRequests.id, scope.importJobId),
          eq(gbpImportRequests.sagaId, scope.importJobId),
        ),
      )
  }
}

// Provider authority still held by an item: the lifecycle sweeps for a
// connection, user or organization visit these rows to cancel and scrub them.
// The destination Property is deliberately absent: a terminal `imported` row
// keeps it as a plain internal reference and holds no authority through it.
const lifecycleAuthorityPresent = or(
  sql`${gbpImportRequestItems.status} IN ('pending', 'processing')`,
  eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
  isNotNull(gbpImportRequestItems.connectionId),
  isNotNull(gbpImportRequestItems.existingPropertyId),
  isNotNull(gbpImportRequestItems.providerAccountSuffix),
  isNotNull(gbpImportRequestItems.providerLocationSuffix),
  isNotNull(gbpImportRequestItems.expectedConnectionLifecycleVersion),
  isNotNull(gbpImportRequestItems.expectedConnectionAccessVersion),
  isNotNull(gbpImportRequestItems.expectedCredentialGeneration),
  isNotNull(gbpImportRequestItems.expectedSourceEpoch),
  isNotNull(gbpImportRequestItems.expectedProfileVersion),
)

// A Property deletion must also find the terminal rows that still name the
// Property, so its sweep selects on the reference as well as on authority.
function lifecycleSweepPredicate(scope: GoogleImportV2LifecycleScope) {
  return scope.kind === 'property'
    ? and(
        lifecycleScopePredicate(scope),
        or(
          lifecycleAuthorityPresent,
          isNotNull(gbpImportRequestItems.destinationPropertyId),
        ),
      )
    : and(lifecycleScopePredicate(scope), lifecycleAuthorityPresent)
}

type GoogleImportItemRow = typeof gbpImportRequestItems.$inferSelect

function progressItemFromRow(row: GoogleImportItemRow): ImportProgressItemDto {
  const presentation = row.outcomeCode
    ? getImportOutcomePresentation(row.outcomeCode)
    : null
  const retryable =
    (presentation?.retryable ?? false) &&
    row.connectionId !== null &&
    row.providerAccountSuffix !== null &&
    row.providerLocationSuffix !== null
  return {
    itemId: row.id,
    propertyName: row.propertyName,
    action: row.action,
    status: row.status as GbpImportItemStatus,
    outcomeCode: row.outcomeCode,
    messageKey: `property_import.${row.outcomeCode ?? row.status}`,
    retryable,
    retryRevision: row.retryRevision,
    userAction: retryable ? (presentation?.userAction ?? 'none') : 'none',
    propertyId:
      row.status === 'imported' ||
      row.status === 'relinked' ||
      row.status === 'already_exists'
        ? row.destinationPropertyId
        : null,
    invalidProfileField:
      row.outcomeCode === 'tenant_profile_invalid' &&
      isImportProfileField(row.invalidProfileField)
        ? row.invalidProfileField
        : null,
  }
}

async function loadSagaProgress(
  db: Database,
  saga: typeof gbpImportSagas.$inferSelect,
  clock: Clock,
): Promise<ImportProgressDto> {
  const batches = await db
    .select()
    .from(gbpImportRequests)
    .where(
      and(
        eq(gbpImportRequests.organizationId, saga.organizationId),
        eq(gbpImportRequests.sagaId, saga.id),
      ),
    )
    .orderBy(asc(gbpImportRequests.batchOrdinal), asc(gbpImportRequests.id))
  if (
    batches.length !== saga.batchCount ||
    batches.some((batch, index) => batch.batchOrdinal !== index)
  ) {
    throw new Error('Google import saga child-batch checkpoint is incomplete')
  }
  const reduction = reduceGoogleImportSaga(
    batches.map((batch) => ({
      status: batch.status,
      totalCount: batch.totalCount,
      processedCount: batch.processedCount,
      counts: {
        pending: batch.pendingCount,
        processing: batch.processingCount,
        imported: batch.importedCount,
        relinked: batch.relinkedCount,
        already_exists: batch.alreadyExistsCount,
        failed: batch.failedCount,
        cancelled: batch.cancelledCount,
      },
    })),
  )
  if (reduction.totalCount !== saga.totalCount) {
    throw new Error('Google import saga total does not match its child batches')
  }
  const rows = await db
    .select({ item: gbpImportRequestItems })
    .from(gbpImportRequestItems)
    .innerJoin(
      gbpImportRequests,
      and(
        eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
        eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
      ),
    )
    .where(
      and(
        eq(gbpImportRequestItems.organizationId, saga.organizationId),
        eq(gbpImportRequests.sagaId, saga.id),
      ),
    )
    .orderBy(
      asc(gbpImportRequests.batchOrdinal),
      asc(gbpImportRequestItems.createdAt),
      asc(gbpImportRequestItems.id),
    )
  if (rows.length !== saga.totalCount) {
    throw new Error('Google import saga item checkpoint is incomplete')
  }
  const items = rows.map(({ item }) => progressItemFromRow(item))
  const updatedAt = batches.reduce(
    (latest, batch) =>
      batch.updatedAt.getTime() > latest.getTime() ? batch.updatedAt : latest,
    saga.updatedAt,
  )
  const purgeAt = batches.every((batch) => batch.purgeAt !== null)
    ? new Date(Math.max(...batches.map((batch) => batch.purgeAt!.getTime())))
    : null
  return {
    contractVersion: GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
    importJobId: saga.id,
    requestId: saga.requestId,
    status: reduction.status,
    totalCount: reduction.totalCount,
    processedCount: reduction.processedCount,
    counts: reduction.counts,
    items,
    canRetry: items.some((item) => item.retryable),
    pollAfterMs: googleImportProgressPollAfterMs(
      reduction.status,
      updatedAt.getTime(),
      clock().getTime(),
    ),
    purgeAt: purgeAt?.toISOString() ?? null,
    updatedAt: updatedAt.toISOString(),
  }
}

async function loadProgress(
  db: Database,
  organizationId: string,
  importJobId: string,
  clock: Clock,
  initiatedBy?: string,
): Promise<ImportProgressDto | null> {
  const [saga] = await db
    .select()
    .from(gbpImportSagas)
    .where(
      and(
        eq(gbpImportSagas.organizationId, organizationId),
        eq(gbpImportSagas.id, importJobId),
      ),
    )
    .limit(1)
  if (saga) {
    if (initiatedBy !== undefined && saga.initiatedBy !== initiatedBy) return null
    return loadSagaProgress(db, saga, clock)
  }
  const [parent] = await db
    .select()
    .from(gbpImportRequests)
    .where(
      and(
        eq(gbpImportRequests.organizationId, organizationId),
        initiatedBy === undefined
          ? undefined
          : eq(gbpImportRequests.initiatedBy, initiatedBy),
        eq(gbpImportRequests.id, importJobId),
      ),
    )
    .limit(1)
  if (!parent) return null
  const rows = await db
    .select()
    .from(gbpImportRequestItems)
    .where(
      and(
        eq(gbpImportRequestItems.organizationId, organizationId),
        eq(gbpImportRequestItems.importJobId, importJobId),
      ),
    )
    .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
  const items = rows.map(progressItemFromRow)
  const counts = {
    pending: parent.pendingCount,
    processing: parent.processingCount,
    imported: parent.importedCount,
    relinked: parent.relinkedCount,
    already_exists: parent.alreadyExistsCount,
    failed: parent.failedCount,
    cancelled: parent.cancelledCount,
  } satisfies Record<GbpImportItemStatus, number>
  return {
    contractVersion: GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION,
    importJobId: parent.id,
    requestId: parent.requestId,
    status: parent.status,
    totalCount: parent.totalCount,
    processedCount: parent.processedCount,
    counts,
    items,
    canRetry: items.some((item) => item.retryable),
    pollAfterMs: googleImportProgressPollAfterMs(
      parent.status,
      parent.updatedAt.getTime(),
      clock().getTime(),
    ),
    purgeAt: parent.purgeAt?.toISOString() ?? null,
    updatedAt: parent.updatedAt.toISOString(),
  }
}

export const createGoogleImportV2Store = (
  db: Database,
  clock: Clock,
  completion: GoogleImportCompletionDeps,
): GoogleImportV2Store => {
  return Object.freeze({
    findPropertyImportInitiator: async (organizationId, propertyId) => {
      // Ordered by the item's own creation, not the request's: a Property is
      // announced for the history its FIRST import took over.
      const [item] = await db
        .select({ initiatedBy: gbpImportRequests.initiatedBy })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          ),
        )
        .where(
          and(
            eq(gbpImportRequestItems.organizationId, organizationId),
            eq(gbpImportRequestItems.destinationPropertyId, propertyId),
          ),
        )
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
        .limit(1)
      return item?.initiatedBy ?? null
    },
    findReplay: async (organizationId, requestId) => {
      const [saga] = await db
        .select({
          importJobId: gbpImportSagas.id,
          initiatedBy: gbpImportSagas.initiatedBy,
          wireReplayKeyVersion: gbpImportSagas.wireReplayKeyVersion,
          wireReplayDigest: gbpImportSagas.wireReplayDigest,
          semanticReplayKeyVersion: gbpImportSagas.semanticReplayKeyVersion,
          semanticReplayDigest: gbpImportSagas.semanticReplayDigest,
        })
        .from(gbpImportSagas)
        .where(
          and(
            eq(gbpImportSagas.organizationId, organizationId),
            eq(gbpImportSagas.requestId, requestId),
          ),
        )
        .limit(1)
      if (saga) {
        return {
          importJobId: saga.importJobId,
          initiatedBy: saga.initiatedBy,
          wireReplay: {
            keyVersion: saga.wireReplayKeyVersion,
            digest: saga.wireReplayDigest,
          },
          semanticReplay: {
            keyVersion: saga.semanticReplayKeyVersion,
            digest: saga.semanticReplayDigest,
          },
        }
      }
      const [row] = await db
        .select({
          importJobId: gbpImportRequests.id,
          initiatedBy: gbpImportRequests.initiatedBy,
          wireReplayKeyVersion: gbpImportRequests.wireReplayKeyVersion,
          wireReplayDigest: gbpImportRequests.wireReplayDigest,
          semanticReplayKeyVersion: gbpImportRequests.semanticReplayKeyVersion,
          semanticReplayDigest: gbpImportRequests.semanticReplayDigest,
        })
        .from(gbpImportRequests)
        .where(
          and(
            eq(gbpImportRequests.organizationId, organizationId),
            eq(gbpImportRequests.requestId, requestId),
          ),
        )
        .limit(1)
      if (!row) return null
      return {
        importJobId: row.importJobId,
        initiatedBy: row.initiatedBy,
        wireReplay:
          row.wireReplayKeyVersion && row.wireReplayDigest
            ? {
                keyVersion: row.wireReplayKeyVersion,
                digest: row.wireReplayDigest,
              }
            : null,
        semanticReplay:
          row.semanticReplayKeyVersion && row.semanticReplayDigest
            ? {
                keyVersion: row.semanticReplayKeyVersion,
                digest: row.semanticReplayDigest,
              }
            : null,
      }
    },

    commitSaga: async (intent) => {
      const batches = [...intent.batches].sort(
        (left, right) => left.ordinal - right.ordinal,
      )
      if (
        batches.length === 0 ||
        batches.some(
          (batch, index) =>
            batch.ordinal !== index ||
            batch.items.length < 1 ||
            batch.items.length > GOOGLE_IMPORT_BATCH_SIZE ||
            (index < batches.length - 1 &&
              batch.items.length !== GOOGLE_IMPORT_BATCH_SIZE),
        ) ||
        new Set(batches.flatMap((batch) => batch.items.map((item) => item.id))).size !==
          batches.reduce((total, batch) => total + batch.items.length, 0)
      ) {
        throw importCommitContractError('invalid Google import saga batch plan')
      }
      const totalCount = batches.reduce((total, batch) => total + batch.items.length, 0)
      try {
        await db.transaction(async (tx) => {
          await tx.insert(gbpImportSagas).values({
            id: intent.id,
            organizationId: intent.organizationId,
            requestId: intent.requestId,
            initiatedBy: intent.initiatedBy,
            totalCount,
            batchCount: batches.length,
            wireReplayKeyVersion: intent.wireReplay.keyVersion,
            wireReplayDigest: intent.wireReplay.digest,
            semanticReplayKeyVersion: intent.semanticReplay.keyVersion,
            semanticReplayDigest: intent.semanticReplay.digest,
            createdAt: intent.now,
            updatedAt: intent.now,
          })

          for (const batch of batches) {
            await tx.insert(gbpImportRequests).values({
              id: batch.id,
              organizationId: intent.organizationId,
              requestId: batch.requestId,
              initiatedBy: intent.initiatedBy,
              sagaId: intent.id,
              batchOrdinal: batch.ordinal,
              totalCount: batch.items.length,
              pendingCount: batch.items.length,
              // Keep the established lifecycle fencing path authoritative for
              // every child while replay recovery resolves through the saga.
              wireReplayKeyVersion: intent.wireReplay.keyVersion,
              wireReplayDigest: intent.wireReplay.digest,
              semanticReplayKeyVersion: intent.semanticReplay.keyVersion,
              semanticReplayDigest: intent.semanticReplay.digest,
              createdAt: intent.now,
              updatedAt: intent.now,
            })
            await tx.insert(gbpImportRequestItems).values(
              batch.items.map((item) => {
                const { authorization: _authorization, ...persisted } = item
                return {
                  ...persisted,
                  nextDispatchAt: intent.now,
                  ...authorizationColumns(item),
                  organizationId: intent.organizationId,
                  importJobId: batch.id,
                  createdAt: intent.now,
                  updatedAt: intent.now,
                }
              }),
            )
            await insertOutboxRow(
              tx,
              requestedEvent({
                eventId: batch.outboxEventId,
                organizationId: intent.organizationId,
                importJobId: batch.id,
                now: intent.now,
              }),
              { recordedAt: intent.now },
            )
          }
        })
        return 'committed' as const
      } catch (error) {
        if (isPgUniqueViolation(error)) return 'conflict' as const
        throw error
      }
    },

    commitIntent: async (intent) => {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(gbpImportRequests).values({
            id: intent.id,
            organizationId: intent.organizationId,
            requestId: intent.requestId,
            initiatedBy: intent.initiatedBy,
            totalCount: intent.items.length,
            pendingCount: intent.items.length,
            wireReplayKeyVersion: intent.wireReplay.keyVersion,
            wireReplayDigest: intent.wireReplay.digest,
            semanticReplayKeyVersion: intent.semanticReplay.keyVersion,
            semanticReplayDigest: intent.semanticReplay.digest,
            createdAt: intent.now,
            updatedAt: intent.now,
          })
          await tx.insert(gbpImportRequestItems).values(
            intent.items.map((item) => {
              const { authorization: _authorization, ...persisted } = item
              return {
                ...persisted,
                nextDispatchAt: intent.now,
                ...authorizationColumns(item),
                organizationId: intent.organizationId,
                importJobId: intent.id,
                createdAt: intent.now,
                updatedAt: intent.now,
              }
            }),
          )
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
        return 'committed' as const
      } catch (error) {
        if (isPgUniqueViolation(error)) return 'conflict' as const
        throw error
      }
    },

    retryItem: async (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            organizationId: gbpImportRequestItems.organizationId,
            importJobId: gbpImportRequestItems.importJobId,
            sagaId: gbpImportRequests.sagaId,
            itemId: gbpImportRequestItems.id,
            initiatedBy: gbpImportRequests.initiatedBy,
            parentPurgeAt: gbpImportRequests.purgeAt,
            parentFirstTerminalAt: gbpImportRequests.firstTerminalAt,
            connectionId: gbpImportRequestItems.connectionId,
            existingPropertyId: gbpImportRequestItems.existingPropertyId,
            ...AUTHORIZATION_SNAPSHOT_COLUMNS,
            providerAccountSuffix: gbpImportRequestItems.providerAccountSuffix,
            providerLocationSuffix: gbpImportRequestItems.providerLocationSuffix,
            googleReviewUri: gbpImportRequestItems.googleReviewUri,
            status: gbpImportRequestItems.status,
            outcomeCode: gbpImportRequestItems.outcomeCode,
            retryRevision: gbpImportRequestItems.retryRevision,
            dispatchEpoch: gbpImportRequestItems.dispatchEpoch,
            effectDeadlineAt: gbpImportRequestItems.effectDeadlineAt,
          })
          .from(gbpImportRequestItems)
          .innerJoin(
            gbpImportRequests,
            and(
              eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
              eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
            ),
          )
          .where(googleImportItemScope(input.organizationId, input.itemId))
          .for('update')
          .limit(1)
        if (!row) return { kind: 'rejected', reason: 'missing' } as const
        const progressId = row.sagaId ?? row.importJobId
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
          .update(gbpImportRequestItems)
          .set({
            status: 'pending',
            outcomeCode: null,
            retryRevision,
            dispatchEpoch: sql`${gbpImportRequestItems.dispatchEpoch} + 1`,
            nextDispatchAt: input.now,
            highestAttemptForRevision: 0,
            claimFence: null,
            claimLeaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.expectedRetryRevision),
              eq(gbpImportRequestItems.status, 'failed'),
              eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
            ),
          )
          .returning({ id: gbpImportRequestItems.id })
        if (!updated) {
          throw new Error('google import retry CAS failed while item lock was held')
        }

        await reduceParentFromItems(tx, {
          organizationId: input.organizationId,
          importJobId: row.importJobId,
          firstTerminalAt: row.parentFirstTerminalAt,
          now: input.now,
        })
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
      }),

    claimItem: async (input) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            organizationId: gbpImportRequestItems.organizationId,
            importJobId: gbpImportRequestItems.importJobId,
            itemId: gbpImportRequestItems.id,
            initiatedBy: gbpImportRequests.initiatedBy,
            connectionId: gbpImportRequestItems.connectionId,
            existingPropertyId: gbpImportRequestItems.existingPropertyId,
            destinationPropertyId: gbpImportRequestItems.destinationPropertyId,
            providerAccountSuffix: gbpImportRequestItems.providerAccountSuffix,
            providerLocationSuffix: gbpImportRequestItems.providerLocationSuffix,
            googleReviewUri: gbpImportRequestItems.googleReviewUri,
            googlePrimaryCategory: gbpImportRequestItems.googlePrimaryCategory,
            ...AUTHORIZATION_SNAPSHOT_COLUMNS,
            action: gbpImportRequestItems.action,
            updateExistingProfile: gbpImportRequestItems.updateExistingProfile,
            propertyName: gbpImportRequestItems.propertyName,
            propertyAddress: gbpImportRequestItems.propertyAddress,
            countryCode: gbpImportRequestItems.countryCode,
            timezone: gbpImportRequestItems.timezone,
            status: gbpImportRequestItems.status,
            retryRevision: gbpImportRequestItems.retryRevision,
            dispatchEpoch: gbpImportRequestItems.dispatchEpoch,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
            claimFence: gbpImportRequestItems.claimFence,
            claimLeaseExpiresAt: gbpImportRequestItems.claimLeaseExpiresAt,
            effectDeadlineAt: gbpImportRequestItems.effectDeadlineAt,
            parentPurgeAt: gbpImportRequests.purgeAt,
          })
          .from(gbpImportRequestItems)
          .innerJoin(
            gbpImportRequests,
            and(
              eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
              eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
            ),
          )
          .where(googleImportItemScope(input.organizationId, input.itemId))
          .for('update', { of: gbpImportRequestItems })
          .limit(1)
        if (!row) return { kind: 'ignored', reason: 'missing' } as const
        if (row.status !== 'pending' && row.status !== 'processing') {
          return { kind: 'ignored', reason: 'terminal' } as const
        }
        if (row.retryRevision !== input.retryRevision) {
          return { kind: 'ignored', reason: 'stale_revision' } as const
        }
        if (row.dispatchEpoch !== input.dispatchEpoch) {
          return { kind: 'ignored', reason: 'stale_dispatch' } as const
        }
        const expiredClaim =
          row.status === 'processing' &&
          row.claimLeaseExpiresAt !== null &&
          row.claimLeaseExpiresAt <= input.now
        if (row.status === 'processing' && !expiredClaim) {
          return { kind: 'ignored', reason: 'claim_active' } as const
        }
        if (
          input.now >= row.effectDeadlineAt ||
          (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt)
        ) {
          return {
            kind: 'ignored',
            reason: 'effect_expired',
            effectDeadlineAt: row.effectDeadlineAt,
            authority: unclaimedTerminalAuthority(row, expiredClaim),
          } as const
        }
        if (
          !importItemAdmitsAttempt(
            row.highestAttemptForRevision,
            row.highestAttemptForRevision + 1,
          )
        ) {
          return {
            kind: 'ignored',
            reason: 'attempts_exhausted',
            effectDeadlineAt: row.effectDeadlineAt,
            authority: unclaimedTerminalAuthority(row, expiredClaim),
          } as const
        }
        const attemptOrdinal = row.highestAttemptForRevision + 1
        const dispatchEpoch = row.dispatchEpoch + (expiredClaim ? 1 : 0)
        const authorization = authorizationFromRow(row)
        if (
          !authorization ||
          row.destinationPropertyId === null ||
          row.providerAccountSuffix === null ||
          row.providerLocationSuffix === null ||
          row.connectionId === null
        ) {
          throw new Error('google import item authorization snapshot is incomplete')
        }
        const [claimed] = await tx
          .update(gbpImportRequestItems)
          .set({
            status: 'processing',
            highestAttemptForRevision: attemptOrdinal,
            dispatchEpoch,
            nextDispatchAt: input.leaseExpiresAt,
            claimFence: input.claimFence,
            claimLeaseExpiresAt: input.leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
            ),
          )
          .returning({ id: gbpImportRequestItems.id })
        if (!claimed) return { kind: 'ignored', reason: 'claim_active' } as const
        if (row.status === 'pending') {
          await tx
            .update(gbpImportRequests)
            .set({
              status: 'processing',
              pendingCount: sql`${gbpImportRequests.pendingCount} - 1`,
              processingCount: sql`${gbpImportRequests.processingCount} + 1`,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(gbpImportRequests.organizationId, row.organizationId),
                eq(gbpImportRequests.id, row.importJobId),
              ),
            )
        }
        return {
          kind: 'claimed',
          item: {
            ...row,
            connectionId: row.connectionId,
            expectedConnectionLifecycleVersion: authorization.connectionLifecycleVersion,
            expectedConnectionAccessVersion: authorization.connectionAccessVersion,
            expectedCredentialGeneration: authorization.credentialGeneration,
            destinationPropertyId: row.destinationPropertyId,
            providerAccountSuffix: row.providerAccountSuffix,
            providerLocationSuffix: row.providerLocationSuffix,
            googleReviewUri: row.googleReviewUri,
            authorization,
            attemptOrdinal,
            dispatchEpoch,
            claimFence: input.claimFence,
          } satisfies GoogleImportV2ClaimedItem,
        } as const
      }),

    runClaimedEffect: async (input, effect) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            status: gbpImportRequestItems.status,
            retryRevision: gbpImportRequestItems.retryRevision,
            dispatchEpoch: gbpImportRequestItems.dispatchEpoch,
            highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
            claimFence: gbpImportRequestItems.claimFence,
            claimLeaseExpiresAt: gbpImportRequestItems.claimLeaseExpiresAt,
            effectDeadlineAt: gbpImportRequestItems.effectDeadlineAt,
            parentPurgeAt: gbpImportRequests.purgeAt,
          })
          .from(gbpImportRequestItems)
          .innerJoin(
            gbpImportRequests,
            and(
              eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
              eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
            ),
          )
          .where(googleImportItemScope(input.organizationId, input.itemId))
          .for('update', { of: gbpImportRequestItems })
          .limit(1)
        if (
          !row ||
          row.status !== 'processing' ||
          row.retryRevision !== input.retryRevision ||
          row.dispatchEpoch !== input.dispatchEpoch ||
          row.highestAttemptForRevision !== input.attemptOrdinal ||
          row.claimFence !== input.claimFence ||
          row.claimLeaseExpiresAt === null ||
          row.claimLeaseExpiresAt <= input.now
        ) {
          return { kind: 'lost' } as const
        }
        if (
          input.now >= row.effectDeadlineAt ||
          (row.parentPurgeAt !== null && input.now >= row.parentPurgeAt)
        ) {
          return { kind: 'effect_expired' } as const
        }
        return { kind: 'executed', value: await effect() } as const
      }),

    releaseClaimForRetry: async (input) =>
      db.transaction(async (tx) => {
        const [released] = await tx
          .update(gbpImportRequestItems)
          .set({
            status: 'pending',
            dispatchEpoch: sql`${gbpImportRequestItems.dispatchEpoch} + 1`,
            nextDispatchAt: new Date(input.now.getTime() + 60_000),
            claimFence: null,
            claimLeaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.id, input.itemId),
              eq(gbpImportRequestItems.retryRevision, input.retryRevision),
              eq(gbpImportRequestItems.dispatchEpoch, input.dispatchEpoch),
              ...(input.expiredOnly
                ? [lte(gbpImportRequestItems.claimLeaseExpiresAt, input.now)]
                : []),
              eq(gbpImportRequestItems.claimFence, input.claimFence),
              eq(gbpImportRequestItems.status, 'processing'),
            ),
          )
          .returning({ importJobId: gbpImportRequestItems.importJobId })
        if (!released) return 'lost' as const
        await tx
          .update(gbpImportRequests)
          .set({
            pendingCount: sql`${gbpImportRequests.pendingCount} + 1`,
            processingCount: sql`${gbpImportRequests.processingCount} - 1`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, released.importJobId),
            ),
          )
        return 'released' as const
      }),

    reconcileFromReceipt: async (input) =>
      db.transaction((tx) =>
        completeGoogleImportItem(tx, completion, {
          ...input,
          authority: { kind: 'receipt' },
        }),
      ),
    completeClaim: async (input) =>
      db.transaction((tx) =>
        completeGoogleImportItem(tx, completion, {
          ...input,
          authority: {
            kind: 'claim',
            dispatchEpoch: input.dispatchEpoch,
            claimFence: input.claimFence,
          },
        }),
      ),
    terminalizeItem: async (input) =>
      db.transaction((tx) => completeGoogleImportItem(tx, completion, input)),
    listPendingDispatchItems: async (organizationId, importJobId) => {
      const [parent] = await db
        .select({
          id: gbpImportRequests.id,
          status: gbpImportRequests.status,
        })

        .from(gbpImportRequests)
        .where(
          and(
            eq(gbpImportRequests.organizationId, organizationId),
            eq(gbpImportRequests.id, importJobId),
          ),
        )
        .limit(1)
      if (!parent) return null
      if (ACTIVE_STATUSES[parent.status] !== true) return []

      const rows = await db
        .select({
          itemId: gbpImportRequestItems.id,
          expectedConnectionLifecycleVersion:
            gbpImportRequestItems.expectedConnectionLifecycleVersion,
          expectedSourceEpoch: gbpImportRequestItems.expectedSourceEpoch,
          retryRevision: gbpImportRequestItems.retryRevision,
          dispatchEpoch: gbpImportRequestItems.dispatchEpoch,
        })
        .from(gbpImportRequestItems)
        .where(
          and(
            eq(gbpImportRequestItems.organizationId, organizationId),
            eq(gbpImportRequestItems.importJobId, importJobId),
            eq(gbpImportRequestItems.status, 'pending'),
          ),
        )
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
        .limit(100)
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
          organizationId: gbpImportRequestItems.organizationId,
          importJobId: gbpImportRequestItems.importJobId,
          sagaId: gbpImportRequests.sagaId,
          itemId: gbpImportRequestItems.id,
          initiatedBy: gbpImportRequests.initiatedBy,
          connectionId: gbpImportRequestItems.connectionId,
          existingPropertyId: gbpImportRequestItems.existingPropertyId,
          ...AUTHORIZATION_SNAPSHOT_COLUMNS,
          providerAccountSuffix: gbpImportRequestItems.providerAccountSuffix,
          providerLocationSuffix: gbpImportRequestItems.providerLocationSuffix,
        })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          ),
        )
        .where(
          and(
            eq(gbpImportRequestItems.organizationId, organizationId),
            or(
              eq(gbpImportRequestItems.importJobId, importJobId),
              eq(gbpImportRequests.sagaId, importJobId),
            ),
            eq(gbpImportRequests.initiatedBy, userId),
            eq(gbpImportRequestItems.status, 'failed'),
            eq(gbpImportRequestItems.outcomeCode, 'temporarily_unavailable'),
            sql`${gbpImportRequestItems.connectionId} IS NOT NULL`,
            sql`${gbpImportRequestItems.providerAccountSuffix} IS NOT NULL`,
            sql`${gbpImportRequestItems.providerLocationSuffix} IS NOT NULL`,
            sql`(${gbpImportRequests.purgeAt} IS NULL OR ${gbpImportRequests.purgeAt} > ${now})`,
          ),
        )
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
      return rows.flatMap((row) => {
        const authorization = authorizationFromRow(row)
        return authorization && row.connectionId
          ? [
              {
                importJobId: row.sagaId ?? row.importJobId,
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
          organizationId: gbpImportRequestItems.organizationId,
          itemId: gbpImportRequestItems.id,
          retryRevision: gbpImportRequestItems.retryRevision,
        })
        .from(gbpImportRequestItems)
        .where(
          and(
            sql`${gbpImportRequestItems.status} IN ('pending', 'processing')`,
            lte(gbpImportRequestItems.effectDeadlineAt, now),
          ),
        )
        .orderBy(
          asc(gbpImportRequestItems.effectDeadlineAt),
          asc(gbpImportRequestItems.id),
        )
        .limit(limit)
    },

    reserveDueItems: createGoogleImportDueReservation(db),

    listPurgeCandidates: async (now, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .select({
          organizationId: gbpImportRequests.organizationId,
          importJobId: gbpImportRequests.id,
          deletionFence: gbpImportRequests.deletionFence,
        })
        .from(gbpImportRequests)
        .where(
          and(
            sql`${gbpImportRequests.status} NOT IN ('queued', 'processing')`,
            lte(gbpImportRequests.purgeAt, now),
          ),
        )
        .orderBy(asc(gbpImportRequests.purgeAt), asc(gbpImportRequests.id))
        .limit(limit)
    },

    purgeParent: async (input) =>
      db.transaction(async (tx) => {
        const itemRows = await tx
          .select({ itemId: gbpImportRequestItems.id })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.importJobId, input.importJobId),
            ),
          )
          .orderBy(asc(gbpImportRequestItems.id))
          .for('update')
          .limit(101)
        if (itemRows.length < 1 || itemRows.length > 100) return 'lost' as const

        const [parent] = await tx
          .select({
            totalCount: gbpImportRequests.totalCount,
            sagaId: gbpImportRequests.sagaId,
          })
          .from(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence),
              sql`${gbpImportRequests.status} NOT IN ('queued', 'processing')`,
              lte(gbpImportRequests.purgeAt, input.now),
            ),
          )
          .for('update')
          .limit(1)
        if (!parent || parent.totalCount !== itemRows.length) return 'lost' as const

        const [fenced] = await tx
          .update(gbpImportRequests)
          .set({
            deletionFence: input.expectedDeletionFence + 1,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence),
            ),
          )
          .returning({ id: gbpImportRequests.id })
        if (!fenced) return 'lost' as const

        const itemIds = itemRows.map((row) => row.itemId)
        await insertOutboxRow(
          tx,
          retentionReleasedEvent({
            eventId: input.outboxEventId,
            organizationId: input.organizationId,
            importJobId: input.importJobId,
            itemIds,
            now: input.now,
          }),
          { recordedAt: input.now },
        )
        await tx
          .delete(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, 'gbp_import_item_retry'),
              sql`${idempotencyReceipts.payload}->>'organizationId' = ${input.organizationId}`,
              inArray(sql<string>`${idempotencyReceipts.payload}->>'itemId'`, itemIds),
            ),
          )
        const [deleted] = await tx
          .delete(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence + 1),
            ),
          )
          .returning({ id: gbpImportRequests.id })
        if (!deleted) return 'lost' as const
        if (parent.sagaId) {
          await tx.delete(gbpImportSagas).where(
            and(
              eq(gbpImportSagas.organizationId, input.organizationId),
              eq(gbpImportSagas.id, parent.sagaId),
              sql`NOT EXISTS (
                  SELECT 1
                  FROM ${gbpImportRequests}
                  WHERE ${gbpImportRequests.organizationId} = ${input.organizationId}
                    AND ${gbpImportRequests.sagaId} = ${parent.sagaId}
                )`,
            ),
          )
        }
        return 'purged' as const
      }),

    listLifecycleScopeParents: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .selectDistinct({
          organizationId: gbpImportRequests.organizationId,
          importJobId: gbpImportRequests.id,
        })
        .from(gbpImportRequests)
        .innerJoin(
          gbpImportRequestItems,
          and(
            eq(gbpImportRequestItems.organizationId, gbpImportRequests.organizationId),
            eq(gbpImportRequestItems.importJobId, gbpImportRequests.id),
          ),
        )
        .where(
          and(
            lifecycleScopePredicate(scope),
            isNotNull(gbpImportRequests.wireReplayDigest),
          ),
        )
        .orderBy(asc(gbpImportRequests.id))
        .limit(limit)
    },

    fenceLifecycleParent: async (input) => {
      const [fenced] = await db
        .update(gbpImportRequests)
        .set({
          deletionFence: sql`${gbpImportRequests.deletionFence} + 1`,
          wireReplayKeyVersion: null,
          wireReplayDigest: null,
          semanticReplayKeyVersion: null,
          semanticReplayDigest: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(gbpImportRequests.organizationId, input.organizationId),
            eq(gbpImportRequests.id, input.importJobId),
            isNotNull(gbpImportRequests.wireReplayDigest),
          ),
        )
        .returning({ id: gbpImportRequests.id })
      return fenced ? ('fenced' as const) : ('lost' as const)
    },

    listLifecycleScopeItems: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      const rows = await db
        .select({
          organizationId: gbpImportRequestItems.organizationId,
          importJobId: gbpImportRequestItems.importJobId,
          itemId: gbpImportRequestItems.id,
          retryRevision: gbpImportRequestItems.retryRevision,
          dispatchEpoch: gbpImportRequestItems.dispatchEpoch,
          status: gbpImportRequestItems.status,
          outcomeCode: gbpImportRequestItems.outcomeCode,
        })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          ),
        )
        .where(lifecycleSweepPredicate(scope))
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
        .limit(limit)
      return rows.map((row) => ({
        organizationId: row.organizationId,
        importJobId: row.importJobId,
        itemId: row.itemId,
        retryRevision: row.retryRevision,
        active:
          row.status === 'pending' ||
          row.status === 'processing' ||
          row.outcomeCode === 'temporarily_unavailable',
      }))
    },

    scrubLifecycleItems: async (input) => {
      const itemIds = [...new Set(input.itemIds)]
      if (itemIds.length < 1 || itemIds.length > 100) {
        throw new Error('google import lifecycle scrub requires 1 to 100 unique items')
      }
      const rows = await db
        .update(gbpImportRequestItems)
        .set({
          connectionId: null,
          existingPropertyId: null,
          destinationPropertyId: null,
          providerAccountSuffix: null,
          providerLocationSuffix: null,
          googleReviewUri: null,
          googlePrimaryCategory: null,
          expectedConnectionLifecycleVersion: null,
          expectedConnectionAccessVersion: null,
          expectedCredentialGeneration: null,
          expectedExecutionPolicyVersion: null,
          expectedActorRole: null,
          expectedPermissionDigest: null,
          expectedSourceEpoch: null,
          expectedProfileVersion: null,
          claimFence: null,
          claimLeaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(gbpImportRequestItems.organizationId, input.organizationId),
            inArray(gbpImportRequestItems.id, itemIds),
            sql`${gbpImportRequestItems.status} NOT IN ('pending', 'processing')`,
            sql`${gbpImportRequestItems.outcomeCode} <> 'temporarily_unavailable'`,
          ),
        )
        .returning({ id: gbpImportRequestItems.id })
      return rows.length
    },

    countLifecycleScopeItems: async (scope, limit) => {
      assertLifecycleSweepLimit(limit)
      const rows = await db
        .select({ itemId: gbpImportRequestItems.id })
        .from(gbpImportRequestItems)
        .innerJoin(
          gbpImportRequests,
          and(
            eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
            eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          ),
        )
        .where(lifecycleSweepPredicate(scope))
        .orderBy(asc(gbpImportRequestItems.createdAt), asc(gbpImportRequestItems.id))
        .limit(limit)
      return rows.length
    },

    getOperatorProgress: (organizationId, importJobId) =>
      loadProgress(db, organizationId, importJobId, clock),

    getProgress: (organizationId, userId, importJobId) =>
      loadProgress(db, organizationId, importJobId, clock, userId),
  })
}
